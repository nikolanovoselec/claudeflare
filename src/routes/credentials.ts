import { Hono } from 'hono';
import type { Env, CredentialsStatus } from '../types';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { createLogger } from '../lib/logger';
import { CredentialsError, AuthError, toError } from '../lib/error-types';

const logger = createLogger('credentials');

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Use shared auth middleware
app.use('*', authMiddleware);

/**
 * Middleware to gate all credentials routes behind DEV_MODE
 * Credentials API should only be accessible in development for security
 */
app.use('*', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') {
    throw new AuthError('Credentials API only available in DEV_MODE');
  }
  await next();
});

/**
 * Get KV key for credential status cache
 */
function getCredentialStatusKey(bucketName: string): string {
  return `credentials:${bucketName}:status`;
}

/**
 * GET /api/credentials
 * Check if credentials exist and get status
 *
 * Does NOT return the actual credentials for security
 */
app.get('/', async (c) => {
  const bucketName = c.get('bucketName');

  try {
    // First check KV cache
    const cachedStatus = await c.env.KV.get<CredentialsStatus>(
      getCredentialStatusKey(bucketName),
      'json'
    );

    if (cachedStatus) {
      const isExpired = Date.now() > cachedStatus.expiresAt;
      return c.json({
        exists: cachedStatus.exists,
        expired: isExpired,
        expiresAt: cachedStatus.expiresAt,
        scopes: cachedStatus.scopes,
        updatedAt: cachedStatus.updatedAt,
      });
    }

    // R2 static binding removed — no fallback to R2 direct access
    return c.json({
      exists: false,
      expired: false,
      expiresAt: null,
      scopes: [],
      updatedAt: null,
    });
  } catch (err) {
    logger.error('Check error', toError(err));
    throw new CredentialsError('check');
  }
});

/**
 * DELETE /api/credentials
 * Remove credentials from R2
 */
app.delete('/', async (c) => {
  const bucketName = c.get('bucketName');

  try {
    // Clear KV cache
    await c.env.KV.delete(getCredentialStatusKey(bucketName));

    // Note: Container will pick up credential deletion via R2 sync
    // No need to notify container directly - it was causing orphan DOs

    return c.json({
      success: true,
      message: 'Credentials deleted',
    });
  } catch (err) {
    logger.error('Delete error', toError(err));
    throw new CredentialsError('delete');
  }
});

export default app;
