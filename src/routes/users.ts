import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { getAllUsers, syncAccessPolicy } from '../lib/access-policy';
import { getBucketName } from '../lib/access';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
app.use('*', authMiddleware);

// GET /api/users - List all users
app.get('/', async (c) => {
  const users = await getAllUsers(c.env.KV);
  return c.json({ users });
});

// POST /api/users - Add a user
app.post('/', async (c) => {
  const body = await c.req.json();
  const email = body.email?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email is required' }, 400);
  }

  // Check for duplicate
  const existing = await c.env.KV.get(`user:${email}`);
  if (existing) {
    return c.json({ error: 'User already exists' }, 400);
  }

  const currentUser = c.get('user');
  await c.env.KV.put(`user:${email}`, JSON.stringify({
    addedBy: currentUser.email,
    addedAt: new Date().toISOString(),
  }));

  // Sync Access policy
  try {
    const accountId = await c.env.KV.get('setup:account_id');
    const domain = await c.env.KV.get('setup:custom_domain');
    if (accountId && domain && c.env.CLOUDFLARE_API_TOKEN) {
      await syncAccessPolicy(c.env.CLOUDFLARE_API_TOKEN, accountId, domain, c.env.KV);
    }
  } catch (e) {
    // Non-fatal: user added to KV even if Access sync fails
  }

  return c.json({ success: true, email });
});

// DELETE /api/users/:email - Remove a user
app.delete('/:email', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const currentUser = c.get('user');

  if (email === currentUser.email) {
    return c.json({ error: 'Cannot remove yourself' }, 400);
  }

  const existing = await c.env.KV.get(`user:${email}`);
  if (!existing) {
    return c.json({ error: 'User not found' }, 404);
  }

  await c.env.KV.delete(`user:${email}`);

  // Try to delete R2 bucket
  try {
    const accountId = await c.env.KV.get('setup:account_id');
    if (accountId && c.env.CLOUDFLARE_API_TOKEN) {
      const bucketName = getBucketName(email);
      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${c.env.CLOUDFLARE_API_TOKEN}` },
      });
    }
  } catch (e) {
    // Non-fatal
  }

  // Sync Access policy
  try {
    const accountId = await c.env.KV.get('setup:account_id');
    const domain = await c.env.KV.get('setup:custom_domain');
    if (accountId && domain && c.env.CLOUDFLARE_API_TOKEN) {
      await syncAccessPolicy(c.env.CLOUDFLARE_API_TOKEN, accountId, domain, c.env.KV);
    }
  } catch (e) {
    // Non-fatal
  }

  return c.json({ success: true, email });
});

export default app;
