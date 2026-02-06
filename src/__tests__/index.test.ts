import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types';

// Create a minimal Hono app to use as mock route default export
const mockHonoApp = new Hono();

// Mock all route modules to prevent import side effects and provide valid Hono apps
vi.mock('../routes/terminal', () => ({
  default: new Hono(),
  validateWebSocketRoute: vi.fn(() => ({ isWebSocketRoute: false })),
  handleWebSocketUpgrade: vi.fn(),
}));
vi.mock('../routes/user', () => ({ default: new Hono() }));
vi.mock('../routes/container/index', () => ({ default: new Hono() }));
vi.mock('../routes/session/index', () => ({ default: new Hono() }));
vi.mock('../routes/credentials', () => ({ default: new Hono() }));
vi.mock('../routes/setup', () => {
  const app = new Hono();
  // Provide a minimal /status endpoint so tests for /api/setup/status work
  app.get('/status', (c) => c.json({ configured: false }));
  return { default: app };
});
vi.mock('../routes/admin', () => ({ default: new Hono() }));

// Import after mocks are set up
import worker, { resetSetupCache } from '../index';
import { validateWebSocketRoute, handleWebSocketUpgrade } from '../routes/terminal';

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

function createMockEnv(): { env: Env; mockKV: ReturnType<typeof createMockKV>; mockAssets: { fetch: ReturnType<typeof vi.fn> } } {
  const mockKV = createMockKV();
  const mockAssets = {
    fetch: vi.fn(async () => new Response('SPA content', { status: 200 })),
  };

  const env = {
    KV: mockKV as unknown as KVNamespace,
    ASSETS: mockAssets as unknown as Fetcher,
    ADMIN_SECRET: 'test-admin-secret',
    DEV_MODE: 'false',
  } as Env;

  return { env, mockKV, mockAssets };
}

function createMockCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

