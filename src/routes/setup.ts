import { Hono } from 'hono';
import type { Env } from '../types';
import { createLogger } from '../lib/logger';
import { ValidationError, AuthError, SetupError } from '../lib/error-types';
// R2 permission IDs no longer needed — we derive S3 credentials from the user's token

const logger = createLogger('setup');

const app = new Hono<{ Bindings: Env }>();

// Constants
const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// Step tracking type
type SetupStep = { step: string; status: 'pending' | 'success' | 'error'; error?: string };

// ============================================================================
// Step Handler Functions
// ============================================================================

/**
 * Step 1: Get account ID from Cloudflare API
 */
async function handleGetAccount(
  token: string,
  steps: SetupStep[]
): Promise<string> {
  steps.push({ step: 'get_account', status: 'pending' });
  const stepIndex = steps.length - 1;

  try {
    const accountsRes = await fetch(`${CF_API_BASE}/accounts`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const accountsData = await accountsRes.json() as {
      success: boolean;
      result?: Array<{ id: string }>;
    };

    if (!accountsData.success || !accountsData.result?.length) {
      steps[stepIndex].status = 'error';
      steps[stepIndex].error = 'Failed to get account';
      throw new SetupError('get_account', 'Failed to get account', steps);
    }

    steps[stepIndex].status = 'success';
    return accountsData.result[0].id;
  } catch (error) {
    if (error instanceof SetupError) {
      throw error;
    }
    logger.error('Failed to get account', error instanceof Error ? error : new Error(String(error)));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to connect to Cloudflare API';
    throw new SetupError('get_account', 'Failed to connect to Cloudflare API', steps);
  }
}

/**
 * Step 2: Derive R2 S3-compatible credentials from the user's API token.
 *
 * Cloudflare R2 S3 API credentials are derived from regular API tokens:
 *   - S3 Access Key ID = API token ID (from /user/tokens/verify)
 *   - S3 Secret Access Key = SHA-256 hash of the API token value
 *
 * This avoids needing "API Tokens Edit" permission to create a separate R2 token.
 */
async function handleDeriveR2Credentials(
  token: string,
  steps: SetupStep[]
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
  steps.push({ step: 'create_r2_token', status: 'pending' });
  const stepIndex = steps.length - 1;

  try {
    // Get the token ID from the verify endpoint
    const verifyRes = await fetch(`${CF_API_BASE}/user/tokens/verify`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const verifyData = await verifyRes.json() as {
      success: boolean;
      result?: { id: string; status: string };
      errors?: Array<{ message: string }>;
    };

    if (!verifyData.success || !verifyData.result?.id) {
      const errorMsg = verifyData.errors?.map(e => e.message).join(', ') || 'Token verification failed';
      steps[stepIndex].status = 'error';
      steps[stepIndex].error = `Failed to derive R2 credentials: ${errorMsg}`;
      throw new SetupError('create_r2_token', `Failed to derive R2 credentials: ${errorMsg}`, steps);
    }

    const tokenId = verifyData.result.id;

    // Derive S3 Secret Access Key = SHA-256(token value)
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const secretAccessKey = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    steps[stepIndex].status = 'success';
    return {
      accessKeyId: tokenId,
      secretAccessKey
    };
  } catch (error) {
    if (error instanceof SetupError) {
      throw error;
    }
    logger.error('Failed to derive R2 credentials', error instanceof Error ? error : new Error(String(error)));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to derive R2 credentials';
    throw new SetupError('create_r2_token', 'Failed to derive R2 credentials', steps);
  }
}

/**
 * Resolve the deployed worker's script name via the Cloudflare API.
 * Workers Builds may rename the worker (e.g., user picks "my-app" during deploy).
 * We find the script whose subdomain matches the current request hostname.
 */
async function resolveWorkerName(
  token: string,
  accountId: string,
  requestUrl: string
): Promise<string> {
  const hostname = new URL(requestUrl).hostname;

  if (hostname.endsWith('.workers.dev')) {
    return hostname.split('.')[0];
  }

  // For custom domains or local dev, look up via the API
  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json() as {
      success: boolean;
      result?: Array<{ id: string }>;
    };
    // If only one script exists, it must be ours
    if (data.success && data.result?.length === 1) {
      return data.result[0].id;
    }
    // Multiple scripts — look for one containing "claudeflare"
    if (data.success && data.result) {
      const match = data.result.find(s => s.id.includes('claudeflare'));
      if (match) return match.id;
    }
  } catch {
    // Fall through to default
  }

  return 'claudeflare';
}

/**
 * Deploy the latest worker version so that the standard secrets API can be used.
 * This is needed when `wrangler versions upload` (code-only) was used instead of
 * `wrangler deploy`, leaving the latest version in a non-deployed state.
 * Endpoint: POST /accounts/{accountId}/workers/scripts/{scriptName}/deployments
 */
async function deployLatestVersion(
  token: string,
  accountId: string,
  workerName: string
): Promise<boolean> {
  try {
    // 1. List versions to get the latest version ID
    const versionsRes = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${workerName}/versions`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const versionsData = await versionsRes.json() as {
      success: boolean;
      result?: { items?: Array<{ id: string }> };
    };

    if (!versionsData.success || !versionsData.result?.items?.length) {
      logger.error('Failed to list worker versions', new Error(JSON.stringify(versionsData)));
      return false;
    }

    const latestVersionId = versionsData.result.items[0].id;

    // 2. Create a deployment with the latest version at 100% traffic
    const deployRes = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${workerName}/deployments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          strategy: 'percentage',
          versions: [{ version_id: latestVersionId, percentage: 100 }]
        })
      }
    );

    if (!deployRes.ok) {
      const errBody = await deployRes.text();
      logger.error('Failed to deploy latest version', new Error(`${deployRes.status}: ${errBody}`));
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error deploying latest version', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

/**
 * Set a single worker secret via the standard API.
 * Returns the response and parsed error codes (if any).
 */
async function putSecret(
  token: string,
  accountId: string,
  workerName: string,
  name: string,
  value: string
): Promise<{ ok: boolean; errorCode?: number; status: number }> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${workerName}/secrets`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, text: value, type: 'secret_text' })
    }
  );

  if (res.ok) {
    return { ok: true, status: res.status };
  }

  // Parse error body to extract Cloudflare error code
  try {
    const errData = await res.json() as {
      errors?: Array<{ code: number; message: string }>;
    };
    const cfErrorCode = errData.errors?.[0]?.code;
    return { ok: false, errorCode: cfErrorCode, status: res.status };
  } catch {
    return { ok: false, status: res.status };
  }
}

