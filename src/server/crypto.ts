import 'server-only';

const ENV_VAR = 'APP_ENCRYPTION_KEY';
const PAYLOAD_VERSION = 'v1';
const EXPECTED_KEY_BYTES = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Imports the AES-256-GCM key from APP_ENCRYPTION_KEY (base64, 32 bytes).
 * Generate one with: openssl rand -base64 32
 *
 * @throws When the variable is missing, not valid base64, or not 32 bytes.
 */
async function importEncryptionKey(): Promise<CryptoKey> {
  const raw = process.env[ENV_VAR];
  if (!raw || raw.trim() === '') {
    throw new Error(
      `[crypto] Missing ${ENV_VAR} environment variable. Generate one with: openssl rand -base64 32`,
    );
  }

  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base64ToBytes(raw.trim());
  } catch {
    throw new Error(`[crypto] ${ENV_VAR} is not valid base64.`);
  }

  if (keyBytes.length !== EXPECTED_KEY_BYTES) {
    throw new Error(
      `[crypto] ${ENV_VAR} must decode to ${EXPECTED_KEY_BYTES} bytes, got ${keyBytes.length}.`,
    );
  }

  return globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a secret (e.g. a future WhatsApp provider token) with AES-256-GCM.
 * Returns a versioned `v1.<iv-base64>.<ciphertext-base64>` payload string
 * that is safe to store in a text column.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  if (typeof plaintext !== 'string' || plaintext === '') {
    throw new Error('[crypto] plaintext must be a non-empty string.');
  }
  const key = await importEncryptionKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return `${PAYLOAD_VERSION}.${bytesToBase64(iv)}.${bytesToBase64(ciphertext)}`;
}

/**
 * Decrypts a payload produced by `encryptSecret`.
 *
 * @throws When the payload is malformed or authentication fails (wrong key or
 *         tampered data both surface here — fail closed, no details leaked).
 */
export async function decryptSecret(payload: string): Promise<string> {
  const parts = typeof payload === 'string' ? payload.split('.') : [];
  if (parts.length !== 3 || parts[0] !== PAYLOAD_VERSION) {
    throw new Error('[crypto] Malformed encrypted payload.');
  }

  const key = await importEncryptionKey();
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    iv = base64ToBytes(parts[1] ?? '');
    ciphertext = base64ToBytes(parts[2] ?? '');
  } catch {
    throw new Error('[crypto] Malformed encrypted payload.');
  }
  if (iv.length !== 12 || ciphertext.length === 0) {
    throw new Error('[crypto] Malformed encrypted payload.');
  }

  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('[crypto] Decryption failed.');
  }
}
