import { Hono } from 'hono';
import type { Env } from '../types';
import { createLogger } from '../lib/logger';
import { ValidationError, AuthError, SetupError, toError, toErrorMessage } from '../lib/error-types';
import { resetCorsOriginsCache } from '../lib/cors-cache';
import { resetAuthConfigCache } from '../lib/access';
import { createRateLimiter } from '../middleware/rate-limit';
import { verifyAdminSecret } from '../lib/admin-auth';
// R2 permission IDs no longer needed — we derive S3 credentials from the user's token

const logger = createLogger('setup');

const app = new Hono<{ Bindings: Env }>();

/**
 * Rate limiter for setup configure endpoint
 * Limits to 5 configure attempts per minute
 */
const setupRateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 5,
  keyPrefix: 'setup-configure',
});

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
    logger.error('Failed to get account', toError(error));
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
  steps.push({ step: 'derive_r2_credentials', status: 'pending' });
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
      throw new SetupError('derive_r2_credentials', `Failed to derive R2 credentials: ${errorMsg}`, steps);
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
    logger.error('Failed to derive R2 credentials', toError(error));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to derive R2 credentials';
    throw new SetupError('derive_r2_credentials', 'Failed to derive R2 credentials', steps);
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
    logger.error('Error deploying latest version', toError(error));
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
    logger.error('Failed to set secrets', toError(error));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to configure worker secrets';
    throw new SetupError('set_secrets', 'Failed to configure worker secrets', steps);
  }
}

/**
 * Detect common Cloudflare auth/permission errors from API responses.
 * Returns a descriptive error message if an auth issue is detected, or null otherwise.
 */
function detectCloudflareAuthError(
  status: number,
  errors: Array<{ code?: number; message?: string }>
): string | null {
  const isAuthStatus = status === 401 || status === 403;
  const hasAuthErrorCode = errors.some(e => e.code === 9103 || e.code === 10000);
  const hasAuthMessage = errors.some(e =>
    e.message?.toLowerCase().includes('authentication')
    || e.message?.toLowerCase().includes('permission')
    || e.message?.toLowerCase().includes('invalid access token')
  );

  if (isAuthStatus || hasAuthErrorCode || hasAuthMessage) {
    const details = errors.map(e => `${e.code ?? '?'}: ${e.message ?? 'unknown'}`).join(', ');
    return `Authentication/permission error (HTTP ${status}): ${details}`;
  }

  return null;
}

/**
 * Resolve the Cloudflare zone ID for a given domain.
 * Looks up the zone by the root domain (last two parts of the FQDN).
 */
