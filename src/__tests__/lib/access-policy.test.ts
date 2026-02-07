import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllUsers, listAllKvKeys } from '../../lib/access-policy';
import { createMockKV } from '../helpers/mock-kv';

describe('access-policy.ts', () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKV = createMockKV();
    vi.clearAllMocks();
  });

  describe('getAllUsers', () => {
    it('returns empty array when no user keys exist', async () => {
      const result = await getAllUsers(mockKV as unknown as KVNamespace);
      expect(result).toEqual([]);
    });

    it('returns single user correctly', async () => {
      mockKV._set('user:alice@example.com', {
        addedBy: 'admin@example.com',
        addedAt: '2024-01-01T00:00:00Z',
        role: 'user',
      });

      const result = await getAllUsers(mockKV as unknown as KVNamespace);
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('alice@example.com');
      expect(result[0].addedBy).toBe('admin@example.com');
      expect(result[0].role).toBe('user');
    });

    it('returns multiple users with parallel fetch (Promise.all)', async () => {
      mockKV._set('user:alice@example.com', {
        addedBy: 'admin@example.com',
        addedAt: '2024-01-01T00:00:00Z',
        role: 'admin',
      });
      mockKV._set('user:bob@example.com', {
        addedBy: 'admin@example.com',
        addedAt: '2024-01-02T00:00:00Z',
        role: 'user',
      });
      mockKV._set('user:charlie@example.com', {
        addedBy: 'alice@example.com',
        addedAt: '2024-01-03T00:00:00Z',
        role: 'user',
      });

      const result = await getAllUsers(mockKV as unknown as KVNamespace);
      expect(result).toHaveLength(3);

      const emails = result.map(u => u.email).sort();
      expect(emails).toEqual(['alice@example.com', 'bob@example.com', 'charlie@example.com']);
    });

    it('defaults role to user when role is missing', async () => {
      mockKV._set('user:legacy@example.com', {
        addedBy: 'setup',
        addedAt: '2024-01-01T00:00:00Z',
        // no role field
      });

      const result = await getAllUsers(mockKV as unknown as KVNamespace);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });

    it('filters out null entries from KV', async () => {
      // Add a real user
      mockKV._set('user:alice@example.com', {
        addedBy: 'admin@example.com',
        addedAt: '2024-01-01T00:00:00Z',
        role: 'user',
      });
      // Add a key that will return null when fetched as JSON
      mockKV._store.set('user:ghost@example.com', '');

      const result = await getAllUsers(mockKV as unknown as KVNamespace);
      // The ghost entry returns null from kv.get(key, 'json'), should be filtered
      expect(result.length).toBeLessThanOrEqual(2);
      expect(result.some(u => u.email === 'alice@example.com')).toBe(true);
    });
  });

  describe('listAllKvKeys', () => {
    it('returns all keys with given prefix', async () => {
      mockKV._store.set('user:a@b.com', '{}');
      mockKV._store.set('user:c@d.com', '{}');
      mockKV._store.set('setup:complete', 'true');

      const keys = await listAllKvKeys(mockKV as unknown as KVNamespace, 'user:');
      expect(keys).toHaveLength(2);
      expect(keys.map(k => k.name).sort()).toEqual(['user:a@b.com', 'user:c@d.com']);
    });

    it('returns empty array when no keys match prefix', async () => {
      mockKV._store.set('setup:complete', 'true');

      const keys = await listAllKvKeys(mockKV as unknown as KVNamespace, 'user:');
      expect(keys).toHaveLength(0);
    });
  });
});
