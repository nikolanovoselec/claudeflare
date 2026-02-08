import { SetupError, toErrorMessage } from '../../lib/error-types';
import { parseCfResponse } from '../../lib/cf-api';
import { CF_API_BASE, logger } from './shared';
import type { SetupStep } from './shared';

/**
 * Look up an existing CF Access app by domain.
 * Returns the app ID if found, null otherwise.
 */
async function findExistingAccessApp(
  token: string,
  accountId: string,
  customDomain: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/access/apps`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json() as {
      success: boolean;
      result?: Array<{ id: string; domain: string; name: string }>;
    };
    if (data.success && data.result?.length) {
      const existing = data.result.find(app => app.domain === customDomain);
      if (existing) {
        logger.info('Found existing Access app, will update', { domain: customDomain, appId: existing.id, name: existing.name });
        return existing.id;
      }
    }
  } catch (lookupError) {
    logger.warn('Access app lookup failed, falling back to create', {
      domain: customDomain,
      error: toErrorMessage(lookupError)
    });
  }
  return null;
}

/**
 * Create or update the CF Access application.
 * Returns the app result (id + aud) on success, or handles "already exists" gracefully.
 * Throws SetupError on unrecoverable failures.
 */
async function upsertAccessApp(
  token: string,
  accountId: string,
  customDomain: string,
  existingAppId: string | null,
  steps: SetupStep[],
  stepIndex: number
): Promise<{ id: string; aud: string } | null> {
  const method = existingAppId ? 'PUT' : 'POST';
  const url = existingAppId
    ? `${CF_API_BASE}/accounts/${accountId}/access/apps/${existingAppId}`
    : `${CF_API_BASE}/accounts/${accountId}/access/apps`;

  const res = await fetch(url, {
    method,
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
  });
  const data = await parseCfResponse<{ id: string; aud: string }>(res);

  if (!data.success || !data.result) {
    const alreadyExistsError = data.errors?.some(e =>
      e.message?.toLowerCase().includes('already exists') ||
      e.message?.toLowerCase().includes('duplicate')
    );

    if (alreadyExistsError && !existingAppId) {
      logger.warn('Access app already exists but was not found in lookup', { domain: customDomain });
      steps[stepIndex].status = 'success';
      return null;
    }

    const rawError = data.errors?.[0]?.message || 'unknown';
    logger.error('Failed to upsert Access app', new Error(rawError), { domain: customDomain, method, errors: data.errors });
    const genericMsg = `Failed to ${existingAppId ? 'update' : 'create'} Access application`;
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = genericMsg;
    throw new SetupError(genericMsg, steps);
  }

  logger.info(`Access app ${existingAppId ? 'updated' : 'created'}`, { domain: customDomain, appId: data.result.id });
  return data.result;
}

/**
 * Store the Access app audience tag and auth_domain in KV.
 */
async function storeAccessConfig(
  token: string,
  accountId: string,
  aud: string | undefined,
  kv: KVNamespace
): Promise<void> {
  if (aud) {
    await kv.put('setup:access_aud', aud);
    logger.info('Stored access_aud in KV', { aud: aud.substring(0, 16) + '...' });
  }

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
}

/**
 * Create or update the Access policy for the given app.
 * For existing apps, tries to update the first existing policy.
 * Falls back to creating a new policy if update fails or no existing policy found.
 */
async function upsertAccessPolicy(
  token: string,
  accountId: string,
  appId: string,
  allowedUsers: string[],
  existingAppId: string | null,
  steps: SetupStep[],
  stepIndex: number
): Promise<void> {
  const include = allowedUsers.map(email => ({ email: { email } }));

  // For existing apps, try to update the existing policy first
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
        const existingPolicy = policiesData.result[0];
        const updateRes = await fetch(
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
        if (!updateRes.ok) {
          const errorText = await updateRes.text();
          logger.warn(`Policy update failed: ${updateRes.status} - ${errorText}`);
        } else {
          logger.info('Access policy updated', { appId, policyId: existingPolicy.id });
          steps[stepIndex].status = 'success';
          return;
        }
      }
    } catch (policyLookupError) {
      logger.warn('Access policy lookup failed, creating new policy', {
        appId,
        error: toErrorMessage(policyLookupError)
      });
    }
  }

  // Create new policy (for new apps or if policy lookup/update failed)
  const createRes = await fetch(
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
  if (!createRes.ok) {
    const errorText = await createRes.text();
    logger.error('Access policy creation failed', new Error(errorText), { appId, status: createRes.status });
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to configure Access policy';
  } else {
    logger.info('Access policy created', { appId });
    steps[stepIndex].status = 'success';
  }
}

/**
 * Step 5: Create or update CF Access application for custom domain.
 * Orchestrates: findExistingAccessApp -> upsertAccessApp -> storeAccessConfig -> upsertAccessPolicy
 */
export async function handleCreateAccessApp(
  token: string,
  accountId: string,
  customDomain: string,
  allowedUsers: string[],
  steps: SetupStep[],
  kv: KVNamespace
): Promise<void> {
  steps.push({ step: 'create_access_app', status: 'pending' });
  const stepIndex = steps.length - 1;

  const existingAppId = await findExistingAccessApp(token, accountId, customDomain);

  const appResult = await upsertAccessApp(token, accountId, customDomain, existingAppId, steps, stepIndex);
  if (!appResult) {
    // "already exists" graceful exit — step already marked success
    return;
  }

  await storeAccessConfig(token, accountId, appResult.aud, kv);
  await upsertAccessPolicy(token, accountId, appResult.id, allowedUsers, existingAppId, steps, stepIndex);
}