// Error code returned when the latest worker version is not deployed
const VERSION_NOT_DEPLOYED_ERR_CODE = 10215;

/**
 * Step 3: Set worker secrets (R2 credentials, API token, admin secret)
 *
 * Uses the standard secrets API (PUT .../secrets). If Cloudflare returns
 * error 10215 (latest version not deployed — common after `wrangler versions upload`),
 * falls back by deploying the latest version first, then retrying.
 */
async function handleSetSecrets(
  token: string,
  accountId: string,
  r2AccessKeyId: string,
  r2SecretAccessKey: string,
  requestUrl: string,
  steps: SetupStep[]
): Promise<string> {
  steps.push({ step: 'set_secrets', status: 'pending' });
  const stepIndex = steps.length - 1;
  // Resolve worker name from the Cloudflare API — handles Deploy button renaming
  const workerName = await resolveWorkerName(token, accountId, requestUrl);

  // Generate admin secret
  const adminSecretArray = new Uint8Array(32);
  crypto.getRandomValues(adminSecretArray);
  const adminSecret = Array.from(adminSecretArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const secrets = {
    R2_ACCESS_KEY_ID: r2AccessKeyId,
    R2_SECRET_ACCESS_KEY: r2SecretAccessKey,
    CLOUDFLARE_API_TOKEN: token,
    ADMIN_SECRET: adminSecret
  };

  try {
    let deployedLatestVersion = false;

    for (const [name, value] of Object.entries(secrets)) {
      let result = await putSecret(token, accountId, workerName, name, value);

      // If error 10215 (version not deployed), deploy the latest version and retry
      if (!result.ok && result.errorCode === VERSION_NOT_DEPLOYED_ERR_CODE && !deployedLatestVersion) {
        logger.info(`Secret API returned error ${VERSION_NOT_DEPLOYED_ERR_CODE}, deploying latest version first`);
        const deployed = await deployLatestVersion(token, accountId, workerName);
        deployedLatestVersion = true;

        if (deployed) {
          // Retry the secret after deploying
          result = await putSecret(token, accountId, workerName, name, value);
        }
      }

      if (!result.ok) {
        logger.error(`Failed to set secret ${name} on ${workerName}`, new Error(`status: ${result.status}, errorCode: ${result.errorCode}`));
        steps[stepIndex].status = 'error';
        steps[stepIndex].error = `Failed to set secret ${name}: ${result.status}`;
        throw new SetupError('set_secrets', `Failed to set secret ${name} on worker "${workerName}": ${result.status}`, steps);
      }
    }
    steps[stepIndex].status = 'success';
    return adminSecret;
  } catch (error) {
    if (error instanceof SetupError) {
      throw error;
    }
    logger.error('Failed to set secrets', error instanceof Error ? error : new Error(String(error)));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to configure worker secrets';
    throw new SetupError('set_secrets', 'Failed to configure worker secrets', steps);
  }
}

/**
 * Step 4: Configure custom domain with worker route
 */
async function handleConfigureCustomDomain(
  token: string,
  accountId: string,
  customDomain: string,
  requestUrl: string,
  steps: SetupStep[]
): Promise<string> {
  steps.push({ step: 'configure_custom_domain', status: 'pending' });
  const stepIndex = steps.length - 1;

  // Get zone ID for the custom domain
  const domainParts = customDomain.split('.');
  const zoneName = domainParts.slice(-2).join('.');

  let zonesRes: Response;
  try {
    zonesRes = await fetch(
      `${CF_API_BASE}/zones?name=${zoneName}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
  } catch (error) {
    logger.error('Failed to fetch zones API', error instanceof Error ? error : new Error(String(error)));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to connect to Cloudflare Zones API';
    throw new SetupError('configure_custom_domain', 'Failed to connect to Cloudflare Zones API', steps);
  }

  const zonesData = await zonesRes.json() as {
    success: boolean;
    result?: Array<{ id: string }>;
    errors?: Array<{ code: number; message: string }>;
  };

  // Check for authentication/permission errors from the Zones API
  if (!zonesData.success) {
    const cfErrors = zonesData.errors || [];
    const errorMessages = cfErrors.map(e => `${e.code}: ${e.message}`).join(', ');
    logger.error('Cloudflare Zones API error', new Error(errorMessages || 'Unknown zones API error'), {
      domain: zoneName,
      status: zonesRes.status,
      errors: cfErrors,
    });

    // Detect auth/permission errors (HTTP 403, or Cloudflare error codes 9103/10000)
    const isAuthError = zonesRes.status === 403
      || zonesRes.status === 401
      || cfErrors.some(e => e.code === 9103 || e.code === 10000)
      || cfErrors.some(e => e.message?.toLowerCase().includes('authentication') || e.message?.toLowerCase().includes('permission'));

    if (isAuthError) {
      const permError = 'API token lacks Zone permissions required for custom domain configuration. '
        + 'Add "Zone > Zone > Read" and "Zone > Workers Routes > Edit" permissions to your token, '
        + 'or skip custom domain setup.';
      steps[stepIndex].status = 'error';
      steps[stepIndex].error = permError;
      throw new SetupError('configure_custom_domain', permError, steps);
    }

    steps[stepIndex].status = 'error';
    steps[stepIndex].error = `Zones API error: ${errorMessages || 'Unknown error'}`;
    throw new SetupError('configure_custom_domain', `Zones API error for ${zoneName}: ${errorMessages || 'Unknown error'}`, steps);
  }

  if (!zonesData.result?.length) {
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = `Zone not found for domain: ${zoneName}`;
    throw new SetupError('configure_custom_domain', `Zone not found for domain: ${zoneName}`, steps);
  }

  const zoneId = zonesData.result[0].id;

  // Resolve the actual worker script name (handles Deploy button renaming)
  const workerName = await resolveWorkerName(token, accountId, requestUrl);

  // Add worker route for custom domain
  const routeRes = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/workers/routes`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pattern: `${customDomain}/*`,
        script: workerName
      })
    }
  );

  if (!routeRes.ok) {
    const routeError = await routeRes.json() as { errors?: Array<{ code: number; message: string }> };
    // Route might already exist - that's OK (code 10020)
    if (!routeError.errors?.some(e => e.code === 10020)) {
      const routeErrMsg = routeError.errors?.[0]?.message || 'Failed to add worker route';
      logger.error('Worker route creation failed', new Error(routeErrMsg), {
        domain: customDomain,
        zoneId,
        status: routeRes.status,
        errors: routeError.errors,
      });

      // Detect auth errors on route creation too
      const isRouteAuthError = routeRes.status === 403
        || routeRes.status === 401
        || routeError.errors?.some(e => e.message?.toLowerCase().includes('authentication') || e.message?.toLowerCase().includes('permission'));

      if (isRouteAuthError) {
        const permError = 'API token lacks Zone permissions required for worker route creation. '
          + 'Add "Zone > Workers Routes > Edit" permission to your token, or skip custom domain setup.';
        steps[stepIndex].status = 'error';
        steps[stepIndex].error = permError;
        throw new SetupError('configure_custom_domain', permError, steps);
      }

      steps[stepIndex].status = 'error';
      steps[stepIndex].error = routeErrMsg;
      throw new SetupError('configure_custom_domain', routeErrMsg, steps);
    }
  }

  steps[stepIndex].status = 'success';
  return zoneId;
}

