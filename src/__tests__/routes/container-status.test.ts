import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import statusRoutes from '../../routes/container/status';
import type { Env } from '../../types';
import type { AuthVariables } from '../../middleware/auth';
import { ContainerError } from '../../lib/error-types';
import { createMockKV } from '../helpers/mock-kv';

// ---------------------------------------------------------------------------
// Mock container stub
// ---------------------------------------------------------------------------
function createMockContainer() {
  return {
    fetch: vi.fn().mockResolvedValue(new Response('', { status: 200 })),
    destroy: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue({ status: 'running' }),
    startAndWaitForPorts: vi.fn().mockResolvedValue(undefined),
  };
}

// Shared mutable state - vi.hoisted ensures this runs before vi.mock factories
const testState = vi.hoisted(() => ({
  container: null as ReturnType<typeof createMockContainer> | null,
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@cloudflare/containers', () => ({
  getContainer: vi.fn(() => testState.container),
}));

// Mock circuit breakers to be pass-through
vi.mock('../../lib/circuit-breakers', () => ({
  containerHealthCB: { execute: (fn: () => Promise<unknown>) => fn(), reset: vi.fn() },
  containerInternalCB: { execute: (fn: () => Promise<unknown>) => fn(), reset: vi.fn() },
  containerSessionsCB: { execute: (fn: () => Promise<unknown>) => fn(), reset: vi.fn() },
}));

