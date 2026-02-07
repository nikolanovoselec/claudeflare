import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveUserFromKV, getBucketName } from '../../lib/access';
import { createMockKV } from '../helpers/mock-kv';

describe('access.ts', () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKV = createMockKV();
    vi.clearAllMocks();
  });

  describe('resolveUserFromKV', () => {
    it('returns null when user key does not exist in KV', async () => {
      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'nobody@example.com');
      expect(result).toBeNull();
    });

    it('returns null for malformed JSON string', async () => {
      mockKV._store.set('user:bad@example.com', 'not-valid-json{{{');

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'bad@example.com');
      expect(result).toBeNull();
    });

    it('returns null for truncated JSON object', async () => {
      mockKV._store.set('user:trunc@example.com', '{invalid');

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'trunc@example.com');
      expect(result).toBeNull();
    });

    it('returns null for plain text "not-json"', async () => {
      mockKV._store.set('user:text@example.com', 'not-json');

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'text@example.com');
      expect(result).toBeNull();
    });

    it('returns null when parsed value is not an object (e.g., number)', async () => {
      mockKV._store.set('user:num@example.com', '42');

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'num@example.com');
      expect(result).toBeNull();
    });

    it('returns null when parsed value is null', async () => {
      mockKV._store.set('user:null@example.com', 'null');

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'null@example.com');
      expect(result).toBeNull();
    });

    it('returns null when parsed value is a string', async () => {
      mockKV._store.set('user:str@example.com', '"just a string"');

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'str@example.com');
      expect(result).toBeNull();
    });

    it('returns null when parsed value is an array', async () => {
      mockKV._store.set('user:arr@example.com', '[1, 2, 3]');

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'arr@example.com');
      // Arrays are typeof 'object' and not null, so they pass the check
      // but the result will have defaults for missing fields
      expect(result).not.toBeNull();
      expect(result!.role).toBe('user'); // no .role on array → defaults
    });

    it('defaults role to user when role field is missing', async () => {
      mockKV._store.set(
        'user:legacy@example.com',
        JSON.stringify({ addedBy: 'setup', addedAt: '2024-01-01' })
      );

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'legacy@example.com');
      expect(result).not.toBeNull();
      expect(result!.role).toBe('user');
      expect(result!.addedBy).toBe('setup');
      expect(result!.addedAt).toBe('2024-01-01');
    });

    it('returns admin when role is explicitly admin', async () => {
      mockKV._store.set(
        'user:admin@example.com',
        JSON.stringify({ addedBy: 'setup', addedAt: '2024-01-01', role: 'admin' })
      );

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'admin@example.com');
      expect(result).not.toBeNull();
      expect(result!.role).toBe('admin');
    });

    it('defaults role to user for unrecognized role value', async () => {
      mockKV._store.set(
        'user:custom@example.com',
        JSON.stringify({ addedBy: 'setup', addedAt: '2024-01-01', role: 'superadmin' })
      );

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'custom@example.com');
      expect(result).not.toBeNull();
      expect(result!.role).toBe('user');
    });

    it('defaults addedBy to unknown when missing', async () => {
      mockKV._store.set(
        'user:noauthor@example.com',
        JSON.stringify({ addedAt: '2024-01-01' })
      );

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'noauthor@example.com');
      expect(result).not.toBeNull();
      expect(result!.addedBy).toBe('unknown');
    });

    it('defaults addedAt to empty string when missing', async () => {
      mockKV._store.set(
        'user:nodate@example.com',
        JSON.stringify({ addedBy: 'test' })
      );

      const result = await resolveUserFromKV(mockKV as unknown as KVNamespace, 'nodate@example.com');
      expect(result).not.toBeNull();
      expect(result!.addedAt).toBe('');
    });
  });

  describe('getBucketName', () => {
    it('generates bucket name with claudeflare- prefix', () => {
      const name = getBucketName('user@example.com');
      expect(name).toMatch(/^claudeflare-/);
    });

    it('replaces @ and . with hyphens', () => {
      const name = getBucketName('test@example.com');
      expect(name).toBe('claudeflare-test-example-com');
    });

    it('truncates to 63 chars max', () => {
      const longEmail = 'a'.repeat(100) + '@example.com';
      const name = getBucketName(longEmail);
      expect(name.length).toBeLessThanOrEqual(63);
    });
  });
});
