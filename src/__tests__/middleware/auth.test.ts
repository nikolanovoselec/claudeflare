import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware, AuthVariables } from '../../middleware/auth';
import type { Env } from '../../types';
import { createMockKV } from '../helpers/mock-kv';

describe('Auth Middleware', () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKV = createMockKV();
    vi.clearAllMocks();
  });

  function createTestApp(envOverrides: Partial<Env> = {}) {
    const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

    // Set up mock env
    app.use('*', async (c, next) => {
      c.env = {
        KV: mockKV as unknown as KVNamespace,
        DEV_MODE: 'false',
        ...envOverrides,
      } as Env;
      return next();
    });

    // Apply auth middleware
    app.use('*', authMiddleware);

    // Test endpoint that returns the auth variables
    app.get('/test', (c) => {
      const user = c.get('user');
      const bucketName = c.get('bucketName');
      return c.json({ user, bucketName });
    });

    return app;
  }

  it('passes through and sets user + bucketName when user is in KV allowlist', async () => {
    const testEmail = 'allowed@example.com';
    mockKV._store.set(`user:${testEmail}`, JSON.stringify({ addedBy: 'setup', addedAt: '2024-01-01' }));

    const app = createTestApp();
    const res = await app.request('/test', {
      headers: {
        'cf-access-authenticated-user-email': testEmail,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { user: { email: string; authenticated: boolean }; bucketName: string };
    expect(body.user.email).toBe(testEmail);
    expect(body.user.authenticated).toBe(true);
    expect(body.bucketName).toContain('claudeflare-');
    // Verify KV was checked for the user entry
    expect(mockKV.get).toHaveBeenCalledWith(`user:${testEmail}`);
  });

  it('returns 403 Forbidden when user is NOT in KV allowlist', async () => {
    const testEmail = 'notallowed@example.com';
    // Do NOT add user to KV store

    const app = createTestApp();
    const res = await app.request('/test', {
      headers: {
        'cf-access-authenticated-user-email': testEmail,
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Forbidden');
    // Verify KV was checked
    expect(mockKV.get).toHaveBeenCalledWith(`user:${testEmail}`);
  });

  it('bypasses KV allowlist check when DEV_MODE=true', async () => {
    const app = createTestApp({ DEV_MODE: 'true' } as Partial<Env>);

    // In DEV_MODE, getUserFromRequest returns a test user even without headers
    const res = await app.request('/test');

    expect(res.status).toBe(200);
    const body = await res.json() as { user: { email: string; authenticated: boolean }; bucketName: string };
    expect(body.user.authenticated).toBe(true);
    expect(body.bucketName).toContain('claudeflare-');
    // KV should NOT have been called for user lookup
    expect(mockKV.get).not.toHaveBeenCalledWith(expect.stringMatching(/^user:/));
  });

  it('returns 401 when unauthenticated (no CF Access headers, DEV_MODE=false)', async () => {
    const app = createTestApp({ DEV_MODE: 'false' } as Partial<Env>);

    // No CF Access headers, DEV_MODE is false
    const res = await app.request('/test');

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Not authenticated');
    // KV should NOT have been called since auth failed before allowlist check
    expect(mockKV.get).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Role resolution tests
  // =========================================================================
  describe('Role resolution', () => {
    it('sets role to admin when KV entry has role: admin', async () => {
      const testEmail = 'admin@example.com';
      mockKV._store.set(
        `user:${testEmail}`,
        JSON.stringify({ addedBy: 'setup', addedAt: '2024-01-01', role: 'admin' })
      );

      const app = createTestApp();
      const res = await app.request('/test', {
        headers: { 'cf-access-authenticated-user-email': testEmail },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { user: { email: string; role: string } };
      expect(body.user.role).toBe('admin');
    });

    it('defaults to role user when KV entry has no role field (legacy migration)', async () => {
      const testEmail = 'legacy@example.com';
      // Simulate a legacy KV entry without the role field
      mockKV._store.set(
        `user:${testEmail}`,
        JSON.stringify({ addedBy: 'setup', addedAt: '2024-01-01' })
      );

      const app = createTestApp();
      const res = await app.request('/test', {
        headers: { 'cf-access-authenticated-user-email': testEmail },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { user: { email: string; role: string } };
      expect(body.user.role).toBe('user');
    });

    it('grants admin role in DEV_MODE', async () => {
      const app = createTestApp({ DEV_MODE: 'true' } as Partial<Env>);

      const res = await app.request('/test');

      expect(res.status).toBe(200);
      const body = await res.json() as { user: { email: string; role: string } };
      expect(body.user.role).toBe('admin');
    });
  });
});