async function resolveZone(
  token: string,
  domain: string,
  steps: SetupStep[],
  stepIndex: number
): Promise<string> {
  const domainParts = domain.split('.');
  const zoneName = domainParts.slice(-2).join('.');

  let zonesRes: Response;
  try {
    zonesRes = await fetch(
      `${CF_API_BASE}/zones?name=${zoneName}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
  } catch (error) {
    logger.error('Failed to fetch zones API', toError(error));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to connect to Cloudflare Zones API';
    throw new SetupError('configure_custom_domain', 'Failed to connect to Cloudflare Zones API', steps);
  }

  const zonesData = await zonesRes.json() as {
    success: boolean;
    result?: Array<{ id: string }>;
    errors?: Array<{ code: number; message: string }>;
  };

  if (!zonesData.success) {
    const cfErrors = zonesData.errors || [];
    const errorMessages = cfErrors.map(e => `${e.code}: ${e.message}`).join(', ');
    logger.error('Cloudflare Zones API error', new Error(errorMessages || 'Unknown zones API error'), {
      domain: zoneName,
      status: zonesRes.status,
      errors: cfErrors,
    });

    const authError = detectCloudflareAuthError(zonesRes.status, cfErrors);
    if (authError) {
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

  return zonesData.result[0].id;
}

/**
 * Create or update a DNS CNAME record pointing the custom domain to the workers.dev target.
 * Resolves the account subdomain, looks up existing records, and performs upsert.
 */
async function upsertDnsRecord(
  token: string,
  accountId: string,
  zoneId: string,
  domain: string,
  workerName: string,
  requestUrl: string,
  steps: SetupStep[],
  stepIndex: number
): Promise<void> {
  // Resolve account subdomain for workers.dev target
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
      const hostname = new URL(requestUrl).hostname;
      if (hostname.endsWith('.workers.dev')) {
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
    logger.error('Failed to get account subdomain', toError(error));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to determine workers.dev subdomain for DNS record';
    throw new SetupError('configure_custom_domain', 'Failed to determine workers.dev subdomain for DNS record', steps);
  }

  const workersDevTarget = `${workerName}.${accountSubdomain}.workers.dev`;
  const domainParts = domain.split('.');
  const subdomain = domainParts.length > 2 ? domainParts.slice(0, -2).join('.') : '@';

  // Check if DNS record already exists
  let existingDnsRecordId: string | null = null;
  try {
    const dnsLookupRes = await fetch(
      `${CF_API_BASE}/zones/${zoneId}/dns_records?name=${domain}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const dnsLookupData = await dnsLookupRes.json() as {
      success: boolean;
      result?: Array<{ id: string; type: string }>;
    };
    if (dnsLookupData.success && dnsLookupData.result?.length) {
      const cnameRecord = dnsLookupData.result.find(r => r.type === 'CNAME');
      existingDnsRecordId = cnameRecord?.id || dnsLookupData.result[0]?.id || null;
      if (existingDnsRecordId) {
        logger.info('Found existing DNS record, will update', { domain, recordId: existingDnsRecordId });
      }
    }
  } catch (lookupError) {
    logger.warn('DNS record lookup failed, falling back to create', {
      domain,
      error: toErrorMessage(lookupError)
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
      logger.info('DNS record already exists (detected via create error)', { domain, subdomain, target: workersDevTarget });
    } else {
      const dnsErrMsg = dnsError.errors?.[0]?.message || `Failed to ${existingDnsRecordId ? 'update' : 'create'} DNS record`;
      logger.error(`DNS record ${existingDnsRecordId ? 'update' : 'creation'} failed`, new Error(dnsErrMsg), {
        domain,
        subdomain,
        target: workersDevTarget,
        zoneId,
        method: dnsMethod,
        status: dnsRecordRes.status,
        errors: dnsError.errors,
      });

      const authError = detectCloudflareAuthError(dnsRecordRes.status, dnsError.errors || []);
      if (authError) {
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
    logger.info(`DNS record ${existingDnsRecordId ? 'updated' : 'created'}`, { domain, subdomain, target: workersDevTarget });
  }
}

/**
 * Create a worker route mapping the custom domain pattern to the worker script.
 * Silently succeeds if the route already exists (error code 10020).
 */
async function createWorkerRoute(
  token: string,
  zoneId: string,
  domain: string,
  workerName: string,
  steps: SetupStep[],
  stepIndex: number
): Promise<void> {
  const routeRes = await fetch(
    `${CF_API_BASE}/zones/${zoneId}/workers/routes`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pattern: `${domain}/*`,
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
        domain,
        zoneId,
        status: routeRes.status,
        errors: routeError.errors,
      });

      const authError = detectCloudflareAuthError(routeRes.status, routeError.errors || []);
      if (authError) {
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
}

/**
 * Step 4: Configure custom domain with DNS CNAME record and worker route.
 * Orchestrates zone resolution, DNS upsert, and worker route creation.
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

  // Resolve zone ID for the custom domain
  const zoneId = await resolveZone(token, customDomain, steps, stepIndex);

  // Extract worker name from request hostname
  const workerName = getWorkerNameFromHostname(requestUrl);

  // Create or update DNS CNAME record pointing to workers.dev
  await upsertDnsRecord(token, accountId, zoneId, customDomain, workerName, requestUrl, steps, stepIndex);

  // Add worker route for custom domain
  await createWorkerRoute(token, zoneId, customDomain, workerName, steps, stepIndex);

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
  steps: SetupStep[],
  kv: KVNamespace
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
      error: toErrorMessage(lookupError)
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
    result?: { id: string; aud: string };
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

  // Store the Access app audience tag (aud) in KV for JWT verification
  if (accessAppData.result.aud) {
    await kv.put('setup:access_aud', accessAppData.result.aud);
    logger.info('Stored access_aud in KV', { aud: accessAppData.result.aud.substring(0, 16) + '...' });
  }

  // Fetch and store the auth_domain from the Access organization
  try {
    const orgRes = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/access/organizations`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const orgData = await orgRes.json() as {
      success: boolean;
      result?: { auth_domain: string };
    };

    if (orgData.success && orgData.result?.auth_domain) {
      await kv.put('setup:auth_domain', orgData.result.auth_domain);
      logger.info('Stored auth_domain in KV', { authDomain: orgData.result.auth_domain });
    } else {
      logger.warn('Could not retrieve auth_domain from Access organization', { success: orgData.success });
    }
  } catch (orgError) {
    // Non-fatal: JWT verification will fall back to header-based trust
    logger.warn('Failed to fetch Access organization for auth_domain', {
      error: toErrorMessage(orgError)
    });
  }

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
        const policyUpdateRes = await fetch(
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
        if (!policyUpdateRes.ok) {
          const errorText = await policyUpdateRes.text();
          logger.warn(`Policy update failed: ${policyUpdateRes.status} - ${errorText}`);
        }
        logger.info('Access policy updated', { appId, policyId: existingPolicy.id });
        steps[stepIndex].status = 'success';
        return;
      }
    } catch (policyLookupError) {
      // If policy lookup fails, create a new policy
      logger.warn('Access policy lookup failed, creating new policy', {
        appId,
        error: toErrorMessage(policyLookupError)
      });
    }
  }

  // Create new policy (for new apps or if policy lookup failed)
  const policyCreateRes = await fetch(
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
  if (!policyCreateRes.ok) {
    const errorText = await policyCreateRes.text();
    logger.warn(`Policy creation failed: ${policyCreateRes.status} - ${errorText}`);
  }

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
    logger.error('Token detection error', toError(error));
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
    throw new SetupError('unknown', 'Configuration failed', steps);
  }
});

/**
 * POST /api/setup/reset
 * Reset setup state (admin only, requires existing ADMIN_SECRET)
 */
app.post('/reset', async (c) => {
  verifyAdminSecret(c.env, c.req.header('Authorization'));

  // Clear setup state
  await c.env.KV.delete('setup:complete');
  await c.env.KV.delete('setup:account_id');
  await c.env.KV.delete('setup:completed_at');
  await c.env.KV.delete('setup:custom_domain');
  await c.env.KV.delete('setup:r2_endpoint');
  await c.env.KV.delete('setup:auth_domain');
  await c.env.KV.delete('setup:access_aud');

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
  verifyAdminSecret(c.env, c.req.header('Authorization'));

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
  verifyAdminSecret(c.env, c.req.header('Authorization'));

  // Restore setup state
  await c.env.KV.put('setup:complete', 'true');

  return c.json({ success: true, message: 'Setup state restored for tests' });
});

export default app;
