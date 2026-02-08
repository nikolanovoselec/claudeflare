import type { Env, UserRole } from '../types';
import { createLogger } from './logger';
import { listAllKvKeys, emailFromKvKey } from './kv-keys';
import { CF_API_BASE } from './constants';
import { cfApiCB } from './circuit-breakers';

const logger = createLogger('access-policy');

/** Response shape from the CF Access applications list endpoint */
interface CfAccessAppsResponse {
  success: boolean;
  result?: Array<{ id: string; domain: string; aud: string }>;
}

/** Response shape from the CF Access policies list endpoint */
interface CfAccessPoliciesResponse {
  success: boolean;
  result?: Array<{ id: string; name: string; decision: string; include: unknown[]; exclude: unknown[] }>;
}

interface UserEntry {
  email: string;
  addedBy: string;
  addedAt: string;
  role: UserRole;
}

/**
 * Get all user entries from KV (keys starting with "user:")
 */
export async function getAllUsers(kv: KVNamespace): Promise<UserEntry[]> {
  const keys = await listAllKvKeys(kv, 'user:');
  const results = await Promise.all(
    keys.map(async (key) => {
      const data = await kv.get(key.name, 'json') as Omit<UserEntry, 'email'> | null;
      if (!data) return null;
      return {
        ...data,
        email: emailFromKvKey(key.name),
        role: data.role ?? 'user',
      } as UserEntry;
    })
  );
  return results.filter((u): u is UserEntry => u !== null);
}

/**
 * Update CF Access policy to include all users from KV.
 * Finds the access app by domain, then updates its policy's include rules.
 */
export async function syncAccessPolicy(
  token: string,
  accountId: string,
  domain: string,
  kv: KVNamespace
): Promise<void> {
  const users = await getAllUsers(kv);
  const emails = users.map(u => u.email);

  if (emails.length === 0) return;

  // Find the access app by domain
  const appsRes = await cfApiCB.execute(() =>
    fetch(`${CF_API_BASE}/accounts/${accountId}/access/apps`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  );
  const appsData = await appsRes.json() as CfAccessAppsResponse;

  if (!appsData.success) {
    logger.error('syncAccessPolicy: Failed to fetch Access apps', new Error('API request failed'), { response: appsData });
    return;
  }

  const app = appsData.result?.find((a) => a.domain === domain);
  if (!app) return;

  // Get existing policies
  const policiesRes = await cfApiCB.execute(() =>
    fetch(
      `${CF_API_BASE}/accounts/${accountId}/access/apps/${app.id}/policies`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
  );
  const policiesData = await policiesRes.json() as CfAccessPoliciesResponse;

  if (!policiesData.success || !policiesData.result?.length) return;

  // Prefer the 'Allow Users' policy by name; fall back to first policy
  const policy = policiesData.result.find(
    (p) => p.name === 'Allow Users' || p.name === 'Allow users'
  ) || policiesData.result[0];

  // Update policy with email includes - explicitly pick fields for the PUT body
  const updateRes = await cfApiCB.execute(() =>
    fetch(
      `${CF_API_BASE}/accounts/${accountId}/access/apps/${app.id}/policies/${policy.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: policy.name,
          decision: policy.decision,
          include: emails.map(email => ({ email: { email } })),
          exclude: policy.exclude,
        }),
      }
    )
  );

  if (!updateRes.ok) {
    const updateData = await updateRes.json().catch(() => null);
    logger.error('syncAccessPolicy: Failed to update Access policy', new Error(`HTTP ${updateRes.status}`), {
      status: updateRes.status,
      response: updateData,
      appId: app.id,
      policyId: policy.id,
    });
  }
}
