/**
 * Container status routes
 * Handles GET /health, /state, /startup-status
 */
import { Hono } from 'hono';
import { switchPort } from '@cloudflare/containers';
import type { Env } from '../../types';
import { getContainerContext, checkContainerHealth } from '../../lib/container-helpers';
import { TERMINAL_SERVER_PORT, HEALTH_SERVER_PORT } from '../../lib/constants';
import { AuthVariables } from '../../middleware/auth';
import { ContainerError } from '../../lib/error-types';
import {
  containerLogger,
  containerHealthCB,
  containerSessionsCB,
  fetchWithTimeout,
} from './shared';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/**
 * GET /api/container/health
 * Checks if the container is running and healthy
 */
app.get('/health', async (c) => {
  const reqLogger = containerLogger.child({ requestId: c.req.header('X-Request-ID') });

  try {
    const { containerId, container } = getContainerContext(c);

    const healthResult = await checkContainerHealth(container);

    if (!healthResult.healthy) {
      reqLogger.error('Container health check failed', new Error(healthResult.error || 'Unknown error'), { containerId });
      return c.json({
        success: false,
        containerId,
        error: healthResult.error || 'Container health check failed',
      }, 500);
    }

    return c.json({
      success: true,
      containerId,
      container: healthResult.data,
    });
  } catch (error) {
    throw new ContainerError('health', error instanceof Error ? error.message : 'Unknown error');
  }
});

/**
 * GET /api/container/startup-status
 * Polling endpoint for container startup progress
 * Returns current initialization stage without blocking
 *
 * Stage progression:
 * 1. stopped (0%) - Container not running
 * 2. starting (10-20%) - Container state is running/healthy but services not ready
 * 3. syncing (30-60%) - Health server responding, R2 sync in progress
 * 4. mounting (65-75%) - R2 sync complete, terminal server starting
 * 5. verifying (80-90%) - Terminal server responding, checking sessions
 * 6. ready (100%) - All services ready
 */
