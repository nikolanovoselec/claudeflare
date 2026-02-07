// users.ts = admin user management (GET/POST/DELETE /api/users). See user.ts for current user identity.
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { authMiddleware, requireAdmin, type AuthVariables } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rate-limit';
import { getAllUsers, syncAccessPolicy } from '../lib/access-policy';
import { getBucketName } from '../lib/access';
import { createLogger } from '../lib/logger';
import { AppError, ValidationError, NotFoundError, toError } from '../lib/error-types';
import { CF_API_BASE } from '../lib/constants';
import { r2AdminCB } from '../lib/circuit-breakers';

const AddUserSchema = z.object({
  email: z.string({ required_error: 'Valid email is required' }).email('Valid email is required'),
  role: z.enum(['admin', 'user']).optional(),
});

const logger = createLogger('users');

/**
 * Attempt to sync the CF Access policy after a user mutation.
 * Non-fatal: logs errors but does not throw.
 */
async function trySyncAccessPolicy(env: Env): Promise<void> {
  try {
    const accountId = await env.KV.get('setup:account_id');
    const domain = await env.KV.get('setup:custom_domain');
    if (accountId && domain && env.CLOUDFLARE_API_TOKEN) {
      await syncAccessPolicy(env.CLOUDFLARE_API_TOKEN, accountId, domain, env.KV);
    }
  } catch (e) {
    logger.error('Failed to sync Access policy', toError(e));
  }
}

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
app.use('*', authMiddleware);

/**
 * Rate limiter for user mutations (POST/DELETE)
 * Limits to 20 mutations per minute per user
 */
const userMutationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  keyPrefix: 'user-mutation',
});

// GET /api/users - List all users
app.get('/', async (c) => {
  const users = await getAllUsers(c.env.KV);
  return c.json({ users });
});

// POST /api/users - Add a user (admin only)
app.post('/', requireAdmin, userMutationRateLimiter, async (c) => {
  const body = await c.req.json();
  const parsed = AddUserSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors[0].message);
  }
  const email = parsed.data.email.trim().toLowerCase();

  // Check for duplicate
  const existing = await c.env.KV.get(`user:${email}`);
  if (existing) {
    throw new AppError('USER_EXISTS', 409, 'User already in allowlist');
  }

  const currentUser = c.get('user');
  const role = parsed.data.role || 'user';
  await c.env.KV.put(`user:${email}`, JSON.stringify({
    addedBy: currentUser.email,
    addedAt: new Date().toISOString(),
    role,
  }));

  await trySyncAccessPolicy(c.env);

  return c.json({ success: true, email, role });
});

// DELETE /api/users/:email - Remove a user (admin only)
app.delete('/:email', requireAdmin, userMutationRateLimiter, async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const currentUser = c.get('user');

  if (!email) {
    throw new ValidationError('Email parameter is required');
  }

  if (email === currentUser.email) {
    throw new ValidationError('Cannot remove yourself');
  }

  const existing = await c.env.KV.get(`user:${email}`);
  if (!existing) {
    throw new NotFoundError('User', email);
  }

  await c.env.KV.delete(`user:${email}`);

  const accountId = await c.env.KV.get('setup:account_id');

  // Try to delete R2 bucket (wrapped in circuit breaker for resilience)
  try {
    if (accountId && c.env.CLOUDFLARE_API_TOKEN) {
      const bucketName = getBucketName(email);
      await r2AdminCB.execute(() =>
        fetch(`${CF_API_BASE}/accounts/${accountId}/r2/buckets/${bucketName}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${c.env.CLOUDFLARE_API_TOKEN}` },
        })
      );
    }
  } catch (e) {
    // Non-fatal
    logger.error('Failed to delete R2 bucket', toError(e));
  }

  await trySyncAccessPolicy(c.env);

  return c.json({ success: true, email });
});

export default app;
