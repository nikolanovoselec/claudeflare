import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import setupRoutes from '../../routes/setup';
import type { Env } from '../../types';
import { ValidationError, AuthError, SetupError } from '../../lib/error-types';

// Mock KV storage
function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) || null),
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

// Mock fetch for Cloudflare API calls
function createMockFetch() {
  return vi.fn();
}

describe('Setup Routes', () => {
  let mockKV: ReturnType<typeof createMockKV>;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mockKV = createMockKV();
    mockFetch = createMockFetch();
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function createTestApp(envOverrides: Partial<Env> = {}) {
    const app = new Hono<{ Bindings: Env }>();

    // Error handler
    app.onError((err, c) => {
      if (err instanceof ValidationError) {
        return c.json(err.toJSON(), err.statusCode as ContentfulStatusCode);
      }
      if (err instanceof AuthError) {
        return c.json(err.toJSON(), err.statusCode as ContentfulStatusCode);
      }
      if (err instanceof SetupError) {
        return c.json(err.toJSON(), err.statusCode as ContentfulStatusCode);
      }
      return c.json({ error: err.message }, 500);
    });

    // Set up mock env
    app.use('*', async (c, next) => {
      c.env = {
        KV: mockKV as unknown as KVNamespace,
        ADMIN_SECRET: 'test-admin-secret',
        DEV_MODE: 'false',
        ...envOverrides,
      } as Env;
      return next();
    });

    app.route('/api/setup', setupRoutes);
    return app;
  }

  describe('GET /api/setup/status', () => {
    it('returns configured: false when setup is not complete', async () => {
      const app = createTestApp();
      mockKV.get.mockResolvedValue(null);

      const res = await app.request('/api/setup/status');
      expect(res.status).toBe(200);

      const body = await res.json() as { configured: boolean; requiredPermissions?: string[] };
      expect(body.configured).toBe(false);
      expect(body.requiredPermissions).toBeDefined();
      expect(body.requiredPermissions).toContain('Account > Workers Scripts > Edit');
    });

    it('returns configured: true when setup is complete', async () => {
      const app = createTestApp();
      mockKV.get.mockResolvedValue('true');

      const res = await app.request('/api/setup/status');
      expect(res.status).toBe(200);

      const body = await res.json() as { configured: boolean; requiredPermissions?: string[] };
      expect(body.configured).toBe(true);
      expect(body.requiredPermissions).toBeUndefined();
    });

    it('checks setup:complete key in KV', async () => {
      const app = createTestApp();
      await app.request('/api/setup/status');

      expect(mockKV.get).toHaveBeenCalledWith('setup:complete');
    });
  });

  describe('POST /api/setup/verify-token', () => {
    it('returns 400 when token is missing', async () => {
      const app = createTestApp();

      const res = await app.request('/api/setup/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 when token is invalid', async () => {
      const app = createTestApp();
      mockFetch.mockResolvedValue(new Response('', { status: 401 }));

      const res = await app.request('/api/setup/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'invalid-token' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json() as { error: string; code: string };
      expect(body.code).toBe('AUTH_ERROR');
    });

    it('returns valid: true with account info when token is valid', async () => {
      const app = createTestApp();

      // Mock token verification
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock accounts fetch
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [{ id: 'acc123', name: 'Test Account' }],
          }),
          { status: 200 }
        )
      );

      const res = await app.request('/api/setup/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { valid: boolean; account: { id: string; name: string } };
      expect(body.valid).toBe(true);
      expect(body.account.id).toBe('acc123');
      expect(body.account.name).toBe('Test Account');
    });

    it('calls Cloudflare API with correct authorization header', async () => {
      const app = createTestApp();
      mockFetch.mockResolvedValue(new Response('', { status: 401 }));

      await app.request('/api/setup/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'my-api-token' }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/user/tokens/verify',
        expect.objectContaining({
          headers: { Authorization: 'Bearer my-api-token' },
        })
      );
    });

    it('returns 400 when accounts fetch fails', async () => {
      const app = createTestApp();

      // Mock token verification success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock accounts fetch failure
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: false, result: [] }),
          { status: 200 }
        )
      );

      const res = await app.request('/api/setup/verify-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/setup/configure', () => {
    it('returns 400 when token is missing', async () => {
      const app = createTestApp();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns error when get_account step fails', async () => {
      const app = createTestApp();

      // Mock accounts fetch failure
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: false, result: [] }),
          { status: 200 }
        )
      );

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { success: boolean; steps: Array<{ step: string; status: string }> };
      expect(body.success).toBe(false);
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'get_account', status: 'error' })
      );
    });

    it('progresses through steps correctly on success', async () => {
      const app = createTestApp();

      // Mock accounts fetch success
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );

      // Mock R2 credential derivation (token verify to get ID)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { id: 'r2-key-id', status: 'active' },
          }),
          { status: 200 }
        )
      );

      // Mock secret setting (4 secrets)
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
        adminSecret: string;
      };
      expect(body.success).toBe(true);
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'get_account', status: 'success' })
      );
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'create_r2_token', status: 'success' })
      );
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'set_secrets', status: 'success' })
      );
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'finalize', status: 'success' })
      );
      expect(body.adminSecret).toBeDefined();
    });

    it('stores setup completion in KV', async () => {
      const app = createTestApp();

      // Mock successful configuration
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(mockKV.put).toHaveBeenCalledWith('setup:complete', 'true');
      expect(mockKV.put).toHaveBeenCalledWith('setup:account_id', 'acc123');
      expect(mockKV.put).toHaveBeenCalledWith('setup:completed_at', expect.any(String));
    });

    it('handles custom domain configuration with DNS and route', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation (token verify to get ID)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup (for workers.dev target)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { subdomain: 'nikola-novoselec' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - no existing record
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock DNS record creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock worker route creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock Access app lookup - no existing app
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock access app creation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'app123' } }),
          { status: 200 }
        )
      );
      // Mock access policy creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
          accessPolicy: { type: 'email', emails: ['user@example.com'] },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        customDomainUrl: string | null;
        steps: Array<{ step: string; status: string }>;
      };
      expect(body.success).toBe(true);
      expect(body.customDomainUrl).toBe('https://claude.example.com');
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'configure_custom_domain', status: 'success' })
      );
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'create_access_app', status: 'success' })
      );

      // Verify DNS record creation was called with correct parameters
      // Find the DNS call that has a body (POST/PUT, not GET lookup)
      const dnsCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].includes('/dns_records') &&
          (call[1] as RequestInit)?.body !== undefined
      );
      expect(dnsCall).toBeDefined();
      const dnsBody = JSON.parse(dnsCall![1]?.body as string);
      expect(dnsBody.type).toBe('CNAME');
      expect(dnsBody.name).toBe('claude');
      expect(dnsBody.content).toBe('claudeflare.nikola-novoselec.workers.dev');
      expect(dnsBody.proxied).toBe(true);
    });

    it('returns permission error when zones API returns 403 for custom domain', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup - 403 auth error (token lacks Zone permissions)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }],
            result: [],
          }),
          { status: 403 }
        )
      );

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as {
        success: boolean;
        error: string;
        steps: Array<{ step: string; status: string; error?: string }>;
      };
      expect(body.success).toBe(false);
      expect(body.error).toContain('Zone permissions');
      expect(body.steps).toContainEqual(
        expect.objectContaining({
          step: 'configure_custom_domain',
          status: 'error',
          error: expect.stringContaining('Zone permissions'),
        })
      );
    });

    it('returns permission error when zones API returns authentication error message', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup - success: false with authentication error in message
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 9103, message: 'Unknown X-Auth-Key or X-Auth-Email' }],
            result: null,
          }),
          { status: 400 }
        )
      );

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as {
        success: boolean;
        error: string;
        steps: Array<{ step: string; status: string; error?: string }>;
      };
      expect(body.success).toBe(false);
      expect(body.error).toContain('Zone permissions');
    });

    it('returns permission error when worker route creation returns auth error', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup - success (token can read zones)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { subdomain: 'nikola-novoselec' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - no existing record
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock DNS record creation - success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock worker route creation - 403 auth error
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }],
          }),
          { status: 403 }
        )
      );

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as {
        success: boolean;
        error: string;
        steps: Array<{ step: string; status: string; error?: string }>;
      };
      expect(body.success).toBe(false);
      expect(body.error).toContain('Zone permissions');
      expect(body.error).toContain('worker route');
    });

    it('returns permission error when DNS record creation returns auth error', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup - success
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { subdomain: 'nikola-novoselec' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - no existing record
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock DNS record creation - 403 auth error
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: 'Authentication error' }],
          }),
          { status: 403 }
        )
      );

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as {
        success: boolean;
        error: string;
        steps: Array<{ step: string; status: string; error?: string }>;
      };
      expect(body.success).toBe(false);
      expect(body.error).toContain('DNS permissions');
    });

    it('continues when DNS record already exists (code 81057)', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { subdomain: 'nikola-novoselec' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - no existing record (simulates race condition where lookup doesn't find it)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock DNS record creation - already exists (code 81057) - race condition
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 81057, message: 'The record already exists.' }],
          }),
          { status: 400 }
        )
      );
      // Mock worker route creation - success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock Access app lookup - no existing app
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock access app creation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'app123' } }),
          { status: 200 }
        )
      );
      // Mock access policy creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
          accessPolicy: { type: 'everyone' },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
      };
      expect(body.success).toBe(true);
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'configure_custom_domain', status: 'success' })
      );
    });

    it('uses hostname from workers.dev URL when subdomain API fails', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup - fails (API error)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: false, result: null }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - no existing record
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock DNS record creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock worker route creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock Access app lookup - no existing app
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock access app creation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'app123' } }),
          { status: 200 }
        )
      );
      // Mock access policy creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      // Request from workers.dev hostname - subdomain is extracted from this
      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
          accessPolicy: { type: 'everyone' },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);

      // Verify DNS record was created with fallback subdomain from hostname
      // Find the DNS call that has a body (POST/PUT, not GET lookup)
      const dnsCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].includes('/dns_records') &&
          (call[1] as RequestInit)?.body !== undefined
      );
      expect(dnsCall).toBeDefined();
      const dnsBody = JSON.parse(dnsCall![1]?.body as string);
      // Should use 'test' as the account subdomain from 'claudeflare.test.workers.dev'
      expect(dnsBody.content).toBe('claudeflare.test.workers.dev');
    });

    it('does not run custom domain step when customDomain is not provided', async () => {
      const app = createTestApp();

      // Mock successful configuration (no custom domain)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
        customDomainUrl: string | null;
      };
      expect(body.success).toBe(true);
      expect(body.customDomainUrl).toBeNull();
      // Should NOT contain custom domain or access app steps
      expect(body.steps).not.toContainEqual(
        expect.objectContaining({ step: 'configure_custom_domain' })
      );
      expect(body.steps).not.toContainEqual(
        expect.objectContaining({ step: 'create_access_app' })
      );
    });

    it('does not run custom domain step when customDomain is empty string', async () => {
      const app = createTestApp();

      // Mock successful configuration
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token', customDomain: '' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
        customDomainUrl: string | null;
      };
      expect(body.success).toBe(true);
      expect(body.customDomainUrl).toBeNull();
      expect(body.steps).not.toContainEqual(
        expect.objectContaining({ step: 'configure_custom_domain' })
      );
    });

    it('stores R2 endpoint in KV during configure', async () => {
      const app = createTestApp();

      // Mock successful configuration
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(mockKV.put).toHaveBeenCalledWith(
        'setup:r2_endpoint',
        'https://acc123.r2.cloudflarestorage.com'
      );
    });

    it('falls back to deploying latest version when secrets API returns error 10215', async () => {
      const app = createTestApp();

      // Mock accounts fetch success
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );

      // Mock R2 credential derivation (token verify to get ID)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { id: 'r2-key-id', status: 'active' },
          }),
          { status: 200 }
        )
      );

      // First secret attempt: fails with error 10215 (version not deployed)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10215, message: 'Secret edit failed. Latest version not deployed.' }]
          }),
          { status: 400 }
        )
      );

      // Fallback: list versions
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { items: [{ id: 'version-abc-123' }] }
          }),
          { status: 200 }
        )
      );

      // Fallback: deploy latest version
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'deploy-123' } }),
          { status: 200 }
        )
      );

      // Retry first secret + remaining 3 secrets (all succeed)
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
        adminSecret: string;
      };
      expect(body.success).toBe(true);
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'set_secrets', status: 'success' })
      );
      expect(body.adminSecret).toBeDefined();

      // Verify the versions list and deployment calls were made
      const fetchCalls = mockFetch.mock.calls.map(call => call[0]);
      expect(fetchCalls).toContainEqual(
        expect.stringContaining('/workers/scripts/claudeflare/versions')
      );
      expect(fetchCalls).toContainEqual(
        expect.stringContaining('/workers/scripts/claudeflare/deployments')
      );
    });

    it('only deploys latest version once even if multiple secrets fail with 10215', async () => {
      const app = createTestApp();

      // Mock accounts fetch success
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );

      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { id: 'r2-key-id', status: 'active' },
          }),
          { status: 200 }
        )
      );

      // First secret: fails with 10215
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10215, message: 'Latest version not deployed.' }]
          }),
          { status: 400 }
        )
      );

      // Fallback: list versions + deploy
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { items: [{ id: 'version-abc' }] }
          }),
          { status: 200 }
        )
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'deploy-1' } }),
          { status: 200 }
        )
      );

      // Retry first secret (succeeds) + remaining 3 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(res.status).toBe(200);

      // Count deployment calls - should be exactly 1
      const deploymentCalls = mockFetch.mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('/deployments')
      );
      expect(deploymentCalls).toHaveLength(1);
    });

    it('returns accountId in configure response', async () => {
      const app = createTestApp();

      // Mock successful configuration
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'valid-token' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { accountId: string };
      expect(body.accountId).toBe('acc123');
    });

    it('updates existing DNS record instead of failing when record exists', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { subdomain: 'nikola-novoselec' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - returns existing CNAME record
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [{ id: 'dns-record-123', type: 'CNAME' }],
          }),
          { status: 200 }
        )
      );
      // Mock DNS record UPDATE (PUT) - success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock worker route creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock Access app lookup - no existing app
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock access app creation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'app123' } }),
          { status: 200 }
        )
      );
      // Mock access policy creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
          accessPolicy: { type: 'everyone' },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
      };
      expect(body.success).toBe(true);
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'configure_custom_domain', status: 'success' })
      );

      // Verify DNS record was updated with PUT, not created with POST
      const dnsUpdateCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].includes('/dns_records/dns-record-123') &&
          (call[1] as RequestInit)?.method === 'PUT'
      );
      expect(dnsUpdateCall).toBeDefined();
    });

    it('updates existing Access app instead of failing when app exists', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { subdomain: 'nikola-novoselec' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - no existing record
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock DNS record creation (POST) - success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock worker route creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock Access app lookup - returns existing app for this domain
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [{ id: 'existing-app-456', domain: 'claude.example.com', name: 'Claudeflare' }],
          }),
          { status: 200 }
        )
      );
      // Mock Access app UPDATE (PUT) - success
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'existing-app-456' } }),
          { status: 200 }
        )
      );
      // Mock Access policy lookup - returns existing policy
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: [{ id: 'policy-789', name: 'Allow users' }],
          }),
          { status: 200 }
        )
      );
      // Mock Access policy UPDATE (PUT) - success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
          accessPolicy: { type: 'email', emails: ['user@example.com'] },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
      };
      expect(body.success).toBe(true);
      expect(body.steps).toContainEqual(
        expect.objectContaining({ step: 'create_access_app', status: 'success' })
      );

      // Verify Access app was updated with PUT, not created with POST
      const accessAppUpdateCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].includes('/access/apps/existing-app-456') &&
          (call[1] as RequestInit)?.method === 'PUT'
      );
      expect(accessAppUpdateCall).toBeDefined();

      // Verify Access policy was updated with PUT
      const policyUpdateCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].includes('/policies/policy-789') &&
          (call[1] as RequestInit)?.method === 'PUT'
      );
      expect(policyUpdateCall).toBeDefined();
    });

    it('falls back to create when DNS record lookup fails', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { subdomain: 'nikola-novoselec' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - fails with network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      // Mock DNS record creation (POST) - success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock worker route creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock Access app lookup - no existing app
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock access app creation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'app123' } }),
          { status: 200 }
        )
      );
      // Mock access policy creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
          accessPolicy: { type: 'everyone' },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
      };
      expect(body.success).toBe(true);

      // Verify DNS record was created with POST (fallback behavior)
      const dnsCreateCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].endsWith('/dns_records') &&
          (call[1] as RequestInit)?.method === 'POST'
      );
      expect(dnsCreateCall).toBeDefined();
    });

    it('falls back to create when Access app lookup fails', async () => {
      const app = createTestApp();

      // Mock accounts
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'acc123' }] }),
          { status: 200 }
        )
      );
      // Mock R2 credential derivation
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'r2-id', status: 'active' } }),
          { status: 200 }
        )
      );
      // Mock 4 secrets
      for (let i = 0; i < 4; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }
      // Mock zone lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [{ id: 'zone123' }] }),
          { status: 200 }
        )
      );
      // Mock subdomain lookup
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { subdomain: 'nikola-novoselec' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - no existing record
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: [] }),
          { status: 200 }
        )
      );
      // Mock DNS record creation (POST) - success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock worker route creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock Access app lookup - fails with network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      // Mock access app creation (POST) - success
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: 'app123' } }),
          { status: 200 }
        )
      );
      // Mock access policy creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: 'valid-token',
          customDomain: 'claude.example.com',
          accessPolicy: { type: 'everyone' },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as {
        success: boolean;
        steps: Array<{ step: string; status: string }>;
      };
      expect(body.success).toBe(true);

      // Verify Access app was created with POST (fallback behavior)
      const accessCreateCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].endsWith('/access/apps') &&
          (call[1] as RequestInit)?.method === 'POST'
      );
      expect(accessCreateCall).toBeDefined();
    });
  });

  describe('POST /api/setup/reset', () => {
    it('returns 401 when no auth header provided', async () => {
      const app = createTestApp();

      const res = await app.request('/api/setup/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      expect(res.status).toBe(401);
    });

    it('returns 401 when wrong admin secret provided', async () => {
      const app = createTestApp();

      const res = await app.request('/api/setup/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-secret',
        },
      });

      expect(res.status).toBe(401);
    });

    it('clears setup state with correct admin secret', async () => {
      const app = createTestApp();

      const res = await app.request('/api/setup/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-admin-secret',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);

      expect(mockKV.delete).toHaveBeenCalledWith('setup:complete');
      expect(mockKV.delete).toHaveBeenCalledWith('setup:account_id');
      expect(mockKV.delete).toHaveBeenCalledWith('setup:completed_at');
      expect(mockKV.delete).toHaveBeenCalledWith('setup:custom_domain');
      expect(mockKV.delete).toHaveBeenCalledWith('setup:r2_endpoint');
    });
  });

  describe('POST /api/setup/reset-for-tests', () => {
    it('returns 401 when DEV_MODE is not true', async () => {
      const app = createTestApp({ DEV_MODE: 'false' });

      const res = await app.request('/api/setup/reset-for-tests', {
        method: 'POST',
      });

      expect(res.status).toBe(401);
    });

    it('clears setup:complete when DEV_MODE is true', async () => {
      const app = createTestApp({ DEV_MODE: 'true' });

      const res = await app.request('/api/setup/reset-for-tests', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockKV.delete).toHaveBeenCalledWith('setup:complete');
    });
  });

  describe('POST /api/setup/restore-for-tests', () => {
    it('returns 401 when DEV_MODE is not true', async () => {
      const app = createTestApp({ DEV_MODE: 'false' });

      const res = await app.request('/api/setup/restore-for-tests', {
        method: 'POST',
      });

      expect(res.status).toBe(401);
    });

    it('restores setup:complete when DEV_MODE is true', async () => {
      const app = createTestApp({ DEV_MODE: 'true' });

      const res = await app.request('/api/setup/restore-for-tests', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);
      expect(mockKV.put).toHaveBeenCalledWith('setup:complete', 'true');
    });
  });
});
