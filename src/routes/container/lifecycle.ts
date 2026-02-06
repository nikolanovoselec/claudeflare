/**
 * Container lifecycle routes
 * Handles POST /start, /destroy
 */
import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env } from '../../types';
import { createBucketIfNotExists } from '../../lib/r2-admin';
import { getR2Config } from '../../lib/r2-config';
import { getContainerContext, getSessionIdFromRequest, getContainerId } from '../../lib/container-helpers';
import { AuthVariables } from '../../middleware/auth';
import { createRateLimiter } from '../../middleware/rate-limit';
import { isBucketNameResponse } from '../../lib/type-guards';
import { ContainerError, toError, toErrorMessage } from '../../lib/error-types';
import { BUCKET_NAME_SETTLE_DELAY_MS, CONTAINER_ID_DISPLAY_LENGTH } from '../../lib/constants';
import { containerLogger, containerInternalCB } from './shared';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/**
 * Rate limiter for container start endpoint
 * Limits to 5 start requests per minute per user
 */
const containerStartRateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 5,
  keyPrefix: 'container-start',
});

/**
 * POST /api/container/start
 * Kicks off container start and returns immediately (non-blocking)
 * Use GET /api/container/startup-status to poll for readiness
 */
app.post('/start', containerStartRateLimiter, async (c) => {
  try {
    const bucketName = c.get('bucketName');
    const sessionId = getSessionIdFromRequest(c);
    const containerId = getContainerId(bucketName, sessionId);
    const shortContainerId = containerId.substring(0, CONTAINER_ID_DISPLAY_LENGTH);

    // CRITICAL: Create R2 bucket BEFORE starting container
    // Container sync will fail if bucket doesn't exist
    const bucketResult = await createBucketIfNotExists(
      (await getR2Config(c.env)).accountId,
      c.env.CLOUDFLARE_API_TOKEN,
      bucketName
    );
    const reqLogger = containerLogger.child({ requestId: c.req.header('X-Request-ID') });

    if (!bucketResult.success) {
      reqLogger.error('Failed to create bucket', new Error(bucketResult.error || 'Unknown error'), { bucketName });
      throw new ContainerError('bucket_creation', bucketResult.error);
    }
    reqLogger.info('Bucket ready', { bucketName, created: bucketResult.created });

    // Get container instance for this session
    const container = getContainer(c.env.CONTAINER, containerId);

    // Check if bucket name needs to be set/updated
    // If container is running with wrong bucket name, we need to restart it
    let storedBucketName: string | null = null;
    try {
      const getBucketResp = await container.fetch(
        new Request('http://container/_internal/getBucketName', { method: 'GET' })
      );
      const data = await getBucketResp.json();
      if (isBucketNameResponse(data)) {
        storedBucketName = data.bucketName;
      }
    } catch (error) {
      // DO might not exist yet, that's ok
    }

    // If bucket name is different or not set, update it
    const needsBucketUpdate = storedBucketName !== bucketName;
    if (needsBucketUpdate) {
      try {
        await containerInternalCB.execute(() =>
          container.fetch(
            new Request('http://container/_internal/setBucketName', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bucketName }),
            })
          )
        );
        // Small delay to ensure DO processes the bucket name before container starts
        await new Promise(resolve => setTimeout(resolve, BUCKET_NAME_SETTLE_DELAY_MS));
        reqLogger.info('Set bucket name', { bucketName, previousBucketName: storedBucketName });
      } catch (error) {
        reqLogger.error('Failed to set bucket name', toError(error));
      }
    }

    // Check current state
    let currentState;
    try {
      currentState = await container.getState();
    } catch (error) {
      currentState = { status: 'unknown' };
    }

    // If container is running but bucket name was wrong or not set, destroy and restart
    if ((currentState.status === 'running' || currentState.status === 'healthy') && needsBucketUpdate) {
      reqLogger.info('Bucket name changed, destroying container to restart with correct bucket');
      try {
        await container.destroy();
        // Container will be started below
        currentState = { status: 'stopped' };
      } catch (error) {
        reqLogger.error('Failed to destroy container', toError(error));
      }
    }

    // If container is already running/healthy with correct bucket, return immediately
    if (currentState.status === 'running' || currentState.status === 'healthy') {
      return c.json({
        success: true,
        bucketName: shortContainerId,
        status: 'already_running',
        containerState: currentState.status,
      });
    }

    // Kick off container start in background (non-blocking)
    // We use waitUntil so the worker doesn't terminate before start() completes
    // Using startAndWaitForPorts() which waits for defaultPort (8080)
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await container.startAndWaitForPorts();
          reqLogger.info('Container started and ports ready', { containerId: shortContainerId });
        } catch (error) {
          reqLogger.error('Failed to start container', toError(error), { containerId: shortContainerId });
        }
      })()
    );

    // Return immediately - client should poll startup-status for progress
    return c.json({
      success: true,
      bucketName: shortContainerId,
      status: 'starting',
      message: 'Container start initiated. Poll /api/container/startup-status for progress.',
    });
  } catch (error) {
    const reqLogger = containerLogger.child({ requestId: c.req.header('X-Request-ID') });
    reqLogger.error('Container start error', toError(error));
    if (error instanceof ContainerError) {
      throw error;
    }
    throw new ContainerError('start');
  }
});

/**
 * POST /api/container/destroy
 * Destroy the container (SIGKILL) - used to force restart with new image
 */
app.post('/destroy', async (c) => {
  const reqLogger = containerLogger.child({ requestId: c.req.header('X-Request-ID') });

  try {
    const { containerId, container } = getContainerContext(c);

    // Get state before destroy
    const stateBefore = await container.getState();

    // Destroy the container
    await container.destroy();

    reqLogger.info('Container destroyed', { containerId, stateBefore });

    // Don't call getState() after destroy() — it resurrects the DO (gotcha #6)
    return c.json({ success: true, message: 'Container destroyed' });
  } catch (error) {
    reqLogger.error('Container destroy error', toError(error));
    throw new ContainerError('destroy', toErrorMessage(error));
  }
});

// REMOVED: destroy-by-name and nuke-all endpoints
// Also REMOVED: destroy-by-id (duplicate exists in src/index.ts under /api/admin/destroy-by-id)
// These endpoints CREATED zombies instead of destroying them!
// Reason: idFromName() + get() + any method CREATES a DO if it doesn't exist.
// The only way to delete DOs is to delete the entire class via migration.

export default app;
