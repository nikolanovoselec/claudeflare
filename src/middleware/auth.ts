import { Context, Next } from 'hono';
import { getUserFromRequest, getBucketName } from '../lib/access';
import type { Env, AccessUser } from '../types';

/**
 * Shared auth variables type for Hono context
 * Routes can extend this with additional variables
 */
export type AuthVariables = {
  user: AccessUser;
  bucketName: string;
};

/**
 * Auth middleware that validates user authentication via Cloudflare Access
 * Sets `user` and `bucketName` on the context for downstream handlers
 *
 * Usage:
 *   import { authMiddleware, AuthVariables } from '../middleware/auth';
 *   const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
 *   app.use('*', authMiddleware);
 */
export async function authMiddleware(c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) {
  const user = getUserFromRequest(c.req.raw, c.env);

  if (!user.authenticated) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const bucketName = getBucketName(user.email);
  c.set('user', user);
  c.set('bucketName', bucketName);
  return next();
}
