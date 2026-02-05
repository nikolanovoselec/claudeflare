import { describe, it, expect } from 'vitest';
import {
  generateEncryptionKey,
  importKeyFromBase64,
  exportKeyToBase64,
  encrypt,
  decrypt,
} from '../../lib/crypto';

describe('crypto', () => {
  describe('generateEncryptionKey', () => {
    it('generates a CryptoKey', async () => {
      const key = await generateEncryptionKey();
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('generates extractable key', async () => {
      const key = await generateEncryptionKey();
      expect(key.extractable).toBe(true);
    });

    it('generates key with correct algorithm', async () => {
      const key = await generateEncryptionKey();
      expect(key.algorithm.name).toBe('AES-GCM');
      expect((key.algorithm as { length: number }).length).toBe(256);
    });

    it('generates key that can encrypt and decrypt', async () => {
      const key = await generateEncryptionKey();
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('generates unique keys', async () => {
      const key1 = await generateEncryptionKey();
      const key2 = await generateEncryptionKey();

      const exported1 = await exportKeyToBase64(key1);
      const exported2 = await exportKeyToBase64(key2);

      expect(exported1).not.toBe(exported2);
    });
  });

  describe('exportKeyToBase64 and importKeyFromBase64', () => {
    it('exports key to base64 string', async () => {
      const key = await generateEncryptionKey();
      const exported = await exportKeyToBase64(key);

      expect(typeof exported).toBe('string');
      // AES-256 key is 32 bytes, base64 encoded should be ~44 chars
      expect(exported.length).toBeGreaterThan(40);
    });

    it('imports key from base64 string', async () => {
      const original = await generateEncryptionKey();
      const exported = await exportKeyToBase64(original);
      const imported = await importKeyFromBase64(exported);

      expect(imported).toBeDefined();
      expect(imported.type).toBe('secret');
      expect(imported.algorithm.name).toBe('AES-GCM');
    });

    it('imported key can decrypt data encrypted by original', async () => {
      const original = await generateEncryptionKey();
      const exported = await exportKeyToBase64(original);
      const imported = await importKeyFromBase64(exported);

      const plaintext = 'Secret message';
      const encrypted = await encrypt(plaintext, original);
      const decrypted = await decrypt(encrypted, imported);

      expect(decrypted).toBe(plaintext);
    });

    it('roundtrip export/import preserves key functionality', async () => {
      const key = await generateEncryptionKey();
      const base64 = await exportKeyToBase64(key);
      const restored = await importKeyFromBase64(base64);

      const testData = 'Test data for roundtrip';
      const encrypted = await encrypt(testData, restored);
      const decrypted = await decrypt(encrypted, restored);

      expect(decrypted).toBe(testData);
    });
  });

  describe('encrypt', () => {
    it('returns base64 encoded string', async () => {
      const key = await generateEncryptionKey();
      const encrypted = await encrypt('test', key);

      expect(typeof encrypted).toBe('string');
      // Should be valid base64
      expect(() => atob(encrypted)).not.toThrow();
    });

    it('produces different output for same input (random IV)', async () => {
      const key = await generateEncryptionKey();
      const plaintext = 'Same message';

      const encrypted1 = await encrypt(plaintext, key);
      const encrypted2 = await encrypt(plaintext, key);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('handles empty string', async () => {
      const key = await generateEncryptionKey();
      const encrypted = await encrypt('', key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe('');
    });

    it('handles unicode characters', async () => {
      const key = await generateEncryptionKey();
      const plaintext = 'Hello 世界 🌍';
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('handles long strings', async () => {
      const key = await generateEncryptionKey();
      const plaintext = 'x'.repeat(10000);
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('handles JSON data', async () => {
      const key = await generateEncryptionKey();
      const data = {
        accessToken: 'token123',
        refreshToken: 'refresh456',
        expiresAt: 1234567890,
        scopes: ['read', 'write'],
      };
      const plaintext = JSON.stringify(data);

      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(JSON.parse(decrypted)).toEqual(data);
    });
  });

  describe('decrypt', () => {
    it('recovers original plaintext', async () => {
      const key = await generateEncryptionKey();
      const original = 'Original message';

      const encrypted = await encrypt(original, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toBe(original);
    });

    it('throws on wrong key', async () => {
      const key1 = await generateEncryptionKey();
      const key2 = await generateEncryptionKey();

      const encrypted = await encrypt('test', key1);

      // Decrypting with wrong key should throw
      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });

    it('throws on tampered ciphertext', async () => {
      const key = await generateEncryptionKey();
      const encrypted = await encrypt('test', key);

      // Tamper with the encrypted data
      const bytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
      bytes[20] = (bytes[20] + 1) % 256; // Modify a byte
      const tampered = btoa(String.fromCharCode(...bytes));

      await expect(decrypt(tampered, key)).rejects.toThrow();
    });

    it('throws on invalid base64', async () => {
      const key = await generateEncryptionKey();

      await expect(decrypt('not-valid-base64!!!', key)).rejects.toThrow();
    });

    it('throws on truncated ciphertext', async () => {
      const key = await generateEncryptionKey();
      const encrypted = await encrypt('test message', key);

      // Truncate the ciphertext
      const truncated = encrypted.slice(0, 10);

      await expect(decrypt(truncated, key)).rejects.toThrow();
    });
  });

  describe('encrypt/decrypt integration', () => {
    it('works with credential-like JSON', async () => {
      const key = await generateEncryptionKey();

      const credentials = {
        claudeAiOauth: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
          refreshToken: 'refresh_token_12345',
          expiresAt: Date.now() + 3600000,
          scopes: ['user:read', 'user:write', 'workspace:read'],
        },
      };

      const plaintext = JSON.stringify(credentials);
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);
      const restored = JSON.parse(decrypted);

      expect(restored).toEqual(credentials);
      expect(restored.claudeAiOauth.accessToken).toBe(credentials.claudeAiOauth.accessToken);
    });

    it('encrypted data is not readable without key', async () => {
      const key = await generateEncryptionKey();
      const secret = 'Super secret password: 12345';

      const encrypted = await encrypt(secret, key);

      // The encrypted data should not contain the plaintext
      expect(encrypted).not.toContain('Super secret');
      expect(encrypted).not.toContain('12345');
    });
  });
});
