import type { Env } from '../types';

/**
 * Resolve R2 configuration from env vars first, falling back to KV.
 * The setup wizard stores account_id in KV during initial configuration.
 * This allows Deploy-button deployments (no env vars) to work after wizard completion.
 */
export async function getR2Config(env: Env): Promise<{ accountId: string; endpoint: string }> {
  // Prefer env vars (set in wrangler.toml or .dev.vars)
  const envAccountId = env.R2_ACCOUNT_ID;
  if (envAccountId) {
    const endpoint = env.R2_ENDPOINT || `https://${envAccountId}.r2.cloudflarestorage.com`;
    return { accountId: envAccountId, endpoint };
  }

  // Fall back to KV (set by setup wizard)
  const kvAccountId = await env.KV.get('setup:account_id');
  if (kvAccountId) {
    return {
      accountId: kvAccountId,
      endpoint: `https://${kvAccountId}.r2.cloudflarestorage.com`,
    };
  }

  throw new Error(
    'R2 account ID not configured. Set R2_ACCOUNT_ID in environment variables, ' +
    'or run the setup wizard to store it in KV.'
  );
}
