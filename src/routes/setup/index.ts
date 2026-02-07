import { Hono } from 'hono';
import type { Env } from '../../types';
import { ValidationError, SetupError, toError } from '../../lib/error-types';
import { resetCorsOriginsCache } from '../../lib/cors-cache';
import { resetAuthConfigCache } from '../../lib/access';
import { verifyAdminSecret } from '../../lib/admin-auth';
import { setupRateLimiter, logger } from './shared';
import type { SetupStep } from './shared';
import { handleGetAccount } from './account';
import { handleDeriveR2Credentials } from './credentials';
import { handleSetSecrets } from './secrets';
import { handleConfigureCustomDomain } from './custom-domain';
import { handleCreateAccessApp } from './access';
import handlers from './handlers';

const app = new Hono<{ Bindings: Env }>();

// Register simple endpoint handlers
app.route('/', handlers);

/**
 * POST /api/setup/configure
 * Main setup endpoint - configures everything using extracted step handlers
 *
 * Body: { customDomain: string, allowedUsers: string[], allowedOrigins?: string[] }
 * Token is read from env (CLOUDFLARE_API_TOKEN), not from request body.
 */
app.use('/configure', setupRateLimiter);
app.post('/configure', async (c) => {
  // After initial setup is complete, require admin auth to reconfigure
  const isComplete = await c.env.KV.get('setup:complete');
  if (isComplete === 'true') {
    verifyAdminSecret(c.env, c.req.header('Authorization'));
  }

  const {
    customDomain,
    allowedUsers,
    adminUsers,
    allowedOrigins
  } = await c.req.json<{
    customDomain?: string;
    allowedUsers?: string[];
    adminUsers?: string[];
    allowedOrigins?: string[];
  }>();

  // Token from env (already set by GitHub Actions deploy)
  const token = c.env.CLOUDFLARE_API_TOKEN;

  // Validate required fields
  if (!customDomain) {
    throw new ValidationError('customDomain is required');
  }

  if (!adminUsers || adminUsers.length === 0) {
    throw new ValidationError('At least one admin user is required');
  }

  if (!allowedUsers || allowedUsers.length === 0) {
    throw new ValidationError('allowedUsers is required and must not be empty');
  }

  const steps: SetupStep[] = [];

  try {
    // Step 1: Get account ID
    const accountId = await handleGetAccount(token, steps);

    // Step 2: Derive R2 S3 credentials from user's token
    const { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey } =
      await handleDeriveR2Credentials(token, steps);

    // Step 3: Set worker secrets (3 secrets: R2 creds + admin secret — NOT CLOUDFLARE_API_TOKEN)
    const adminSecret = await handleSetSecrets(
      token,
      accountId,
      r2AccessKeyId,
      r2SecretAccessKey,
      c.req.url,
      steps
    );

    // Store users in KV with role
    const adminSet = new Set(adminUsers);
    for (const email of allowedUsers) {
      const role = adminSet.has(email) ? 'admin' : 'user';
      await c.env.KV.put(
        `user:${email}`,
        JSON.stringify({ addedBy: 'setup', addedAt: new Date().toISOString(), role })
      );
    }

    // Step 4 & 5: Custom domain + CF Access
    await handleConfigureCustomDomain(token, accountId, customDomain, c.req.url, steps);
    await handleCreateAccessApp(token, accountId, customDomain, allowedUsers, steps, c.env.KV);

    // Store custom domain in KV
    await c.env.KV.put('setup:custom_domain', customDomain);

    // Build combined allowed origins list:
    // 1. User-provided origins (if any)
    // 2. Auto-add the custom domain
    // 3. Always include .workers.dev as a default
    const combinedOrigins = new Set<string>(allowedOrigins || []);
    combinedOrigins.add(customDomain);
    combinedOrigins.add('.workers.dev');
    await c.env.KV.put('setup:allowed_origins', JSON.stringify([...combinedOrigins]));

    // Final step: Mark setup as complete
    steps.push({ step: 'finalize', status: 'pending' });
    await c.env.KV.put('setup:complete', 'true');
    await c.env.KV.put('setup:account_id', accountId);
    await c.env.KV.put('setup:r2_endpoint', `https://${accountId}.r2.cloudflarestorage.com`);
    await c.env.KV.put('setup:completed_at', new Date().toISOString());
    steps[steps.length - 1].status = 'success';

    // Reset in-memory caches so subsequent requests pick up new KV values
    resetCorsOriginsCache();
    resetAuthConfigCache();

    // Get the workers.dev URL from request
    const url = new URL(c.req.url);
    const workersDevUrl = `https://${url.host}`;

    return c.json({
      success: true,
      steps,
      workersDevUrl,
      customDomainUrl: `https://${customDomain}`,
      adminSecret,
      accountId,
    });

  } catch (error) {
    if (error instanceof SetupError || error instanceof ValidationError) {
      throw error;
    }
    logger.error('Configuration error', toError(error));
    throw new SetupError('Configuration failed', steps);
  }
});

export default app;