/**
 * Step 5: Create CF Access application for custom domain
 */
async function handleCreateAccessApp(
  token: string,
  accountId: string,
  customDomain: string,
  accessPolicy: { type: 'email' | 'domain' | 'everyone'; emails?: string[]; domain?: string } | undefined,
  steps: SetupStep[]
): Promise<void> {
  steps.push({ step: 'create_access_app', status: 'pending' });
  const stepIndex = steps.length - 1;

  const accessAppRes = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/access/apps`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Claudeflare',
        domain: customDomain,
        type: 'self_hosted',
        session_duration: '24h',
        auto_redirect_to_identity: false,
        skip_interstitial: true
      })
    }
  );
  const accessAppData = await accessAppRes.json() as {
    success: boolean;
    result?: { id: string };
    errors?: Array<{ message: string }>;
  };

  if (!accessAppData.success || !accessAppData.result) {
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = accessAppData.errors?.[0]?.message || 'Failed to create Access app';
    throw new SetupError('create_access_app', accessAppData.errors?.[0]?.message || 'Failed to create Access app', steps);
  }

  // Create Access policy
  const appId = accessAppData.result.id;
  let include: Array<Record<string, unknown>> = [];

  if (accessPolicy?.type === 'email' && accessPolicy.emails) {
    include = accessPolicy.emails.map(email => ({ email: { email } }));
  } else if (accessPolicy?.type === 'domain' && accessPolicy.domain) {
    include = [{ email_domain: { domain: accessPolicy.domain } }];
  } else {
    include = [{ everyone: {} }];
  }

  await fetch(
    `${CF_API_BASE}/accounts/${accountId}/access/apps/${appId}/policies`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Allow users',
        decision: 'allow',
        include
      })
    }
  );

  steps[stepIndex].status = 'success';
}

/**
 * GET /api/setup/status
 * Check if setup is complete (public endpoint)
 */
app.get('/status', async (c) => {
  const setupComplete = await c.env.KV.get('setup:complete');
  const configured = setupComplete === 'true';

  return c.json({
    configured,
    // Only return minimal info if not configured
    ...(configured ? {} : {
      requiredPermissions: [
        'Account > Workers Scripts > Edit',
        'Account > Workers R2 Storage > Edit',
        'Account > Workers KV Storage > Edit',
        'Account > Access: Apps and Policies > Edit (custom domain only)',
      ]
    })
  });
});

/**
 * POST /api/setup/verify-token
 * Verify API token has required permissions
 */
app.post('/verify-token', async (c) => {
  const { token } = await c.req.json<{ token: string }>();

  if (!token) {
    throw new ValidationError('Token is required');
  }

  try {
    // Verify token
    const verifyRes = await fetch(`${CF_API_BASE}/user/tokens/verify`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!verifyRes.ok) {
      throw new AuthError('Invalid token');
    }

    // Get account info
    const accountsRes = await fetch(`${CF_API_BASE}/accounts`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const accountsData = await accountsRes.json() as {
      success: boolean;
      result?: Array<{ id: string; name: string }>;
    };

    if (!accountsData.success || !accountsData.result?.length) {
      throw new ValidationError('Could not fetch account info');
    }

    const account = accountsData.result[0];

    return c.json({
      valid: true,
      account: {
        id: account.id,
        name: account.name
      }
    });
  } catch (error) {
    // Re-throw AppError instances (ValidationError, AuthError)
    if (error instanceof ValidationError || error instanceof AuthError) {
      throw error;
    }
    logger.error('Token verification error', error instanceof Error ? error : new Error(String(error)));
    throw new AuthError('Token verification failed');
  }
});

/**
 * POST /api/setup/configure
 * Main setup endpoint - configures everything using extracted step handlers
 */
app.post('/configure', async (c) => {
  const {
    token,
    customDomain,
    accessPolicy
  } = await c.req.json<{
    token: string;
    customDomain?: string;
    accessPolicy?: {
      type: 'email' | 'domain' | 'everyone';
      emails?: string[];
      domain?: string;
    };
  }>();

  if (!token) {
    throw new ValidationError('Token is required');
  }

  const steps: SetupStep[] = [];

  try {
    // Step 1: Get account ID
    const accountId = await handleGetAccount(token, steps);

    // Step 2: Derive R2 S3 credentials from user's token
    const { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey } =
      await handleDeriveR2Credentials(token, steps);

    // Step 3: Set worker secrets
    const adminSecret = await handleSetSecrets(
      token,
      accountId,
      r2AccessKeyId,
      r2SecretAccessKey,
      c.req.url,
      steps
    );

    // Step 4 & 5: Custom domain + CF Access (only if customDomain provided)
    if (customDomain) {
      await handleConfigureCustomDomain(token, accountId, customDomain, c.req.url, steps);
      await handleCreateAccessApp(token, accountId, customDomain, accessPolicy, steps);

      // Store custom domain in KV
      await c.env.KV.put('setup:custom_domain', customDomain);
    }

    // Final step: Mark setup as complete
    steps.push({ step: 'finalize', status: 'pending' });
    await c.env.KV.put('setup:complete', 'true');
    await c.env.KV.put('setup:account_id', accountId);
    await c.env.KV.put('setup:r2_endpoint', `https://${accountId}.r2.cloudflarestorage.com`);
    await c.env.KV.put('setup:completed_at', new Date().toISOString());
    steps[steps.length - 1].status = 'success';

    // Get the workers.dev URL from request
    const url = new URL(c.req.url);
    const workersDevUrl = `https://${url.host}`;

    return c.json({
      success: true,
      steps,
      workersDevUrl,
      customDomainUrl: customDomain ? `https://${customDomain}` : null,
      adminSecret,
      accountId,
    });

  } catch (error) {
    if (error instanceof SetupError || error instanceof ValidationError) {
      throw error;
    }
    logger.error('Configuration error', error instanceof Error ? error : new Error(String(error)));
    throw new SetupError('unknown', 'Configuration failed', steps);
  }
});

/**
 * POST /api/setup/reset
 * Reset setup state (admin only, requires existing ADMIN_SECRET)
 */
app.post('/reset', async (c) => {
  const authHeader = c.req.header('Authorization');
  const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!providedSecret || providedSecret !== c.env.ADMIN_SECRET) {
    throw new AuthError('Unauthorized');
  }

  // Clear setup state
  await c.env.KV.delete('setup:complete');
  await c.env.KV.delete('setup:account_id');
  await c.env.KV.delete('setup:completed_at');
  await c.env.KV.delete('setup:custom_domain');
  await c.env.KV.delete('setup:r2_endpoint');

  return c.json({ success: true, message: 'Setup state reset' });
});

/**
 * POST /api/setup/reset-for-tests
 * Test-only reset endpoint (DEV_MODE required)
 * Used by E2E tests to reset setup state before test runs
 */
app.post('/reset-for-tests', async (c) => {
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
app.post('/restore-for-tests', async (c) => {
  if (c.env.DEV_MODE !== 'true') {
    throw new AuthError('Not available in production');
  }

  // Restore setup state
  await c.env.KV.put('setup:complete', 'true');

  return c.json({ success: true, message: 'Setup state restored for tests' });
});

export default app;
