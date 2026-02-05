/**
 * Admin routes
 * Handles admin-only endpoints like destroy-by-id
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isAdminRequest } from '../lib/type-guards';
import { DO_ID_PATTERN } from '../lib/constants';
import { AuthError, ValidationError } from '../lib/error-types';
import { createLogger } from '../lib/logger';

const logger = createLogger('admin');

const app = new Hono<{ Bindings: Env }>();

/**
 * Verify admin authentication
 * Accepts secret from Authorization header (preferred) or query param (legacy)
 */
function verifyAdminAuth(c: { env: Env; req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined } }): void {
  const adminSecret = c.env.ADMIN_SECRET;
  const authHeader = c.req.header('Authorization');
  const providedSecret = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('secret');

  if (!adminSecret || !providedSecret || adminSecret !== providedSecret) {
    throw new AuthError('Unauthorized');
  }
}

/**
 * POST /api/admin/destroy-by-id
 * Destroy a specific container by its 64-char hex DO ID
 *
 * CRITICAL: Uses idFromString to reference EXISTING DOs.
 * DO NOT use idFromName - it creates NEW DOs!
 */
app.post('/destroy-by-id', async (c) => {
  const reqLogger = logger.child({ requestId: c.req.header('X-Request-ID') });

  try {
    verifyAdminAuth(c);

    const data = await c.req.json();
    if (!isAdminRequest(data)) {
      throw new ValidationError('Invalid request - missing doId');
    }
    const { doId } = data;

    if (!DO_ID_PATTERN.test(doId)) {
      throw new ValidationError('Invalid DO ID format - must be 64 hex characters');
    }

    // CRITICAL: Use idFromString to get the ACTUAL existing DO by its hex ID
    // DO NOT use idFromName - it creates a NEW DO with the hex as its name!
    const doIdObj = c.env.CONTAINER.idFromString(doId);
    const container = c.env.CONTAINER.get(doIdObj);

    // DO NOT call getState() before destroy - it wakes up the DO and starts the container!
    // Just destroy directly
    await container.destroy();

    reqLogger.info('Container destroyed via admin endpoint', { doId });

    return c.json({
      success: true,
      doId,
      message: 'Container destroyed via raw DO ID',
    });
  } catch (error) {
    reqLogger.error('Admin destroy-by-id error', error instanceof Error ? error : new Error(String(error)));

    if (error instanceof AuthError || error instanceof ValidationError) {
      throw error;
    }

    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

export default app;
