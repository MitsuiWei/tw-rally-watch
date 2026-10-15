// 營收加速 page: unlock with the owner's password, then browse each day's lists and charts.
// Data is decrypted in the browser only (see crypto.mjs); nothing readable is published.
import {deriveKey, decryptPayload, exportRawKey, importRawKey} from './crypto.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const STORE = 'tw-rally-revenue-key';
const state = {data: null, tab: 'fresh', day: 0, query: '', rows: [], open: -1};

// ---------------------------------------------------------------- month maths (mirrors fc_score/accel.py)
export function mshift(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const i = y * 12 + (mo - 1) + n;
  return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
}
const sum = (R, ms) => ms.every(m => R[m] != null) ? ms.reduce((a, m) => a + R[m], 0) : null;
export function yoy3(R, m) {
  const cur = sum(R, [m, mshift(m, -1), mshift(m, -2)]), ly = sum(R, [mshift(m, -12), mshift(m, -13), mshift(m, -14)]);
  return cur != null && ly ? cur / ly - 1 : null;
}
export const yoy1 = (R, m) => R[m] != null && R[mshift(m, -12)] ? R[m] / R[mshift(m, -12)] - 1 : null;

// ---------------------------------------------------------------- unlock
async function loadManifest() {
  const r = await fetch('./manifest.json', {cache: 'no-store'});
  if (!r.ok) throw new Error('nodata');
  return r.json();
}

async function tryKey(manifest, key) {
  const r = await fetch('./' + manifest.file);
  if (!r.ok) throw new Error('nodata');
  return decryptPayload(key, await r.arrayBuffer());
}

async function unlock(manifest, password, remember) {
  const key = await deriveKey(password, manifest.salt, manifest.iterations, remember);
  const data = await tryKey(manifest, key);
  if (remember) localStorage.setItem(STORE, JSON.stringify({salt: manifest.salt, raw: await exportRawKey(key)}));
  return data;
}

async function boot() {
  let manifest;
  try {
    manifest = await loadManifest();
  } catch {
    $('#lock-msg').textContent = '目前還沒有資料。請確認 GitHub 已設定 ACCEL_PAGE_PASSWORD，並等下一次每日更新。';
    for (const el of $('#lock-form').querySelectorAll('input,label,button')) el.hidden = true;
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.salt === manifest.salt) {
      start(await tryKey(manifest, await importRawKey(saved.raw)));
      return;
    }
  } catch {
    localStorage.removeItem(STORE);
  }
  $('#lock-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#unlock'), msg = $('#lock-msg');
    btn.disabled = true;
    msg.textContent = '解鎖中…';
    try {
      start(await unlock(manifest, $('#password').value, $('#remember').checked));
    } catch {
      msg.textContent = '密碼不正確，請再試一次。';
      btn.disabled = false;
    }
  });
  $('#password').focus();
}

// ---------------------------------------------------------------- list view
function start(data) {
  state.data = data;
  $('#lock').hidden = true;
  $('#app').hidden = false;
  const sel = $('#date');
  sel.innerHTML = data.dates.map((d, i) => `<option value="${i}">${esc(d.date)}（剛轉強 ${d.fresh.length}・加速 ${d.accel.length}）</option>`).join('');
  sel.addEventListener('change', () => { state.day = Number(sel.value); render(); });
  $('#prev-day').addEventListener('click', () => step(1));
  $('#next-day').addEventListener('click', () => step(-1));
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
  $('#search').addEventListener('input', e => { state.query = e.target.value.trim(); render(); });
  $('#lock-now').addEventListener('click', () => { localStorage.removeItem(STORE); location.reload(); });
  $('#generated').textContent = `資料產生時間 ${data.generated_at}`;
  document.addEventListener('keydown', e => {
    if (state.open < 0) return;
    if (e.key === 'Escape') closeDetail();
    if (e.key === 'ArrowRight') openDetail(Math.min(state.open + 1, state.rows.length - 1));
    if (e.key === 'ArrowLeft') openDetail(Math.max(state.open - 1, 0));
  });
  render();
}

