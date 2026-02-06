import { Context, Next } from 'hono';
import { getUserFromRequest, getBucketName, resolveUserFromKV } from '../lib/access';
import { ForbiddenError } from '../lib/error-types';
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
  const user = await getUserFromRequest(c.req.raw, c.env);

  if (!user.authenticated) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  // Check user allowlist in KV and resolve role (skip in DEV_MODE)
  if (c.env.DEV_MODE !== 'true') {
    const kvEntry = await resolveUserFromKV(c.env.KV, user.email);
    if (!kvEntry) {
      return c.json({ error: 'Forbidden: user not in allowlist' }, 403);
    }
    user.role = kvEntry.role;
  } else {
    // In DEV_MODE, grant admin role
    user.role = 'admin';
  }

  const bucketName = getBucketName(user.email);
  c.set('user', user);
  c.set('bucketName', bucketName);
  return next();
}

/**
 * Middleware that requires the authenticated user to have admin role.
 * Must be used AFTER authMiddleware (user must already be on context).
 *
 * Usage:
 *   app.post('/admin-route', requireAdmin, async (c) => { ... });
 */
export async function requireAdmin(c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) {
  const user = c.get('user');
  if (user?.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
  return next();
}
