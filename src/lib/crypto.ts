/**
 * @dormant Reserved for future credential encryption feature.
 * Currently only used in tests. The ENCRYPTION_KEY env var is
 * defined in types.ts but not wired into production routes.
 */

/**
 * AES-GCM encryption utilities for credentials at rest
 *
 * Uses the Web Crypto API (available in Cloudflare Workers) to provide
 * authenticated encryption with associated data (AEAD).
 *
 * Security properties:
 * - AES-256-GCM provides confidentiality and integrity
 * - 96-bit random IV ensures uniqueness
 * - Authentication tag prevents tampering
 */

/** Algorithm name for all operations */
const ALGORITHM = 'AES-GCM';

/** Key length in bits (256-bit AES) */
const KEY_LENGTH = 256;

/** IV length in bytes (96 bits recommended for GCM) */
const IV_LENGTH = 12;

/**
 * Generate a new AES-256-GCM encryption key
 *
 * The key is extractable so it can be stored in environment secrets.
 *
 * @example
 * ```typescript
 * const key = await generateEncryptionKey();
 * const base64Key = await exportKeyToBase64(key);
 * // Store base64Key in ENCRYPTION_KEY secret
 * console.log(base64Key);
 * ```
 *
 * @returns A new CryptoKey suitable for encryption and decryption
 */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable for export if needed
    ['encrypt', 'decrypt']
  );
  // generateKey returns CryptoKey for symmetric algorithms
  return key as CryptoKey;
}

/**
 * Import an encryption key from a base64-encoded string
 *
 * Use this to restore a key stored in environment secrets.
 *
 * @example
 * ```typescript
 * const key = await importKeyFromBase64(env.ENCRYPTION_KEY);
 * const decrypted = await decrypt(encryptedCredentials, key);
 * ```
 *
 * @param base64Key - Base64-encoded raw key bytes (from exportKeyToBase64)
 * @returns CryptoKey ready for encryption/decryption
 */
export async function importKeyFromBase64(base64Key: string): Promise<CryptoKey> {
  const keyData = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: ALGORITHM, length: KEY_LENGTH },
    false, // imported keys don't need to be extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Export an encryption key to a base64-encoded string
 *
 * Use this to generate a key that can be stored as an environment secret.
 *
 * @example
 * ```typescript
 * const key = await generateEncryptionKey();
 * const base64 = await exportKeyToBase64(key);
 * // Set as ENCRYPTION_KEY secret:
 * // echo "base64-key-here" | wrangler secret put ENCRYPTION_KEY
 * ```
 *
 * @param key - CryptoKey to export
 * @returns Base64-encoded raw key bytes
 */
export async function exportKeyToBase64(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', key);
  // exportKey('raw', ...) returns ArrayBuffer for symmetric keys
  return btoa(String.fromCharCode(...new Uint8Array(exported as ArrayBuffer)));
}

/**
 * Encrypt a string using AES-256-GCM
 *
 * Output format: base64(IV || ciphertext || authTag)
 * - IV: 12 random bytes
 * - ciphertext: encrypted data
 * - authTag: 16 bytes (included in ciphertext by Web Crypto)
 *
 * @example
 * ```typescript
 * const key = await importKeyFromBase64(env.ENCRYPTION_KEY);
 * const credentials = JSON.stringify({ accessToken: '...', refreshToken: '...' });
 * const encrypted = await encrypt(credentials, key);
 * // Store encrypted string in R2
 * ```
 *
 * @param data - Plaintext string to encrypt
 * @param key - CryptoKey for encryption
 * @returns Base64-encoded ciphertext (includes IV)
 */
export async function encrypt(data: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(data);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded
  );

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a string that was encrypted with encrypt()
 *
 * @example
 * ```typescript
 * const key = await importKeyFromBase64(env.ENCRYPTION_KEY);
 * const encrypted = await env.STORAGE.get('credentials.enc');
 * const decrypted = await decrypt(encrypted, key);
 * const credentials = JSON.parse(decrypted);
 * ```
 *
 * @param encrypted - Base64-encoded ciphertext from encrypt()
 * @param key - CryptoKey for decryption (must match encryption key)
 * @returns Original plaintext string
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export async function decrypt(encrypted: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}
