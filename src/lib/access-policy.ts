import type { Env } from '../types';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export interface UserEntry {
  email: string;
  addedBy: string;
  addedAt: string;
}

/**
 * Get all user entries from KV (keys starting with "user:")
 */
export async function getAllUsers(kv: KVNamespace): Promise<UserEntry[]> {
  const list = await kv.list({ prefix: 'user:' });
  const users: UserEntry[] = [];
  for (const key of list.keys) {
    const data = await kv.get(key.name, 'json');
    if (data) {
      users.push({ email: key.name.replace('user:', ''), ...(data as Omit<UserEntry, 'email'>) });
    }
  }
  return users;
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
  const appsRes = await fetch(`${CF_API_BASE}/accounts/${accountId}/access/apps`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const appsData = await appsRes.json() as any;

  if (!appsData.success) return;

  const app = appsData.result?.find((a: any) => a.domain === domain);
  if (!app) return;

  // Get existing policies
  const policiesRes = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/access/apps/${app.id}/policies`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const policiesData = await policiesRes.json() as any;

  if (!policiesData.success || !policiesData.result?.length) return;

  const policy = policiesData.result[0];

  // Update policy with email includes
  await fetch(
    `${CF_API_BASE}/accounts/${accountId}/access/apps/${app.id}/policies/${policy.id}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...policy,
        include: emails.map(email => ({ email: { email } })),
      }),
    }
  );
}
