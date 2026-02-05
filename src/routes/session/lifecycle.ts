/**
 * Session lifecycle routes
 * Handles start/stop/status endpoints for session containers
 */
import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env, Session } from '../../types';
import { getSessionKey } from '../../lib/kv-keys';
import { AuthVariables } from '../../middleware/auth';
import { MAX_HEALTH_CHECK_ATTEMPTS, HEALTH_CHECK_INTERVAL_MS } from '../../lib/constants';
import { getContainerId, checkContainerHealth } from '../../lib/container-helpers';
import { createLogger } from '../../lib/logger';
import { containerHealthCB, containerSessionsCB } from '../../lib/circuit-breakers';
import { withBackoff, MaxRetriesExceededError } from '../../lib/backoff';
import { NotFoundError } from '../../lib/error-types';

const logger = createLogger('session-lifecycle');

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/**
 * GET /api/sessions/:id/start
 * Start session with SSE progress stream
 * Returns Server-Sent Events for initialization progress
 */
app.get('/:id/start', async (c) => {
  const reqLogger = logger.child({ requestId: c.req.header('X-Request-ID') });
  const bucketName = c.get('bucketName');
  const sessionId = c.req.param('id');
  const key = getSessionKey(bucketName, sessionId);

  const session = await c.env.KV.get<Session>(key, 'json');

  if (!session) {
    throw new NotFoundError('Session');
  }

  // Set SSE headers
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Helper to send SSE events
  const sendEvent = async (
    stage: string,
    progress: number,
    message: string,
    details?: { key: string; value: string }[]
  ) => {
    const data = JSON.stringify({ stage, progress, message, details });
    await writer.write(encoder.encode(`data: ${data}\n\n`));
  };

  // Start container initialization in background
  const initContainer = async () => {
    try {
      // Stage 1: Creating
      const shortBucketName = bucketName.substring(0, 20);
      await sendEvent('creating', 10, 'Preparing container...', [
        { key: 'Bucket', value: shortBucketName },
      ]);

      const containerId = getContainerId(bucketName, sessionId);
      const container = getContainer(c.env.CONTAINER, containerId);

      // Set bucket name on container (required for R2 sync)
      // Each per-session container is a new DO that needs its bucket configured
      try {
        await container.fetch(
          new Request('http://container/_internal/setBucketName', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucketName }),
          })
        );
        reqLogger.info('Set bucket name on container', { bucketName, containerId });
      } catch (error) {
        reqLogger.error('Failed to set bucket name', error instanceof Error ? error : new Error(String(error)));
      }

      // Stage 2: Starting
      await sendEvent('starting', 30, 'Starting container...', [
        { key: 'Container', value: `container-${shortBucketName}` },
      ]);

      // Try to wake up the container by making a health check
      // This triggers container start if not already running
      // Use withBackoff for polling with exponential backoff
      let attemptCount = 0;
      try {
        await withBackoff(
          async () => {
            attemptCount++;
            const healthRes = await containerHealthCB.execute(() =>
              container.fetch(new Request('http://container/health', { method: 'GET' }))
            );
            if (!healthRes.ok) {
              // Update progress during starting phase (30-60%)
              const startProgress = 30 + Math.min(attemptCount * 2, 30);
              await sendEvent('starting', startProgress, `Waiting for terminal server (${attemptCount}s)...`, [
                { key: 'Container', value: `container-${shortBucketName}` },
              ]);
              throw new Error(`Health check failed: ${healthRes.status}`);
            }
            return healthRes;
          },
          {
            initialDelayMs: HEALTH_CHECK_INTERVAL_MS,
            maxDelayMs: HEALTH_CHECK_INTERVAL_MS * 2,
            factor: 1,
            maxAttempts: MAX_HEALTH_CHECK_ATTEMPTS,
            jitter: true,
          }
        );
      } catch (error) {
        if (error instanceof MaxRetriesExceededError) {
          await sendEvent('error', 0, `Container failed to start within ${error.attempts} attempts`);
          await writer.close();
          return;
        }
        throw error;
      }

      // Stage 3: Mounting
      await sendEvent('mounting', 70, 'Verifying storage mount...', [
        { key: 'Bucket', value: bucketName },
        { key: 'Path', value: '/mnt/r2' },
      ]);

      // Stage 4: Verifying
      await sendEvent('verifying', 85, 'Verifying terminal server...', [
        { key: 'Workspace', value: '~/workspace' },
      ]);

      // Verify terminal server is responding
      try {
        // Terminal server runs on default port 8080
        const sessionsRes = await containerSessionsCB.execute(() =>
          container.fetch(
            new Request('http://container/sessions', { method: 'GET' })
          )
        );
        if (!sessionsRes.ok) {
          await sendEvent('error', 0, 'Terminal server not responding');
          await writer.close();
          return;
        }
      } catch (error) {
        await sendEvent('error', 0, 'Failed to verify terminal server');
        await writer.close();
        return;
      }

      // Stage 5: Ready
      await sendEvent('ready', 100, 'Container ready', [
        { key: 'Status', value: 'All systems operational' },
      ]);

      // Update session last accessed
      session.lastAccessedAt = new Date().toISOString();
      await c.env.KV.put(key, JSON.stringify(session));

      await writer.close();
    } catch (error) {
      reqLogger.error('Error during initialization', error instanceof Error ? error : new Error(String(error)));
      await sendEvent(
        'error',
        0,
        error instanceof Error ? error.message : 'Unknown error'
      );
      await writer.close();
    }
  };

  // Start initialization in the background
  c.executionCtx.waitUntil(
    initContainer().catch((error) => {
      logger.error('Background initialization failed', error instanceof Error ? error : new Error(String(error)), {
        sessionId,
        bucketName,
      });
    })
  );

  // Return SSE response immediately
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

