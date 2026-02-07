import { SetupError, toError } from '../../lib/error-types';
import { CF_API_BASE, logger } from './shared';
import type { SetupStep } from './shared';

/**
 * Step 1: Get account ID from Cloudflare API
 */
export async function handleGetAccount(
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
      throw new SetupError('Failed to get account', steps);
    }

    steps[stepIndex].status = 'success';
    return accountsData.result[0].id;
  } catch (err) {
    if (err instanceof SetupError) {
      throw err;
    }
    logger.error('Failed to get account', toError(err));
    steps[stepIndex].status = 'error';
    steps[stepIndex].error = 'Failed to connect to Cloudflare API';
    throw new SetupError('Failed to connect to Cloudflare API', steps);
  }
}