function step(delta) {
  const n = state.data.dates.length;
  state.day = Math.min(n - 1, Math.max(0, state.day + delta));
  $('#date').value = String(state.day);
  render();
}

const COLS = [['代號', r => `<b>${esc(r.code)}</b><span>${esc(r.name)}</span>`, 'stock'],
  ['資料月', r => esc(r['資料截至月'])], ['營收(億)', r => esc(r['最新月營收(億)']), 'numeric'],
  ['單月年增', r => pct(r['單月年增%']), 'numeric'], ['YoY3', r => pct(r['YoY3%']), 'numeric'],
  ['前3月YoY3', r => pct(r['前3月YoY3%']), 'numeric'], ['ACC', r => `<b class="up">${esc(r['ACC(pp)'])}</b> pp`, 'numeric'],
  ['G2', r => pct(r['G2%']), 'numeric'], ['連升', r => esc(r['連續上升月數']), 'numeric']];
const pct = v => v === '' || v == null ? '—' : `${esc(v)}%`;

function render() {
  const day = state.data.dates[state.day];
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#prev-day').disabled = state.day >= state.data.dates.length - 1;
  $('#next-day').disabled = state.day <= 0;
  const all = day[state.tab];
  const q = state.query.toLowerCase();
  state.rows = q ? all.filter(r => r.code.includes(q) || r.name.toLowerCase().includes(q)) : all;
  $('#count').textContent = `${state.rows.length} 檔`;
  $('#tab-note').textContent = state.tab === 'fresh'
    ? '全市場掃描：符合營收加速四項條件，且 YoY3 剛連升 2～3 個月、3 個月前 YoY3 < 10%、近 20 個交易日股價漲幅 < 10%。'
    : '當日強勢股與成交重心股中：ACC > 0、YoY3 連 2 個月上升、YoY3 ≥ 20%、最新月營收 ≥ 近 12 月最高的 95%。';
  const extra = state.tab === 'fresh' ? [['20日漲幅', r => pct(r['20日漲幅%']), 'numeric']] : [];
  const cols = [...COLS, ...extra, ['警示', r => (r['警示'] || '').split('、').filter(Boolean).map(f =>
    `<span class="flag"${f === '低基期' && r['低基期說明'] ? ` title="${esc(r['低基期說明'])}"` : ''}>${esc(f)}</span>`).join('')]];
  $('#thead').innerHTML = '<tr>' + cols.map(([h, , c]) => `<th class="${c || ''}">${h}</th>`).join('') + '</tr>';
  $('#tbody').innerHTML = state.rows.length ? state.rows.map((r, i) =>
    `<tr data-i="${i}">` + cols.map(([, f, c]) => `<td class="${c || ''}">${f(r)}</td>`).join('') + '</tr>').join('')
    : `<tr><td colspan="${cols.length}" class="empty">這一天沒有符合條件的股票。</td></tr>`;
  document.querySelectorAll('#tbody tr[data-i]').forEach(tr => tr.addEventListener('click', () => openDetail(Number(tr.dataset.i))));
}

