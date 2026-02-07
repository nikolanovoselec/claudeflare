/**
 * Session lifecycle routes
 * Handles start/stop/status endpoints for session containers
 */
import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { DurableObjectStub } from '@cloudflare/workers-types';
import type { Env, Session } from '../../types';
import { getSessionKey, getSessionPrefix, listAllKvKeys, getSessionOrThrow } from '../../lib/kv-keys';
import { AuthVariables } from '../../middleware/auth';
import { getContainerId, checkContainerHealth } from '../../lib/container-helpers';
import { createLogger } from '../../lib/logger';
import { containerSessionsCB } from '../../lib/circuit-breakers';

const logger = createLogger('session-lifecycle');

/**
 * Check container health and PTY status for a session.
 * Returns the container status and whether the given session has an active PTY.
 */
async function getContainerSessionStatus(
  container: DurableObjectStub,
  sessionId: string
): Promise<{ status: string; ptyActive: boolean; terminalSessions: { id: string; [key: string]: unknown }[] }> {
  const healthResult = await checkContainerHealth(container);

  if (!healthResult.healthy) {
    return { status: 'stopped', ptyActive: false, terminalSessions: [] };
  }

  let terminalSessions: { id: string; [key: string]: unknown }[] = [];
  try {
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
  } catch {
    // PTY check failed, but container is healthy
  }

  const ptyActive = terminalSessions.some((s) => s.id === sessionId);
  return { status: 'running', ptyActive, terminalSessions };
}

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/**
 * GET /api/sessions/batch-status
 * Get status for all sessions in a single call (eliminates N+1 on page load)
 * Returns a map of sessionId -> { status, ptyActive }
 */
app.get('/batch-status', async (c) => {
  const reqLogger = logger.child({ requestId: c.get('requestId') });
  const bucketName = c.get('bucketName');
  const prefix = getSessionPrefix(bucketName);

  // List all sessions for this user
  const keys = await listAllKvKeys(c.env.KV, prefix);
  const sessionPromises = keys.map(key => c.env.KV.get<Session>(key.name, 'json'));
  const sessionResults = await Promise.all(sessionPromises);
  const sessions: Session[] = sessionResults.filter((s): s is Session => s !== null);

  // Check container status for each session in parallel
  const statuses: Record<string, { status: string; ptyActive: boolean; startupStage?: string }> = {};

  const results = await Promise.allSettled(
    sessions.map(async (session) => {
      // If KV says stopped, skip the expensive container probe
      if (session.status === 'stopped') {
        return { sessionId: session.id, status: 'stopped', ptyActive: false } as const;
      }

      const containerId = getContainerId(bucketName, session.id);
      const container = getContainer(c.env.CONTAINER, containerId);
      const result = await getContainerSessionStatus(container, session.id);
      const entry: { sessionId: string; status: string; ptyActive: boolean; startupStage?: string } = {
        sessionId: session.id,
        status: result.status,
        ptyActive: result.ptyActive,
      };
      if (result.status === 'running') {
        entry.startupStage = result.ptyActive ? 'ready' : 'verifying';
      }
      return entry;
    })
  );

  for (let i = 0; i < results.length; i++) {
    const sessionId = sessions[i].id;
    const result = results[i];
    if (result.status === 'fulfilled') {
      const { sessionId: _id, ...entry } = result.value;
      statuses[sessionId] = entry;
    } else {
      reqLogger.warn('Batch status check failed for session', {
        sessionId,
        error: String(result.reason),
      });
      statuses[sessionId] = { status: 'stopped', ptyActive: false };
    }
  }

  return c.json({ statuses });
});

/**
 * POST /api/sessions/:id/stop
 * Stop a session (kills the PTY but keeps the container alive for restart)
 * Note: The container will naturally go to sleep after inactivity.
 * Use DELETE to fully destroy the container and remove the session.
 */
app.post('/:id/stop', async (c) => {
  const reqLogger = logger.child({ requestId: c.get('requestId') });
  const bucketName = c.get('bucketName');
  const sessionId = c.req.param('id');
  const key = getSessionKey(bucketName, sessionId);

  const session = await getSessionOrThrow(c.env.KV, key);

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
  } catch (err) {
    // Container might not be running, that's okay
    reqLogger.warn('Could not stop PTY session in container', { error: String(err) });
  }

  // Note: We intentionally do NOT call container.destroy() here
  // STOP should allow the session to be restarted later
  // DELETE is used to fully destroy the container

  // Persist stopped status in KV so batch-status can skip container probes
  session.status = 'stopped';
  await c.env.KV.put(key, JSON.stringify(session));

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

  const session = await getSessionOrThrow(c.env.KV, key);

  // Check container status
  let result = { status: 'stopped', ptyActive: false, terminalSessions: [] as { id: string; [key: string]: unknown }[] };

  try {
    const containerId = getContainerId(bucketName, sessionId);
    const container = getContainer(c.env.CONTAINER, containerId);
    result = await getContainerSessionStatus(container, sessionId);
  } catch {
    // Container check failed - defaults to stopped
  }

  const activePty = result.terminalSessions.find((s) => s.id === sessionId);

  return c.json({
    session,
    containerStatus: result.status,
    status: result.status === 'running' ? 'running' : 'stopped',
    ptyActive: result.ptyActive,
    ptyInfo: activePty || null,
  });
});

export default app;
