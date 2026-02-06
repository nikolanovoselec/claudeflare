/**
 * Session lifecycle routes
 * Handles start/stop/status endpoints for session containers
 */
import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env, Session } from '../../types';
import { getSessionKey } from '../../lib/kv-keys';
import { AuthVariables } from '../../middleware/auth';
import { getContainerId, checkContainerHealth } from '../../lib/container-helpers';
import { createLogger } from '../../lib/logger';
import { containerSessionsCB } from '../../lib/circuit-breakers';
import { NotFoundError } from '../../lib/error-types';

const logger = createLogger('session-lifecycle');

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

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