// ---------------------------------------------------------------- detail + charts
function openDetail(i) {
  state.open = i;
  const r = state.rows[i], day = state.data.dates[state.day].date, s = state.data.stocks[r.code] || {rev: [], px: []};
  const R = Object.fromEntries(s.rev.filter(([m]) => m <= r['資料截至月']));
  $('#d-title').innerHTML = `${esc(r.code)} ${esc(r.name)}<small>資料截至 ${esc(r['資料截至月'])}・名單日期 ${esc(day)}</small>`;
  $('#d-pos').textContent = `${i + 1} / ${state.rows.length}`;
  $('#d-prev').disabled = i <= 0;
  $('#d-next').disabled = i >= state.rows.length - 1;
  const flags = (r['警示'] || '').split('、').filter(Boolean);
  $('#d-stats').innerHTML = [['YoY3', pct(r['YoY3%'])], ['前3月 YoY3', pct(r['前3月YoY3%'])], ['ACC', `${esc(r['ACC(pp)'])} pp`],
    ['G2（兩年）', pct(r['G2%'])], ['連續上升', `${esc(r['連續上升月數'])} 個月`], ['最新月營收', `${esc(r['最新月營收(億)'])} 億`]]
    .map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  $('#d-flags').innerHTML = flags.length ? '警示：' + flags.map(f => `<span class="flag">${esc(f)}</span>`).join('') : '';
  $('#d-notes').innerHTML = lowBaseNotes(r);
  $('#d-notes').hidden = !$('#d-notes').innerHTML;
  const months = Array.from({length: 18}, (_, k) => mshift(r['資料截至月'], k - 17));
  $('#c-rev').innerHTML = revenueChart(R, months);
  $('#c-yoy').innerHTML = yoyChart(R, months);
  $('#c-px').innerHTML = priceChart(s.px || [], day);
  $('#detail').hidden = false;
  document.body.classList.add('noscroll');
}

// 低基期: why the growth rate looks so big, and announcements that may explain the jump
function lowBaseNotes(r) {
  if (!r['低基期說明']) return '';
  const items = (r['公告'] || []).slice(0, 4).map(a => `<li><span>${esc(a.date)}・${esc(a.category)}</span>${esc(a.subject)}`
    + (a.why ? `<em>${esc(a.why)}</em>` : '') + '</li>').join('');
  return `<h3>為什麼成長率這麼高</h3><p><b>去年賺得少：</b>${esc(r['低基期說明'])}。</p>`
    + (r['可能原因'] ? `<p><b>可能原因：</b>${esc(r['可能原因'])}</p>` : '')
    + (items ? `<ul>${items}</ul>` : '')
    + '<small>可能原因依公司重大訊息主旨與產業別推估，只是線索，請再查證公告內容。</small>';
}

function closeDetail() {
  state.open = -1;
  $('#detail').hidden = true;
  document.body.classList.remove('noscroll');
}

const W = 720, H = 230, PAD = {l: 56, r: 14, t: 14, b: 34};
const scale = (v, lo, hi, a, b) => hi === lo ? (a + b) / 2 : a + (v - lo) / (hi - lo) * (b - a);
function axisY(lo, hi, fmt, ticks = 4) {
  let out = '';
  for (let k = 0; k <= ticks; k++) {
    const v = lo + (hi - lo) * k / ticks, y = scale(v, lo, hi, H - PAD.b, PAD.t);
    out += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" class="grid"/><text x="${PAD.l - 6}" y="${y + 4}" class="tick" text-anchor="end">${fmt(v)}</text>`;
  }
  return out;
}
function axisX(labels, xs, every = 1) {
  return labels.map((l, k) => k % every ? '' : `<text x="${xs[k]}" y="${H - 12}" class="tick" text-anchor="middle">${esc(l)}</text>`).join('');
}

function revenueChart(R, months) {
  const vals = months.map(m => R[m] ?? null), present = vals.filter(v => v != null);
  if (!present.length) return '<p class="empty">沒有營收資料</p>';
  const hi = Math.max(...present) * 1.08, bw = (W - PAD.l - PAD.r) / months.length;
  const xs = months.map((_, k) => PAD.l + bw * (k + 0.5));
  let bars = '';
  months.forEach((m, k) => {
    const v = vals[k];
    if (v == null) return;
    const hist = Array.from({length: 12}, (_, j) => R[mshift(m, -j)]).filter(x => x != null);
    const high = hist.length >= 10 && v >= Math.max(...hist);
    const y = scale(v, 0, hi, H - PAD.b, PAD.t);
    bars += `<rect x="${xs[k] - bw * 0.36}" y="${y}" width="${bw * 0.72}" height="${H - PAD.b - y}" class="${high ? 'bar-high' : 'bar'}"><title>${m}：${v.toFixed(2)} 億${high ? '（12 個月新高）' : ''}</title></rect>`;
  });
  const last = vals.at(-1);
  const label = last != null ? `<text x="${xs.at(-1)}" y="${scale(last, 0, hi, H - PAD.b, PAD.t) - 5}" class="value" text-anchor="middle">${last.toFixed(2)}</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 18 個月營收">${axisY(0, hi, v => v.toFixed(2))}${bars}${label}${axisX(months.map(m => m.slice(2).replace('-', '/')), xs, 2)}</svg>`;
}