describe('Container Status Routes', () => {
  let mockKV: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    mockKV = createMockKV();
    testState.container = createMockContainer();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createTestApp(bucketName = 'test-bucket') {
    const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

    // Error handler
    app.onError((err, c) => {
      if (err instanceof ContainerError) {
        return c.json(err.toJSON(), err.statusCode as ContentfulStatusCode);
      }
      return c.json({ error: err.message }, 500);
    });

    // Simulate auth middleware: set user, bucketName, and env
    app.use('*', async (c, next) => {
      c.env = {
        KV: mockKV as unknown as KVNamespace,
        CONTAINER: {} as DurableObjectNamespace,
      } as unknown as Env;
      c.set('user', { email: 'test@example.com', authenticated: true });
      c.set('bucketName', bucketName);
      return next();
    });

    app.route('/container', statusRoutes);
    return app;
  }

  // Helper: build a session ID query string
  const sessionQuery = '?sessionId=abcdef1234567890abcdef12';

  // =========================================================================
  // GET /container/health
  // =========================================================================
  describe('GET /container/health', () => {
    it('returns healthy status when container is healthy', async () => {
      const app = createTestApp();
      const healthData = { status: 'ok', cpu: '15%', mem: '256MB', hdd: '1.2GB' };
      testState.container!.fetch.mockResolvedValue(
        new Response(JSON.stringify(healthData), { status: 200 })
      );

      const res = await app.request(`/container/health${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; container: typeof healthData };
      expect(body.success).toBe(true);
      expect(body.container.status).toBe('ok');
      expect(body.container.cpu).toBe('15%');
    });

    it('returns 500 when health check fails', async () => {
      const app = createTestApp();
      testState.container!.fetch.mockResolvedValue(
        new Response('Service Unavailable', { status: 503 })
      );

      const res = await app.request(`/container/health${sessionQuery}`);

      expect(res.status).toBe(500);
      const body = await res.json() as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toContain('503');
    });

    it('returns 500 with error message when fetch throws', async () => {
      const app = createTestApp();
      testState.container!.fetch.mockRejectedValue(new Error('Network error'));

      const res = await app.request(`/container/health${sessionQuery}`);

      expect(res.status).toBe(500);
      const body = await res.json() as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toContain('Network error');
    });

    it('returns 500 when missing sessionId', async () => {
      const app = createTestApp();

      const res = await app.request('/container/health');

      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // GET /container/startup-status
  // =========================================================================
  describe('GET /container/startup-status', () => {
    it('returns stopped stage when container is not running', async () => {
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'stopped' });

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; progress: number };
      expect(body.stage).toBe('starting');
      expect(body.progress).toBe(10);
    });

    it('returns stopped stage when getState throws', async () => {
      const app = createTestApp();
      testState.container!.getState.mockRejectedValue(new Error('Not found'));

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; progress: number };
      expect(body.stage).toBe('stopped');
      expect(body.progress).toBe(0);
    });

    it('returns starting stage when health server is not ready', async () => {
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'running' });
      // Health server returns non-ok
      testState.container!.fetch.mockResolvedValue(
        new Response('', { status: 503 })
      );

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; progress: number; details: { healthServerOk: boolean } };
      expect(body.stage).toBe('starting');
      expect(body.progress).toBe(20);
      expect(body.details.healthServerOk).toBe(false);
    });

    it('returns syncing stage when sync is pending', async () => {
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'running' });
      // Health server responds with sync pending
      testState.container!.fetch.mockResolvedValue(
        new Response(JSON.stringify({
          status: 'ok',
          syncStatus: 'pending',
          terminalPid: 1234,
        }), { status: 200 })
      );

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; progress: number; details: { syncStatus: string } };
      expect(body.stage).toBe('syncing');
      expect(body.progress).toBe(30);
      expect(body.details.syncStatus).toBe('pending');
    });

    it('returns syncing stage at 45% when actively syncing', async () => {
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'running' });
      testState.container!.fetch.mockResolvedValue(
        new Response(JSON.stringify({
          status: 'ok',
          syncStatus: 'syncing',
          cpu: '25%',
          mem: '512MB',
        }), { status: 200 })
      );

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; progress: number; details: { cpu: string; mem: string } };
      expect(body.stage).toBe('syncing');
      expect(body.progress).toBe(45);
      expect(body.details.cpu).toBe('25%');
      expect(body.details.mem).toBe('512MB');
    });

    it('returns error stage when sync failed', async () => {
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'running' });
      testState.container!.fetch.mockResolvedValue(
        new Response(JSON.stringify({
          status: 'ok',
          syncStatus: 'failed',
          syncError: 'R2 bucket not accessible',
        }), { status: 200 })
      );

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; progress: number; error: string };
      expect(body.stage).toBe('error');
      expect(body.progress).toBe(0);
      expect(body.error).toBe('R2 bucket not accessible');
    });

    it('returns ready stage when all checks pass (sync success)', async () => {
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'running' });
      // All fetch calls succeed: health check, terminal health, sessions
      testState.container!.fetch.mockResolvedValue(
        new Response(JSON.stringify({
          status: 'ok',
          syncStatus: 'success',
          terminalPid: 5678,
          cpu: '10%',
          mem: '128MB',
          hdd: '500MB',
        }), { status: 200 })
      );

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as {
        stage: string;
        progress: number;
        message: string;
        details: { terminalServerOk: boolean; cpu: string };
      };
      expect(body.stage).toBe('ready');
      expect(body.progress).toBe(100);
      expect(body.message).toBe('Container ready (workspace synced)');
      expect(body.details.terminalServerOk).toBe(true);
      expect(body.details.cpu).toBe('10%');
    });

    it('returns ready stage with skipped message when sync skipped', async () => {
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'running' });
      testState.container!.fetch.mockResolvedValue(
        new Response(JSON.stringify({
          status: 'ok',
          syncStatus: 'skipped',
          terminalPid: 5678,
        }), { status: 200 })
      );

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; message: string };
      expect(body.stage).toBe('ready');
      expect(body.message).toBe('Container ready (sync skipped: R2 credentials not configured)');
    });

    it('skips mounting stage when health server is ok after sync (single port architecture)', async () => {
      // After A6 fix: the redundant second health fetch was removed.
      // Since the terminal server IS the health server (port 8080), if the
      // health check passes (sync complete), the terminal server is also ok.
      // This means the mounting stage is bypassed and we go straight to sessions check.
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'running' });

      let callCount = 0;
      testState.container!.fetch.mockImplementation(async (req: Request) => {
        callCount++;
        if (callCount === 1) {
          // Health check (sync status) - sync complete
          return new Response(JSON.stringify({
            status: 'ok',
            syncStatus: 'success',
            terminalPid: 1234,
          }), { status: 200 });
        }
        // Sessions endpoint fails
        return new Response('', { status: 503 });
      });

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; progress: number };
      // Goes straight to verifying (sessions check), not mounting
      expect(body.stage).toBe('verifying');
      expect(body.progress).toBe(85);
    });

    it('returns verifying stage when sessions endpoint is not ready', async () => {
      const app = createTestApp();
      testState.container!.getState.mockResolvedValue({ status: 'running' });

      let callCount = 0;
      testState.container!.fetch.mockImplementation(async (req: Request) => {
        callCount++;
        if (callCount <= 1) {
          // Health check succeeds (single fetch - redundant second fetch removed)
          return new Response(JSON.stringify({
            status: 'ok',
            syncStatus: 'success',
            terminalPid: 1234,
          }), { status: 200 });
        }
        // Sessions endpoint fails
        return new Response('', { status: 503 });
      });

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; progress: number };
      expect(body.stage).toBe('verifying');
      expect(body.progress).toBe(85);
    });

    it('includes email in details', async () => {
      const app = createTestApp();
      testState.container!.getState.mockRejectedValue(new Error('Not found'));

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { details: { email: string } };
      expect(body.details.email).toBe('test@example.com');
    });

    it('includes container and bucketName in details', async () => {
      const app = createTestApp('my-bucket');
      testState.container!.getState.mockRejectedValue(new Error('Not found'));

      const res = await app.request(`/container/startup-status${sessionQuery}`);

      expect(res.status).toBe(200);
      const body = await res.json() as { details: { bucketName: string; container: string } };
      expect(body.details.bucketName).toBe('my-bucket');
      expect(body.details.container).toContain('container-');
    });

    it('returns error stage on unexpected exception', async () => {
      const app = createTestApp();
      // Make getContainerContext throw by not providing a sessionId
      const res = await app.request('/container/startup-status');

      expect(res.status).toBe(200);
      const body = await res.json() as { stage: string; error: string };
      expect(body.stage).toBe('error');
      expect(body.error).toBeDefined();
    });
  });
});
