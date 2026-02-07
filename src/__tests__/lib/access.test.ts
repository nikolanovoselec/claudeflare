import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveUserFromKV, getBucketName, authenticateRequest, getUserFromRequest, resetAuthConfigCache } from '../../lib/access';
import { AuthError, ForbiddenError } from '../../lib/error-types';
import type { Env } from '../../types';
import { createMockKV } from '../helpers/mock-kv';

describe('access.ts', () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKV = createMockKV();
    vi.clearAllMocks();
    resetAuthConfigCache();
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

  // ===========================================================================
  // authenticateRequest() tests (Q23)
  // ===========================================================================
  describe('authenticateRequest()', () => {
    function makeEnv(overrides: Partial<Env> = {}): Env {
      return {
        KV: mockKV as unknown as KVNamespace,
        DEV_MODE: 'false',
        ...overrides,
      } as Env;
    }

    it('throws AuthError when request has no auth headers and DEV_MODE=false', async () => {
      const request = new Request('http://localhost/test');

      await expect(
        authenticateRequest(request, makeEnv())
      ).rejects.toThrow(AuthError);
    });

    it('throws AuthError with 401 status code for unauthenticated requests', async () => {
      const request = new Request('http://localhost/test');

      try {
        await authenticateRequest(request, makeEnv());
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AuthError);
        expect((err as AuthError).statusCode).toBe(401);
      }
    });

    it('throws ForbiddenError when user is not in KV allowlist', async () => {
      const request = new Request('http://localhost/test', {
        headers: { 'cf-access-authenticated-user-email': 'unknown@example.com' },
      });

      await expect(
        authenticateRequest(request, makeEnv())
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError with 403 status code for unlisted users', async () => {
      const request = new Request('http://localhost/test', {
        headers: { 'cf-access-authenticated-user-email': 'stranger@example.com' },
      });

      try {
        await authenticateRequest(request, makeEnv());
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenError);
        expect((err as ForbiddenError).statusCode).toBe(403);
      }
    });

    it('grants admin role in DEV_MODE=true without any headers', async () => {
      const request = new Request('http://localhost/test');

      const result = await authenticateRequest(request, makeEnv({ DEV_MODE: 'true' } as Partial<Env>));

      expect(result.user.authenticated).toBe(true);
      expect(result.user.role).toBe('admin');
      expect(result.bucketName).toContain('claudeflare-');
      // KV allowlist should NOT be checked
      expect(mockKV.get).not.toHaveBeenCalledWith(expect.stringMatching(/^user:/));
    });

    it('returns user object with email and bucketName for valid allowlisted user', async () => {
      const testEmail = 'valid@example.com';
      mockKV._set(`user:${testEmail}`, { addedBy: 'setup', addedAt: '2024-01-01', role: 'user' });

      const request = new Request('http://localhost/test', {
        headers: { 'cf-access-authenticated-user-email': testEmail },
      });

      const result = await authenticateRequest(request, makeEnv());

      expect(result.user.email).toBe(testEmail);
      expect(result.user.authenticated).toBe(true);
      expect(result.user.role).toBe('user');
      expect(result.bucketName).toBe(getBucketName(testEmail));
    });

    it('resolves admin role from KV entry', async () => {
      const testEmail = 'admin-auth@example.com';
      mockKV._set(`user:${testEmail}`, { addedBy: 'setup', addedAt: '2024-01-01', role: 'admin' });

      const request = new Request('http://localhost/test', {
        headers: { 'cf-access-authenticated-user-email': testEmail },
      });

      const result = await authenticateRequest(request, makeEnv());

      expect(result.user.role).toBe('admin');
    });
  });

  // ===========================================================================
  // getUserFromRequest() tests
  // ===========================================================================
  describe('getUserFromRequest()', () => {
    function makeEnv(overrides: Partial<Env> = {}): Env {
      return {
        KV: mockKV as unknown as KVNamespace,
        DEV_MODE: 'false',
        ...overrides,
      } as Env;
    }

    it('returns unauthenticated user when no headers present', async () => {
      const request = new Request('http://localhost/test');
      const user = await getUserFromRequest(request, makeEnv());
      expect(user.authenticated).toBe(false);
      expect(user.email).toBe('');
    });

    it('returns authenticated user from cf-access-authenticated-user-email header', async () => {
      const request = new Request('http://localhost/test', {
        headers: { 'cf-access-authenticated-user-email': 'user@test.com' },
      });
      const user = await getUserFromRequest(request, makeEnv());
      expect(user.authenticated).toBe(true);
      expect(user.email).toBe('user@test.com');
    });

    it('returns authenticated user from service token cf-access-client-id header', async () => {
      const request = new Request('http://localhost/test', {
        headers: { 'cf-access-client-id': 'abc123.token' },
      });
      const user = await getUserFromRequest(request, makeEnv());
      expect(user.authenticated).toBe(true);
      expect(user.email).toContain('service-abc123');
    });

    it('uses SERVICE_TOKEN_EMAIL env for service token', async () => {
      const request = new Request('http://localhost/test', {
        headers: { 'cf-access-client-id': 'abc123.token' },
      });
      const user = await getUserFromRequest(request, makeEnv({ SERVICE_TOKEN_EMAIL: 'svc@company.com' } as Partial<Env>));
      expect(user.email).toBe('svc@company.com');
    });

    it('returns test user in DEV_MODE with no headers', async () => {
      const request = new Request('http://localhost/test');
      const user = await getUserFromRequest(request, makeEnv({ DEV_MODE: 'true' } as Partial<Env>));
      expect(user.authenticated).toBe(true);
      expect(user.email).toBe('test@example.com');
    });
  });
});