function line(points, cls) {
  let d = '', pen = false;
  for (const p of points) {
    if (!p) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d ? `<path d="${d}" class="${cls}"/>` : '';
}

function yoyChart(R, months) {
  const y1 = months.map(m => yoy1(R, m)), y3 = months.map(m => yoy3(R, m));
  const all = [...y1, ...y3, 0].filter(v => v != null).map(v => v * 100);
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 5;
  const a = lo - pad, b = hi + pad, bw = (W - PAD.l - PAD.r) / months.length;
  const xs = months.map((_, k) => PAD.l + bw * (k + 0.5)), Y = v => scale(v * 100, a, b, H - PAD.b, PAD.t);
  const dots = y3.map((v, k) => v == null ? '' : `<circle cx="${xs[k]}" cy="${Y(v)}" r="3.2" class="dot3"><title>${months[k]}：YoY3 ${(v * 100).toFixed(1)}%${y1[k] != null ? `，單月年增 ${(y1[k] * 100).toFixed(1)}%` : ''}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="單月年增率與 YoY3">${axisY(a, b, v => v.toFixed(1) + '%')}
    <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>
    ${line(y1.map((v, k) => v == null ? null : [xs[k], Y(v)]), 'yoy1')}${line(y3.map((v, k) => v == null ? null : [xs[k], Y(v)]), 'yoy3')}${dots}
    ${axisX(months.map(m => m.slice(2).replace('-', '/')), xs, 2)}</svg>`;
}

function priceChart(px, day) {
  const rows = px.slice(-160);
  if (rows.length < 2) return '<p class="empty">沒有官方行情資料</p>';
  const closes = rows.map(r => r[1]);
  const sma = closes.map((_, k) => k < 19 ? null : closes.slice(k - 19, k + 1).reduce((a, v) => a + v, 0) / 20);
  const vals = [...closes, ...sma.filter(v => v != null)], lo = Math.min(...vals) * 0.97, hi = Math.max(...vals) * 1.03;
  const xs = rows.map((_, k) => scale(k, 0, rows.length - 1, PAD.l, W - PAD.r)), Y = v => scale(v, lo, hi, H - PAD.b, PAD.t);
  const di = rows.findIndex(r => r[0] >= day);
  const mark = di >= 0 ? `<line x1="${xs[di]}" x2="${xs[di]}" y1="${PAD.t}" y2="${H - PAD.b}" class="mark"/><text x="${xs[di] + 4}" y="${PAD.t + 12}" class="mark-text">名單日 ${esc(rows[di][1])}</text>` : '';
  const ticks = [0, Math.floor(rows.length / 3), Math.floor(rows.length * 2 / 3), rows.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="收盤價與 20 日均線">${axisY(lo, hi, v => v.toFixed(v >= 100 ? 0 : 1))}
    ${line(sma.map((v, k) => v == null ? null : [xs[k], Y(v)]), 'sma')}${line(closes.map((v, k) => [xs[k], Y(v)]), 'close')}${mark}
    ${ticks.map(k => `<text x="${xs[k]}" y="${H - 12}" class="tick" text-anchor="middle">${esc(rows[k][0].slice(5))}</text>`).join('')}</svg>`;
}

if (typeof document !== 'undefined') {
  $('#d-close').addEventListener('click', closeDetail);
  $('#detail').addEventListener('click', e => { if (e.target.id === 'detail') closeDetail(); });
  $('#d-prev').addEventListener('click', () => openDetail(state.open - 1));
  $('#d-next').addEventListener('click', () => openDetail(state.open + 1));
  boot();
}