/**
 * POST /api/sessions/:id/stop
 * Stop a session (kills the PTY but keeps the container alive for restart)
 * Note: The container will naturally go to sleep after inactivity.
 * Use DELETE to fully destroy the container and remove the session.
 */
app.post('/:id/stop', async (c) => {
  const reqLogger = logger.child({ requestId: c.req.header('X-Request-ID') });
  const bucketName = c.get('bucketName');
  const sessionId = c.req.param('id');
  const key = getSessionKey(bucketName, sessionId);

  const session = await c.env.KV.get<Session>(key, 'json');

  if (!session) {
    throw new NotFoundError('Session');
  }

  const containerId = getContainerId(bucketName, sessionId);
  const container = getContainer(c.env.CONTAINER, containerId);

  // Kill the PTY session in the container but don't destroy the container
  // The container will go to sleep naturally after inactivity
  try {
    // Terminal server runs on default port 8080
    await containerSessionsCB.execute(() =>
      container.fetch(
        new Request(`http://container/sessions/${sessionId}`, {
          method: 'DELETE',
        })
      )
    );
    reqLogger.info('Killed PTY session in container', { containerId });
  } catch (error) {
    // Container might not be running, that's okay
    reqLogger.warn('Could not stop PTY session in container', { error: String(error) });
  }

  // Note: We intentionally do NOT call container.destroy() here
  // STOP should allow the session to be restarted later
  // DELETE is used to fully destroy the container

  return c.json({ stopped: true, id: sessionId });
});

/**
 * GET /api/sessions/:id/status
 * Get session and container status
 */
app.get('/:id/status', async (c) => {
  const bucketName = c.get('bucketName');
  const sessionId = c.req.param('id');
  const key = getSessionKey(bucketName, sessionId);

  const session = await c.env.KV.get<Session>(key, 'json');

  if (!session) {
    throw new NotFoundError('Session');
  }

  // Check container status
  let containerStatus = 'unknown';
  let terminalSessions: { id: string; [key: string]: unknown }[] = [];

  try {
    const containerId = getContainerId(bucketName, sessionId);
    const container = getContainer(c.env.CONTAINER, containerId);

    // Check terminal server health (runs on default port 8080)
    const healthResult = await checkContainerHealth(container);
    if (healthResult.healthy) {
      containerStatus = 'running';
    }

    // Get terminal sessions from container (terminal server on default port 8080)
    const sessionsRes = await containerSessionsCB.execute(() =>
      container.fetch(
        new Request('http://container/sessions', { method: 'GET' })
      )
    );
    if (sessionsRes.ok) {
      const data = (await sessionsRes.json()) as {
        sessions: { id: string; [key: string]: unknown }[];
      };
      terminalSessions = data.sessions || [];
    }
  } catch (error) {
    containerStatus = 'stopped';
  }

  // Check if this specific session has an active PTY
  const activePty = terminalSessions.find((s) => s.id === sessionId);

  return c.json({
    session,
    containerStatus,
    // Add 'status' field for frontend compatibility
    status: containerStatus === 'running' ? 'running' : 'stopped',
    ptyActive: !!activePty,
    ptyInfo: activePty || null,
  });
});

export default app;
