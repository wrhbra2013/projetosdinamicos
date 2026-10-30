/* ============================================================================
   Criptografia — WebCrypto (PBKDF2, SHA-256, AES-GCM).
   Nada de senhas em texto puro e nada de bibliotecas externas.
   ========================================================================== */

const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_BACKUP_ITERATIONS = 150_000;

function assertCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador não expõe WebCrypto. Use HTTPS ou localhost.');
  }
}

export function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toB64(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function fromB64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function randomHex(bytes = 32) {
  assertCrypto();
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomToken(bytes = 32) {
  return randomHex(bytes);
}

export async function sha256Hex(input) {
  assertCrypto();
  const data = typeof input === 'string' ? enc.encode(input) : input;
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

async function deriveBits(password, salt, iterations) {
  assertCrypto();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256,
  ));
}

/** Formato: pbkdf2-sha256$<iterações>$<salt b64>$<hash b64> */
export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveBits(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toB64(salt)}$${toB64(derived)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterRaw, saltB64, hashB64] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2-sha256') return false;
    const iterations = Number(iterRaw);
    if (!Number.isFinite(iterations) || iterations < 10_000) return false;
    const salt = fromB64(saltB64);
    const expected = fromB64(hashB64);
    const derived = await deriveBits(password, salt, iterations);
    return constantTimeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function constantTimeEqual(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : a;
  const y = typeof b === 'string' ? enc.encode(b) : b;
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Deriva uma chave AES-GCM a partir de uma frase secreta. */
async function deriveAesKey(passphrase, salt, iterations, usage) {
  assertCrypto();
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/** Criptografa um objeto/JSON com AES-256-GCM. */
export async function encryptJson(value, passphrase) {
  assertCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_BACKUP_ITERATIONS, 'encrypt');
  const plaintext = enc.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_BACKUP_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(ciphertext),
    created_at: new Date().toISOString(),
  };
}

/** Descriptografa o envelope produzido por encryptJson. */
export async function decryptJson(envelope, passphrase) {
  assertCrypto();
  if (!envelope || envelope.v !== 1) throw new Error('Formato de arquivo desconhecido.');
  const salt = fromB64(envelope.salt);
  const iv = fromB64(envelope.iv);
  const key = await deriveAesKey(
    passphrase, salt, Number(envelope.iterations) || PBKDF2_BACKUP_ITERATIONS, 'decrypt',
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, fromB64(envelope.data),
  );
  return JSON.parse(dec.decode(plain));
}

export function shortHash(hash, size = 10) {
  return String(hash || '').slice(0, size);
}
