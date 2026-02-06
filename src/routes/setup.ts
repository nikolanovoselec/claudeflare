import { Hono } from 'hono';
import type { Env } from '../types';
import { createLogger } from '../lib/logger';
import { ValidationError, AuthError, SetupError } from '../lib/error-types';
import { resetCorsOriginsCache } from '../lib/cors-cache';
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
 * Extract the worker name from the request hostname.
 * For workers.dev: first part of hostname (e.g., "claudeflare" from "claudeflare.test.workers.dev")
 * For custom domains or other: default to "claudeflare"
 */
function getWorkerNameFromHostname(requestUrl: string): string {
  const hostname = new URL(requestUrl).hostname;

  if (hostname.endsWith('.workers.dev')) {
    return hostname.split('.')[0];
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
 * Step 3: Set worker secrets (R2 credentials, admin secret)
 *
 * Uses the standard secrets API (PUT .../secrets). If Cloudflare returns
 * error 10215 (latest version not deployed — common after `wrangler versions upload`),
 * falls back by deploying the latest version first, then retrying.
 *
 * Note: CLOUDFLARE_API_TOKEN is NOT set here — it's already set by GitHub Actions.
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
  // Extract worker name from the request hostname
  const workerName = getWorkerNameFromHostname(requestUrl);

  // Generate admin secret
  const adminSecretArray = new Uint8Array(32);
  crypto.getRandomValues(adminSecretArray);
  const adminSecret = Array.from(adminSecretArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const secrets = {
    R2_ACCESS_KEY_ID: r2AccessKeyId,
    R2_SECRET_ACCESS_KEY: r2SecretAccessKey,
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
 * Step 4: Configure custom domain with DNS CNAME record and worker route
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
        + 'Add "Zone > Zone > Read", "Zone > DNS > Edit", and "Zone > Workers Routes > Edit" permissions to your token, '
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

  // Extract worker name from request hostname
  const workerName = getWorkerNameFromHostname(requestUrl);

  // Get the account subdomain for workers.dev URL
  // Format: {workerName}.{account-subdomain}.workers.dev
  // We need to resolve account subdomain from the API
  let accountSubdomain: string;
  try {
    const subdomainRes = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/subdomain`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const subdomainData = await subdomainRes.json() as {
      success: boolean;
      result?: { subdomain: string };
      errors?: Array<{ code: number; message: string }>;
    };

    if (!subdomainData.success || !subdomainData.result?.subdomain) {
      // Fallback: use the request URL if it's already on workers.dev
      const hostname = new URL(requestUrl).hostname;
      if (hostname.endsWith('.workers.dev')) {
        // Extract account subdomain from hostname: {worker}.{account-subdomain}.workers.dev
        const parts = hostname.split('.');
        if (parts.length >= 3) {
          accountSubdomain = parts[parts.length - 3];
        } else {
          throw new Error('Could not determine account subdomain');
        }
      } else {
        throw new Error('Could not determine account subdomain');
      }
    } else {
      accountSubdomain = subdomainData.result.subdomain;
    }
  } catch (error) {
    logger.error('Failed to get account subdomain', error instanceof Error ? error : new Error(String(error)));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to determine workers.dev subdomain for DNS record';
    throw new SetupError('configure_custom_domain', 'Failed to determine workers.dev subdomain for DNS record', steps);
  }

  const workersDevTarget = `${workerName}.${accountSubdomain}.workers.dev`;

  // Step 4a: Create or update DNS CNAME record pointing to workers.dev
  // Extract subdomain part (e.g., "claude" from "claude.example.com")
  const subdomain = domainParts.length > 2 ? domainParts.slice(0, -2).join('.') : '@';

  // Check if DNS record already exists
  let existingDnsRecordId: string | null = null;
  try {
    const dnsLookupRes = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records?name=${customDomain}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const dnsLookupData = await dnsLookupRes.json() as {
      success: boolean;
      result?: Array<{ id: string; type: string }>;
    };
    if (dnsLookupData.success && dnsLookupData.result?.length) {
      // Find a CNAME record (prefer CNAME, but accept any record to update)
      const cnameRecord = dnsLookupData.result.find(r => r.type === 'CNAME');
      existingDnsRecordId = cnameRecord?.id || dnsLookupData.result[0]?.id || null;
      if (existingDnsRecordId) {
        logger.info('Found existing DNS record, will update', { domain: customDomain, recordId: existingDnsRecordId });
      }
    }
  } catch (lookupError) {
    // If lookup fails, fall back to create (POST)
    logger.warn('DNS record lookup failed, falling back to create', {
      domain: customDomain,
      error: lookupError instanceof Error ? lookupError.message : String(lookupError)
    });
  }

  // Use PUT to update existing record, or POST to create new one
  const dnsMethod = existingDnsRecordId ? 'PUT' : 'POST';
  const dnsUrl = existingDnsRecordId
    ? `${CF_API_BASE}/zones/${zoneId}/dns_records/${existingDnsRecordId}`
    : `${CF_API_BASE}/zones/${zoneId}/dns_records`;

  const dnsRecordRes = await fetch(
    dnsUrl,
    {
      method: dnsMethod,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'CNAME',
        name: subdomain,
        content: workersDevTarget,
        proxied: true
      })
    }
  );

  if (!dnsRecordRes.ok) {
    const dnsError = await dnsRecordRes.json() as { errors?: Array<{ code: number; message: string }> };
    // Record might already exist - that's OK (code 81057) - only relevant for POST
    if (dnsMethod === 'POST' && dnsError.errors?.some(e => e.code === 81057)) {
      // Record already exists but lookup didn't find it - log and continue
      logger.info('DNS record already exists (detected via create error)', { domain: customDomain, subdomain, target: workersDevTarget });
    } else {
      const dnsErrMsg = dnsError.errors?.[0]?.message || `Failed to ${existingDnsRecordId ? 'update' : 'create'} DNS record`;
      logger.error(`DNS record ${existingDnsRecordId ? 'update' : 'creation'} failed`, new Error(dnsErrMsg), {
        domain: customDomain,
        subdomain,
        target: workersDevTarget,
        zoneId,
        method: dnsMethod,
        status: dnsRecordRes.status,
        errors: dnsError.errors,
      });

      // Detect auth errors on DNS creation/update
      const isDnsAuthError = dnsRecordRes.status === 403
        || dnsRecordRes.status === 401
        || dnsError.errors?.some(e => e.message?.toLowerCase().includes('authentication') || e.message?.toLowerCase().includes('permission'));

      if (isDnsAuthError) {
        const permError = 'API token lacks DNS permissions required for custom domain configuration. '
          + 'Add "Zone > DNS > Edit" permission to your token, or skip custom domain setup.';
        steps[stepIndex].status = 'error';
        steps[stepIndex].error = permError;
        throw new SetupError('configure_custom_domain', permError, steps);
      }

      steps[stepIndex].status = 'error';
      steps[stepIndex].error = dnsErrMsg;
      throw new SetupError('configure_custom_domain', dnsErrMsg, steps);
    }
  } else {
    logger.info(`DNS record ${existingDnsRecordId ? 'updated' : 'created'}`, { domain: customDomain, subdomain, target: workersDevTarget });
  }

  // Step 4b: Add worker route for custom domain
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
 * Step 5: Create or update CF Access application for custom domain
 */
async function handleCreateAccessApp(
  token: string,
  accountId: string,
  customDomain: string,
  allowedUsers: string[],
  steps: SetupStep[]
): Promise<void> {
  steps.push({ step: 'create_access_app', status: 'pending' });
  const stepIndex = steps.length - 1;

  // Check if Access app already exists for this domain
  let existingAppId: string | null = null;
  try {
    const appsLookupRes = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/access/apps`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const appsLookupData = await appsLookupRes.json() as {
      success: boolean;
      result?: Array<{ id: string; domain: string; name: string }>;
    };
    if (appsLookupData.success && appsLookupData.result?.length) {
      // Find app matching this domain
      const existingApp = appsLookupData.result.find(app => app.domain === customDomain);
      if (existingApp) {
        existingAppId = existingApp.id;
        logger.info('Found existing Access app, will update', { domain: customDomain, appId: existingAppId, name: existingApp.name });
      }
    }
  } catch (lookupError) {
    // If lookup fails, fall back to create (POST)
    logger.warn('Access app lookup failed, falling back to create', {
      domain: customDomain,
      error: lookupError instanceof Error ? lookupError.message : String(lookupError)
    });
  }

  // Use PUT to update existing app, or POST to create new one
  const accessMethod = existingAppId ? 'PUT' : 'POST';
  const accessUrl = existingAppId
    ? `${CF_API_BASE}/accounts/${accountId}/access/apps/${existingAppId}`
    : `${CF_API_BASE}/accounts/${accountId}/access/apps`;

  const accessAppRes = await fetch(
    accessUrl,
    {
      method: accessMethod,
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
    errors?: Array<{ code?: number; message: string }>;
  };

  if (!accessAppData.success || !accessAppData.result) {
    // Check if this is an "already exists" error and we didn't detect it in lookup
    const alreadyExistsError = accessAppData.errors?.some(e =>
      e.message?.toLowerCase().includes('already exists') ||
      e.message?.toLowerCase().includes('duplicate')
    );

    if (alreadyExistsError && !existingAppId) {
      // App exists but we couldn't find it - this shouldn't happen often
      logger.warn('Access app already exists but was not found in lookup', { domain: customDomain });
      // We can't update without the ID, so just log and continue
      // The existing app should still work
      steps[stepIndex].status = 'success';
      return;
    }

    steps[stepIndex].status = 'error';
    steps[stepIndex].error = accessAppData.errors?.[0]?.message || `Failed to ${existingAppId ? 'update' : 'create'} Access app`;
    throw new SetupError('create_access_app', accessAppData.errors?.[0]?.message || `Failed to ${existingAppId ? 'update' : 'create'} Access app`, steps);
  }

  logger.info(`Access app ${existingAppId ? 'updated' : 'created'}`, { domain: customDomain, appId: accessAppData.result.id });

  // Create or update Access policy — always email-based using allowedUsers
  const appId = accessAppData.result.id;
  const include = allowedUsers.map(email => ({ email: { email } }));

  // For existing apps, we need to check for existing policies and update them
  if (existingAppId) {
    try {
      const policiesRes = await fetch(
        `${CF_API_BASE}/accounts/${accountId}/access/apps/${appId}/policies`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const policiesData = await policiesRes.json() as {
        success: boolean;
        result?: Array<{ id: string; name: string }>;
      };

      if (policiesData.success && policiesData.result?.length) {
        // Update the first policy (usually "Allow users")
        const existingPolicy = policiesData.result[0];
        await fetch(
          `${CF_API_BASE}/accounts/${accountId}/access/apps/${appId}/policies/${existingPolicy.id}`,
          {
            method: 'PUT',
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
        logger.info('Access policy updated', { appId, policyId: existingPolicy.id });
        steps[stepIndex].status = 'success';
        return;
      }
    } catch (policyLookupError) {
      // If policy lookup fails, create a new policy
      logger.warn('Access policy lookup failed, creating new policy', {
        appId,
        error: policyLookupError instanceof Error ? policyLookupError.message : String(policyLookupError)
      });
    }
  }

  // Create new policy (for new apps or if policy lookup failed)
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

  logger.info('Access policy created', { appId });
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
    tokenDetected: Boolean(c.env.CLOUDFLARE_API_TOKEN),
  });
});

/**
 * GET /api/setup/detect-token
 * Detect whether CLOUDFLARE_API_TOKEN is present in the environment (secret binding),
 * verify it against the Cloudflare API, and return account info.
 */
app.get('/detect-token', async (c) => {
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
    logger.error('Token detection error', error instanceof Error ? error : new Error(String(error)));
    return c.json({ detected: true, valid: false, error: 'Failed to verify token' });
  }
});

/**
 * POST /api/setup/configure
 * Main setup endpoint - configures everything using extracted step handlers
 *
 * Body: { customDomain: string, allowedUsers: string[], allowedOrigins?: string[] }
 * Token is read from env (CLOUDFLARE_API_TOKEN), not from request body.
 */
app.post('/configure', async (c) => {
  const {
    customDomain,
    allowedUsers,
    allowedOrigins
  } = await c.req.json<{
    customDomain?: string;
    allowedUsers?: string[];
    allowedOrigins?: string[];
  }>();

  // Token from env (already set by GitHub Actions deploy)
  const token = c.env.CLOUDFLARE_API_TOKEN;

  // Validate required fields
  if (!customDomain) {
    throw new ValidationError('customDomain is required');
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

    // Store users in KV
    for (const email of allowedUsers) {
      await c.env.KV.put(
        `user:${email}`,
        JSON.stringify({ addedBy: 'setup', addedAt: new Date().toISOString() })
      );
    }

    // Step 4 & 5: Custom domain + CF Access
    await handleConfigureCustomDomain(token, accountId, customDomain, c.req.url, steps);
    await handleCreateAccessApp(token, accountId, customDomain, allowedUsers, steps);

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

    // Reset in-memory CORS cache so subsequent requests pick up new KV origins
    resetCorsOriginsCache();

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
