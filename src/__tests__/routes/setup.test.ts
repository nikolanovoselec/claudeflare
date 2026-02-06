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
    list: vi.fn(async (opts?: { prefix?: string }) => {
      const prefix = opts?.prefix || '';
      const keys = Array.from(store.keys())
        .filter(k => k.startsWith(prefix))
        .map(k => ({ name: k }));
      return { keys };
    }),
    _store: store,
    _clear: () => store.clear(),
  };
}

// Mock fetch for Cloudflare API calls
function createMockFetch() {
  return vi.fn();
}

// Standard env token for configure tests
const TEST_TOKEN = 'env-api-token';

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
        CLOUDFLARE_API_TOKEN: TEST_TOKEN,
        ...envOverrides,
      } as Env;
      return next();
    });

    app.route('/api/setup', setupRoutes);
    return app;
  }

  // Helper: mock a successful configure flow (accounts + R2 creds + 3 secrets)
  function mockSuccessfulBaseFlow() {
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
    // Mock secret setting (3 secrets: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, ADMIN_SECRET)
    for (let i = 0; i < 3; i++) {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
    }
  }

  // Helper: mock custom domain flow (zone + subdomain + DNS lookup + DNS create + route)
  function mockCustomDomainFlow() {
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
        JSON.stringify({ success: true, result: { subdomain: 'test-account' } }),
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
  }

  // Helper: mock access app creation flow
  function mockAccessAppFlow() {
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
  }

  // Standard body for configure requests
  const standardBody = {
    customDomain: 'claude.example.com',
    allowedUsers: ['user@example.com'],
  };

  describe('GET /api/setup/status', () => {
    it('returns configured: false and tokenDetected: true when setup is not complete', async () => {
      const app = createTestApp();
      mockKV.get.mockResolvedValue(null);

      const res = await app.request('/api/setup/status');
      expect(res.status).toBe(200);

      const body = await res.json() as { configured: boolean; tokenDetected: boolean };
      expect(body.configured).toBe(false);
      expect(body.tokenDetected).toBe(true);
    });

    it('returns configured: true and tokenDetected: true when setup is complete', async () => {
      const app = createTestApp();
      mockKV.get.mockResolvedValue('true');

      const res = await app.request('/api/setup/status');
      expect(res.status).toBe(200);

      const body = await res.json() as { configured: boolean; tokenDetected: boolean };
      expect(body.configured).toBe(true);
      expect(body.tokenDetected).toBe(true);
    });

    it('returns tokenDetected: false when CLOUDFLARE_API_TOKEN is not set', async () => {
      const app = createTestApp({ CLOUDFLARE_API_TOKEN: '' as unknown as string });
      mockKV.get.mockResolvedValue(null);

      const res = await app.request('/api/setup/status');
      expect(res.status).toBe(200);

      const body = await res.json() as { configured: boolean; tokenDetected: boolean };
      expect(body.configured).toBe(false);
      expect(body.tokenDetected).toBe(false);
    });

    it('checks setup:complete key in KV', async () => {
      const app = createTestApp();
      await app.request('/api/setup/status');

      expect(mockKV.get).toHaveBeenCalledWith('setup:complete');
    });
  });

  describe('POST /api/setup/configure', () => {
    it('returns 400 when customDomain is missing', async () => {
      const app = createTestApp();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedUsers: ['user@example.com'] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when allowedUsers is missing', async () => {
      const app = createTestApp();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customDomain: 'claude.example.com' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when allowedUsers is empty array', async () => {
      const app = createTestApp();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customDomain: 'claude.example.com', allowedUsers: [] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string; code: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('reads token from env, not from request body', async () => {
      const app = createTestApp({ CLOUDFLARE_API_TOKEN: 'my-env-token' });

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
      });

      expect(res.status).toBe(200);

      // Verify CF API was called with the env token, not a body token
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts',
        expect.objectContaining({
          headers: { Authorization: 'Bearer my-env-token' },
        })
      );
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
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
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

    it('sets only 3 secrets (not CLOUDFLARE_API_TOKEN)', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
      });

      // Find all secret-setting calls (PUT to /secrets)
      const secretCalls = mockFetch.mock.calls.filter(
        call => typeof call[0] === 'string' &&
          call[0].includes('/secrets') &&
          (call[1] as RequestInit)?.method === 'PUT'
      );
      expect(secretCalls).toHaveLength(3);

      // Extract secret names
      const secretNames = secretCalls.map(call => {
        const body = JSON.parse((call[1] as RequestInit).body as string);
        return body.name;
      });
      expect(secretNames).toContain('R2_ACCESS_KEY_ID');
      expect(secretNames).toContain('R2_SECRET_ACCESS_KEY');
      expect(secretNames).toContain('ADMIN_SECRET');
      expect(secretNames).not.toContain('CLOUDFLARE_API_TOKEN');
    });

    it('stores users in KV as user:{email} entries', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDomain: 'claude.example.com',
          allowedUsers: ['alice@example.com', 'bob@example.com'],
        }),
      });

      expect(res.status).toBe(200);

      // Verify user entries stored in KV
      expect(mockKV.put).toHaveBeenCalledWith(
        'user:alice@example.com',
        expect.stringContaining('"addedBy":"setup"')
      );
      expect(mockKV.put).toHaveBeenCalledWith(
        'user:bob@example.com',
        expect.stringContaining('"addedBy":"setup"')
      );
    });

    it('stores setup completion in KV', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
      });

      expect(mockKV.put).toHaveBeenCalledWith('setup:complete', 'true');
      expect(mockKV.put).toHaveBeenCalledWith('setup:account_id', 'acc123');
      expect(mockKV.put).toHaveBeenCalledWith('setup:completed_at', expect.any(String));
    });

    it('handles custom domain configuration with DNS and route', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDomain: 'claude.example.com',
          allowedUsers: ['user@example.com'],
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
      const dnsCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].includes('/dns_records') &&
          (call[1] as RequestInit)?.body !== undefined
      );
      expect(dnsCall).toBeDefined();
      const dnsBody = JSON.parse(dnsCall![1]?.body as string);
      expect(dnsBody.type).toBe('CNAME');
      expect(dnsBody.name).toBe('claude');
      expect(dnsBody.content).toBe('claudeflare.test-account.workers.dev');
      expect(dnsBody.proxied).toBe(true);
    });

    it('uses email includes from allowedUsers for access policy', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDomain: 'claude.example.com',
          allowedUsers: ['alice@example.com', 'bob@example.com'],
        }),
      });

      // Find the access policy creation call
      const policyCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' &&
          call[0].includes('/policies') &&
          (call[1] as RequestInit)?.method === 'POST'
      );
      expect(policyCall).toBeDefined();
      const policyBody = JSON.parse(policyCall![1]?.body as string);
      expect(policyBody.include).toEqual([
        { email: { email: 'alice@example.com' } },
        { email: { email: 'bob@example.com' } },
      ]);
    });

    it('returns permission error when zones API returns 403 for custom domain', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
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
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
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
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
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
          JSON.stringify({ success: true, result: { subdomain: 'test-account' } }),
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
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
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
          JSON.stringify({ success: true, result: { subdomain: 'test-account' } }),
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
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
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
          JSON.stringify({ success: true, result: { subdomain: 'test-account' } }),
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
      // Mock DNS record creation - already exists (code 81057)
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
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
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
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean };
      expect(body.success).toBe(true);

      // Verify DNS record was created with fallback subdomain from hostname
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

    it('stores R2 endpoint in KV during configure', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
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

      // Retry first secret + remaining 2 secrets (all succeed) = 3 total
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      // Custom domain + access app flows
      mockCustomDomainFlow();
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
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

      // Retry first secret (succeeds) + remaining 2 secrets = 3 total
      for (let i = 0; i < 3; i++) {
        mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      }

      // Custom domain + access app flows
      mockCustomDomainFlow();
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { accountId: string };
      expect(body.accountId).toBe('acc123');
    });

    it('updates existing DNS record instead of failing when record exists', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
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
          JSON.stringify({ success: true, result: { subdomain: 'test-account' } }),
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
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
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
          customDomain: 'claude.example.com',
          allowedUsers: ['user@example.com'],
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

      mockSuccessfulBaseFlow();
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
          JSON.stringify({ success: true, result: { subdomain: 'test-account' } }),
          { status: 200 }
        )
      );
      // Mock DNS record lookup - fails with network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      // Mock DNS record creation (POST) - success
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      // Mock worker route creation
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));
      mockAccessAppFlow();

      const res = await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
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

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
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
        body: JSON.stringify(standardBody),
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

    it('stores combined allowedOrigins in KV including custom domain and .workers.dev', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDomain: 'claude.example.com',
          allowedUsers: ['user@example.com'],
          allowedOrigins: ['https://app.example.com', 'https://dev.example.com'],
        }),
      });

      // Should contain user-provided origins + custom domain + .workers.dev
      const putCall = mockKV.put.mock.calls.find(
        (call: [string, string]) => call[0] === 'setup:allowed_origins'
      );
      expect(putCall).toBeDefined();
      const storedOrigins = JSON.parse(putCall![1]) as string[];
      expect(storedOrigins).toContain('https://app.example.com');
      expect(storedOrigins).toContain('https://dev.example.com');
      expect(storedOrigins).toContain('claude.example.com');
      expect(storedOrigins).toContain('.workers.dev');
    });

    it('stores allowedOrigins with custom domain and .workers.dev even when no user origins provided', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDomain: 'claude.example.com',
          allowedUsers: ['user@example.com'],
        }),
      });

      const putCall = mockKV.put.mock.calls.find(
        (call: [string, string]) => call[0] === 'setup:allowed_origins'
      );
      expect(putCall).toBeDefined();
      const storedOrigins = JSON.parse(putCall![1]) as string[];
      expect(storedOrigins).toContain('claude.example.com');
      expect(storedOrigins).toContain('.workers.dev');
    });

    it('stores custom domain in KV', async () => {
      const app = createTestApp();

      mockSuccessfulBaseFlow();
      mockCustomDomainFlow();
      mockAccessAppFlow();

      await app.request('https://claudeflare.test.workers.dev/api/setup/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(standardBody),
      });

      expect(mockKV.put).toHaveBeenCalledWith('setup:custom_domain', 'claude.example.com');
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
