// Decryption for the password-protected 營收加速 page (counterpart of fc_score/site_export.py).
// key = PBKDF2-SHA256(password, salt, iterations) -> AES-256-GCM; file = 12-byte IV || ciphertext.
// The plaintext is gzip-compressed JSON. Works in browsers and in Node (WebCrypto + DecompressionStream).
const subtle = globalThis.crypto.subtle;

export const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const toB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export async function deriveKey(password, saltB64, iterations, extractable = false) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations},
    base, {name: 'AES-GCM', length: 256}, extractable, ['decrypt']);
}

export const importRawKey = rawB64 =>
  subtle.importKey('raw', fromB64(rawB64), {name: 'AES-GCM'}, true, ['decrypt']);

export async function exportRawKey(key) {
  return toB64(await subtle.exportKey('raw', key));
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Throws (OperationError) when the key is wrong: AES-GCM authentication fails.
export async function decryptPayload(key, blob) {
  const bytes = new Uint8Array(blob);
  const plain = await subtle.decrypt({name: 'AES-GCM', iv: bytes.subarray(0, 12)}, key, bytes.subarray(12));
  return JSON.parse(new TextDecoder().decode(await gunzip(plain)));
}
