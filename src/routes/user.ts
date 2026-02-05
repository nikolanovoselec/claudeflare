import { Hono } from 'hono';
import type { Env } from '../types';
import { createBucketIfNotExists } from '../lib/r2-admin';
import { getR2Config } from '../lib/r2-config';
import { createLogger } from '../lib/logger';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { ContainerError } from '../lib/error-types';

const logger = createLogger('user');

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Use shared auth middleware
app.use('*', authMiddleware);

/**
 * GET /api/user
 * Returns authenticated user info
 */
app.get('/', async (c) => {
  const reqLogger = logger.child({ requestId: c.req.header('X-Request-ID') });
  const user = c.get('user');
  const bucketName = c.get('bucketName');

  // Create user's bucket if it doesn't exist
  const bucketResult = await createBucketIfNotExists(
    (await getR2Config(c.env)).accountId,
    c.env.CLOUDFLARE_API_TOKEN,
    bucketName
  );

  if (!bucketResult.success) {
    throw new ContainerError('bucket_creation', bucketResult.error || 'Unknown error');
  }

  return c.json({
    email: user.email,
    authenticated: user.authenticated,
    bucketName,
    bucketCreated: bucketResult.created,
  });
});

export default app;