app.get('/startup-status', async (c) => {
  const reqLogger = containerLogger.child({ requestId: c.req.header('X-Request-ID') });

  try {
    const user = c.get('user');
    const { bucketName, containerId, container } = getContainerContext(c);

    // Default response structure
    const response: {
      stage: 'stopped' | 'starting' | 'syncing' | 'mounting' | 'verifying' | 'ready' | 'error';
      progress: number;
      message: string;
      details: {
        bucketName: string;
        container: string;
        path: string;
        email?: string;
        containerStatus?: string;
        syncStatus?: string;
        syncError?: string | null;
        terminalPid?: number;
        healthServerOk?: boolean;
        terminalServerOk?: boolean;
        cpu?: string;
        mem?: string;
        hdd?: string;
      };
      error?: string;
    } = {
      stage: 'stopped',
      progress: 0,
      message: 'Container not running',
      details: {
        bucketName,
        container: `container-${containerId.substring(0, 24)}`,
        path: '/home/user/workspace',
        email: user.email,
        containerStatus: 'stopped',
        syncStatus: 'pending',
        healthServerOk: false,
        terminalServerOk: false,
      },
    };

    // Step 1: Check container state
    let containerState;
    try {
      containerState = await container.getState();
    } catch (error) {
      // Container not available - stopped state
      return c.json(response);
    }

    // Container states: stopped, stopping, running, healthy, stopped_with_code
    // We consider 'running' OR 'healthy' as container being up
    const isContainerUp = containerState &&
      (containerState.status === 'running' || containerState.status === 'healthy');

    if (!isContainerUp) {
      // Container not running yet
      response.stage = 'starting';
      response.progress = 10;
      response.message = `Container is starting... (status: ${containerState?.status || 'unknown'})`;
      response.details.containerStatus = containerState?.status || 'unknown';
      return c.json(response);
    }

    // Step 2: Check health server (port 8080) - now consolidated into terminal server
    // Returns sync status from /tmp/sync-status.json and system metrics (cpu/mem/hdd)
    const healthRequest = switchPort(
      new Request('http://container/health', { method: 'GET' }),
      HEALTH_SERVER_PORT
    );
    const healthRes = await fetchWithTimeout(() =>
      containerHealthCB.execute(() => container.fetch(healthRequest))
    );

    // Parse health data if available (includes sync status and system metrics)
    let healthData: {
      status?: string;
      syncStatus?: string;
      syncError?: string | null;
      userPath?: string;
      terminalPid?: number;
      cpu?: string;
      mem?: string;
      hdd?: string;
    } = {};
    let healthServerOk = false;

    if (healthRes && healthRes.ok) {
      try {
        healthData = await healthRes.json() as typeof healthData;
        healthServerOk = true;
      } catch (error) {
        // Failed to parse - continue without health data
      }
    }

    // If health server is not responding yet, we're still starting
    if (!healthServerOk) {
      response.stage = 'starting';
      response.progress = 20;
      response.message = 'Waiting for container services...';
      response.details.containerStatus = containerState?.status || 'running';
      response.details.healthServerOk = false;
      return c.json(response);
    }

    // Step 3: Check R2 sync status - USER MUST NOT SEE TERMINAL UNTIL SYNC COMPLETE
    // syncStatus values: "pending", "syncing", "success", "failed", "skipped"
    const syncStatus = healthData.syncStatus || 'pending';

    if (syncStatus === 'pending' || syncStatus === 'syncing') {
      // Sync in progress - show syncing stage
      response.stage = 'syncing';
      response.progress = syncStatus === 'pending' ? 30 : 45;
      response.message = 'Syncing workspace from R2...';
      response.details.containerStatus = containerState?.status || 'running';
      response.details.syncStatus = syncStatus;
      response.details.healthServerOk = true;
      response.details.terminalPid = healthData.terminalPid;
      // Include metrics when health server provides them
      response.details.cpu = healthData.cpu;
      response.details.mem = healthData.mem;
      response.details.hdd = healthData.hdd;
      return c.json(response);
    }

    if (syncStatus === 'failed') {
      // Sync failed - show error
      response.stage = 'error';
      response.progress = 0;
      response.message = healthData.syncError || 'R2 sync failed';
      response.error = healthData.syncError || 'R2 sync failed';
      response.details.containerStatus = containerState?.status || 'running';
      response.details.syncStatus = 'failed';
      response.details.syncError = healthData.syncError;
      response.details.healthServerOk = true;
      return c.json(response);
    }

    // Sync complete (success or skipped) - now check terminal server
    // Step 4: Check terminal server (port 8080) - THIS IS THE CRITICAL CHECK
    const terminalHealthRequest = switchPort(
      new Request('http://container/health', { method: 'GET' }),
      TERMINAL_SERVER_PORT
    );
    const terminalHealthRes = await fetchWithTimeout(() =>
      containerHealthCB.execute(() => container.fetch(terminalHealthRequest))
    );

    if (!terminalHealthRes) {
      // Terminal server timed out - mounting stage (sync done but terminal not ready)
      response.stage = 'mounting';
      response.progress = 65;
      response.message = 'Sync complete, starting terminal...';
      response.details.containerStatus = containerState?.status || 'running';
      response.details.syncStatus = syncStatus;
      response.details.healthServerOk = true;
      response.details.terminalServerOk = false;
      response.details.terminalPid = healthData.terminalPid;
      // Include metrics when health server provides them
      response.details.cpu = healthData.cpu;
      response.details.mem = healthData.mem;
      response.details.hdd = healthData.hdd;
      return c.json(response);
    }

    if (!terminalHealthRes.ok) {
      // Terminal server not ready yet
      response.stage = 'mounting';
      response.progress = 70;
      response.message = 'Terminal server starting...';
      response.details.containerStatus = containerState?.status || 'running';
      response.details.syncStatus = syncStatus;
      response.details.healthServerOk = true;
      response.details.terminalServerOk = false;
      response.details.terminalPid = healthData.terminalPid;
      // Include metrics when health server provides them
      response.details.cpu = healthData.cpu;
      response.details.mem = healthData.mem;
      response.details.hdd = healthData.hdd;
      return c.json(response);
    }

    // Terminal server is responding! Now verify sessions endpoint
    const sessionsRequest = switchPort(
      new Request('http://container/sessions', { method: 'GET' }),
      TERMINAL_SERVER_PORT
    );
    const sessionsRes = await fetchWithTimeout(() =>
      containerSessionsCB.execute(() => container.fetch(sessionsRequest))
    );

    if (!sessionsRes || !sessionsRes.ok) {
      response.stage = 'verifying';
      response.progress = 85;
      response.message = 'Verifying terminal sessions...';
      response.details.containerStatus = containerState?.status || 'running';
      response.details.syncStatus = syncStatus;
      response.details.healthServerOk = true;
      response.details.terminalServerOk = true;
      response.details.terminalPid = healthData.terminalPid;
      // Include metrics when health server provides them
      response.details.cpu = healthData.cpu;
      response.details.mem = healthData.mem;
      response.details.hdd = healthData.hdd;
      return c.json(response);
    }

    // All checks passed - container is ready!
    response.stage = 'ready';
    response.progress = 100;
    if (syncStatus === 'success') {
      response.message = 'Container ready (workspace synced)';
    } else if (syncStatus === 'skipped') {
      response.message = 'Container ready (sync skipped - no R2 config)';
    } else {
      response.message = 'Container ready';
    }
    response.details.containerStatus = containerState?.status || 'running';
    response.details.syncStatus = syncStatus;
    response.details.healthServerOk = true;
    response.details.terminalServerOk = true;
    response.details.terminalPid = healthData.terminalPid;
    // System metrics
    response.details.cpu = healthData.cpu;
    response.details.mem = healthData.mem;
    response.details.hdd = healthData.hdd;
    return c.json(response);
  } catch (error) {
    reqLogger.error('Startup status error', error instanceof Error ? error : new Error(String(error)));
    return c.json({
      stage: 'error',
      progress: 0,
      message: error instanceof Error ? error.message : 'Unknown error',
      details: {
        bucketName: '',
        container: '',
        path: '/home/user/workspace',
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default app;
