import type { Context } from 'hono';
import type { Env } from '../types';
import type { DurableObjectStub } from '@cloudflare/workers-types';
import { getContainer } from '@cloudflare/containers';
import { SESSION_ID_PATTERN, MAX_HEALTH_CHECK_ATTEMPTS, HEALTH_CHECK_INTERVAL_MS } from './constants';
import { containerHealthCB } from './circuit-breakers';
import { toErrorMessage } from './error-types';
import { createLogger } from './logger';

// Type for context variables set by container middleware
type ContainerVariables = {
  bucketName: string;
};

export function getSessionIdFromRequest(c: Context): string {
  const sessionId = c.req.query('sessionId') || c.req.header('X-Browser-Session');
  if (!sessionId) throw new Error('Missing sessionId parameter');
  return sessionId;
}

export function getContainerId(bucketName: string, sessionId: string): string {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}`);
  }
  return `${bucketName}-${sessionId}`;
}

export function getContainerContext<V extends ContainerVariables>(
  c: Context<{ Bindings: Env; Variables: V }>
) {
  const bucketName = c.get('bucketName');
  const sessionId = getSessionIdFromRequest(c);
  const containerId = getContainerId(bucketName, sessionId);
  const container = getContainer(c.env.CONTAINER, containerId);
  return { bucketName, sessionId, containerId, container };
}

// ============================================================================
// Health Check Utilities
// ============================================================================

/** @internal Test utility — not used in production */
export interface HealthCheckOptions {
  maxAttempts?: number;
  delayMs?: number;
  onProgress?: (attempt: number, maxAttempts: number) => void;
}

export interface HealthData {
  status: string;
  cpu?: number;
  memory?: number;
  disk?: number;
}

/**
 * @internal Test utility — not used in production
 *
 * Wait for a container to become healthy by polling the health endpoint.
 * Returns ok:true with health data on success, ok:false on failure after all attempts.
 */
const healthLogger = createLogger('container-health');

export async function waitForContainerHealth(
  container: DurableObjectStub,
  options?: HealthCheckOptions
): Promise<{ ok: boolean; data?: HealthData }> {
  const maxAttempts = options?.maxAttempts ?? MAX_HEALTH_CHECK_ATTEMPTS;
  const delayMs = options?.delayMs ?? HEALTH_CHECK_INTERVAL_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options?.onProgress?.(attempt, maxAttempts);

    try {
      const response = await container.fetch(new Request('http://container/health'));
      if (response.ok) {
        const data = await response.json() as HealthData;
        return { ok: true, data };
      }
    } catch (error) {
      healthLogger.info('Health check attempt failed', { attempt, maxAttempts });
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return { ok: false };
}

// ============================================================================
// Bucket Name Verification
// ============================================================================

/**
 * @internal Test utility — not used in production
 *
 * Verify that a container is configured with the expected bucket name.
 * Throws an error if the bucket names don't match.
 */
export async function ensureBucketName(
  container: DurableObjectStub,
  expectedBucket: string
): Promise<void> {
  const response = await container.fetch(new Request('http://container/bucket-name'));
  if (!response.ok) {
    throw new Error('Failed to get container bucket name');
  }
  const { bucketName: containerBucket } = await response.json() as { bucketName: string };

  if (containerBucket !== expectedBucket) {
    throw new Error(`Bucket mismatch: expected ${expectedBucket}, got ${containerBucket}`);
  }
}

// ============================================================================
// Circuit Breaker Health Check
// ============================================================================

export interface ContainerHealthResult {
  healthy: boolean;
  data?: HealthData;
  error?: string;
}

/**
 * Check container health using the circuit breaker.
 * This is a single check (not polling) that's protected by the circuit breaker.
 * Use this for quick status checks in routes.
 *
 * @param container - The container stub to check
 * @returns Health check result with status and optional data
 */
export async function checkContainerHealth(
  container: DurableObjectStub
): Promise<ContainerHealthResult> {
  try {
    const response = await containerHealthCB.execute(() =>
      container.fetch(new Request('http://container/health', { method: 'GET' }))
    );

    if (!response.ok) {
      return { healthy: false, error: `Health check returned ${response.status}` };
    }

    const data = await response.json() as HealthData;
    return { healthy: true, data };
  } catch (error) {
    return {
      healthy: false,
      error: toErrorMessage(error)
    };
  }
}
