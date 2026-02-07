import { SetupError, toErrorMessage } from '../../lib/error-types';
import { CF_API_BASE, logger } from './shared';
import type { SetupStep } from './shared';

/**
 * Step 5: Create or update CF Access application for custom domain
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
    throw new SetupError(accessAppData.errors?.[0]?.message || `Failed to ${existingAppId ? 'update' : 'create'} Access app`, steps);
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
