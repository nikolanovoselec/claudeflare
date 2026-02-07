import { Hono } from 'hono';
import type { Env } from '../../types';
import { AuthError, toError } from '../../lib/error-types';
import { CF_API_BASE, logger } from './shared';

const handlers = new Hono<{ Bindings: Env }>();

/**
 * GET /api/setup/status
 * Check if setup is complete (public endpoint)
 */
handlers.get('/status', async (c) => {
  const setupComplete = await c.env.KV.get('setup:complete');
  const configured = setupComplete === 'true';

  return c.json({
    configured,
    tokenDetected: Boolean(c.env.CLOUDFLARE_API_TOKEN),
  });
});

/**
 * GET /api/setup/detect-token
 * Detect whether CLOUDFLARE_API_TOKEN is present in the environment (secret binding),
 * verify it against the Cloudflare API, and return account info.
 */
handlers.get('/detect-token', async (c) => {
  const token = c.env.CLOUDFLARE_API_TOKEN;

  if (!token) {
    return c.json({ detected: false, error: 'Deploy with GitHub Actions first' });
  }

  try {
    // Verify token
    const verifyRes = await fetch(`${CF_API_BASE}/user/tokens/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const verifyData = await verifyRes.json() as {
      success: boolean;
      result?: { id: string; status: string };
      errors?: Array<{ message: string }>;
    };

    if (!verifyData.success) {
      return c.json({ detected: true, valid: false, error: 'Token is invalid or expired' });
    }

    // Get account info
    const accountsRes = await fetch(`${CF_API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const accountsData = await accountsRes.json() as {
      success: boolean;
      result?: Array<{ id: string; name: string }>;
    };

    if (!accountsData.success || !accountsData.result?.length) {
      return c.json({ detected: true, valid: false, error: 'No accounts found for this token' });
    }

    const account = accountsData.result[0];
    return c.json({
      detected: true,
      valid: true,
      account: { id: account.id, name: account.name },
    });
  } catch (error) {
    logger.error('Token detection error', toError(error));
    return c.json({ detected: true, valid: false, error: 'Failed to verify token' });
  }
});

/**
 * POST /api/setup/reset-for-tests
 * Test-only reset endpoint (DEV_MODE required)
 * Used by E2E tests to reset setup state before test runs
 */
handlers.post('/reset-for-tests', async (c) => {
  if (c.env.DEV_MODE !== 'true') {
    throw new AuthError('Not available in production');
  }

  // Clear setup state
  await c.env.KV.delete('setup:complete');

  return c.json({ success: true, message: 'Setup state reset for tests' });
});

/**
 * POST /api/setup/restore-for-tests
 * Test-only restore endpoint (DEV_MODE required)
 * Used by E2E tests to restore setup:complete after test runs
 * IMPORTANT: Must be called in afterAll of setup-wizard.test.ts
 */
handlers.post('/restore-for-tests', async (c) => {
  if (c.env.DEV_MODE !== 'true') {
    throw new AuthError('Not available in production');
  }

  // Restore setup state
  await c.env.KV.put('setup:complete', 'true');

  return c.json({ success: true, message: 'Setup state restored for tests' });
});

export default handlers;
