/**
 * R2 bucket management via Cloudflare API
 */

import { createLogger } from './logger';

const logger = createLogger('r2-admin');

interface CreateBucketResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result?: {
    name: string;
    creation_date: string;
    location: string;
  };
}

/**
 * Check if a bucket exists
 */
async function bucketExists(
  accountId: string,
  apiToken: string,
  bucketName: string
): Promise<boolean> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.ok;
}

/**
 * Create an R2 bucket if it doesn't exist
 * Returns true if bucket exists or was created, false on error
 */
export async function createBucketIfNotExists(
  accountId: string,
  apiToken: string,
  bucketName: string
): Promise<{ success: boolean; error?: string; created?: boolean }> {
  // Check if bucket already exists
  const exists = await bucketExists(accountId, apiToken, bucketName);
  if (exists) {
    logger.info('Bucket already exists', { bucketName });
    return { success: true, created: false };
  }

  // Create the bucket
  logger.info('Creating bucket', { bucketName });

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: bucketName }),
    }
  );

  const data = await response.json() as CreateBucketResponse;

  if (!response.ok || !data.success) {
    const errorMsg = data.errors?.[0]?.message || `HTTP ${response.status}`;
    logger.error('Failed to create bucket', undefined, { bucketName, errorMsg });
    return { success: false, error: errorMsg };
  }

  logger.info('Bucket created successfully', { bucketName });
  return { success: true, created: true };
}
