import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware, AuthVariables } from '../../middleware/auth';
import type { Env } from '../../types';

// Mock KV storage
function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, format?: string) => {
      const val = store.get(key) || null;
      if (val && format === 'json') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [] })),
    _store: store,
    _clear: () => store.clear(),
  };
}

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
});