describe('Edge-level setup redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the in-memory cache before each test
    resetSetupCache();

    // Reset the terminal mock to default (not a WebSocket route)
    vi.mocked(validateWebSocketRoute).mockReturnValue({ isWebSocketRoute: false });
  });

  it('redirects GET / to /setup when setup:complete is not set in KV', async () => {
    const { env, mockKV } = createMockEnv();
    mockKV.get.mockResolvedValue(null);

    const request = new Request('https://example.com/');
    const response = await worker.fetch(request, env, createMockCtx());

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/setup');
  });

  it('does NOT redirect GET /setup (no redirect loop)', async () => {
    const { env, mockKV, mockAssets } = createMockEnv();
    mockKV.get.mockResolvedValue(null);

    const request = new Request('https://example.com/setup');
    const response = await worker.fetch(request, env, createMockCtx());

    // Should pass through to ASSETS, not redirect
    expect(response.status).toBe(200);
    expect(mockAssets.fetch).toHaveBeenCalled();
  });

  it('does NOT redirect GET /api/health', async () => {
    const { env, mockKV } = createMockEnv();
    mockKV.get.mockResolvedValue(null);

    const request = new Request('https://example.com/api/health');
    const response = await worker.fetch(request, env, createMockCtx());

    // API routes go through Hono, not redirected
    expect(response.status).not.toBe(302);
    // /api/health returns JSON from Hono
    expect(response.status).toBe(200);
    const body = await response.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('does NOT redirect GET /api/setup/status', async () => {
    const { env, mockKV } = createMockEnv();
    mockKV.get.mockResolvedValue(null);

    const request = new Request('https://example.com/api/setup/status');
    const response = await worker.fetch(request, env, createMockCtx());

    // API routes go through Hono, not redirected
    expect(response.status).not.toBe(302);
    expect(response.status).toBe(200);
  });

  it('passes through to ASSETS when setup:complete is true in KV', async () => {
    const { env, mockKV, mockAssets } = createMockEnv();
    mockKV.get.mockResolvedValue('true');

    const request = new Request('https://example.com/');
    const response = await worker.fetch(request, env, createMockCtx());

    // Should serve SPA content, not redirect
    expect(response.status).toBe(200);
    expect(mockAssets.fetch).toHaveBeenCalled();
  });

  it('does NOT affect WebSocket upgrade requests', async () => {
    const { env, mockKV } = createMockEnv();
    mockKV.get.mockResolvedValue(null);

    // Mock WebSocket route handling - use 200 since Workers runtime doesn't allow 101
    // In real Workers, WebSocket upgrades return 101 via the runtime, but mocks use 200
    const wsResponse = new Response(null, { status: 200 });
    vi.mocked(validateWebSocketRoute).mockReturnValue({
      isWebSocketRoute: true,
      errorResponse: undefined,
    } as ReturnType<typeof validateWebSocketRoute>);
    vi.mocked(handleWebSocketUpgrade).mockResolvedValue(wsResponse);

    const request = new Request('https://example.com/api/terminal/abc123-1/ws', {
      headers: { Upgrade: 'websocket' },
    });
    const response = await worker.fetch(request, env, createMockCtx());

    // WebSocket route was detected and handled (not redirected to /setup)
    expect(response.status).toBe(200);
    expect(handleWebSocketUpgrade).toHaveBeenCalled();
    // KV should NOT have been checked since WebSocket is handled before redirect logic
    expect(mockKV.get).not.toHaveBeenCalled();
  });

  it('caches setup status in memory after first KV check', async () => {
    const { env, mockKV, mockAssets } = createMockEnv();
    mockKV.get.mockResolvedValue('true');

    const ctx = createMockCtx();

    // First request - should hit KV
    await worker.fetch(new Request('https://example.com/'), env, ctx);
    expect(mockKV.get).toHaveBeenCalledTimes(1);

    // Second request - should use cached value, not hit KV again
    await worker.fetch(new Request('https://example.com/dashboard'), env, ctx);
    expect(mockKV.get).toHaveBeenCalledTimes(1);

    // Both should pass through to ASSETS
    expect(mockAssets.fetch).toHaveBeenCalledTimes(2);
  });

  it('resetSetupCache clears the in-memory cache', async () => {
    const { env, mockKV } = createMockEnv();
    // First: setup complete
    mockKV.get.mockResolvedValue('true');

    const ctx = createMockCtx();
    await worker.fetch(new Request('https://example.com/'), env, ctx);
    expect(mockKV.get).toHaveBeenCalledTimes(1);

    // Reset cache
    resetSetupCache();

    // Now setup is NOT complete
    mockKV.get.mockResolvedValue(null);
    const response = await worker.fetch(new Request('https://example.com/'), env, ctx);

    // Should have checked KV again and redirected
    expect(mockKV.get).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/setup');
  });

  it('does NOT redirect GET /health', async () => {
    const { env, mockKV } = createMockEnv();
    mockKV.get.mockResolvedValue(null);

    const request = new Request('https://example.com/health');
    const response = await worker.fetch(request, env, createMockCtx());

    // /health goes through Hono, not redirected
    expect(response.status).not.toBe(302);
    expect(response.status).toBe(200);
  });

  it('redirects non-root SPA paths when setup is not complete', async () => {
    const { env, mockKV } = createMockEnv();
    mockKV.get.mockResolvedValue(null);

    const request = new Request('https://example.com/dashboard');
    const response = await worker.fetch(request, env, createMockCtx());

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/setup');
  });

  it('does NOT redirect paths starting with /setup (subpaths)', async () => {
    const { env, mockKV, mockAssets } = createMockEnv();
    mockKV.get.mockResolvedValue(null);

    const request = new Request('https://example.com/setup/step-2');
    const response = await worker.fetch(request, env, createMockCtx());

    // Should pass through to ASSETS, not redirect
    expect(response.status).toBe(200);
    expect(mockAssets.fetch).toHaveBeenCalled();
  });
});
