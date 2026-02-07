/**
 * Shared utilities for container routes
 * Includes timeout utilities, circuit breakers, and logger
 */
import type { DurableObjectStub } from '@cloudflare/workers-types';
import { createLogger, type Logger } from '../../lib/logger';
import { isBucketNameResponse } from '../../lib/type-guards';
import { toErrorMessage } from '../../lib/error-types';
import { CONTAINER_FETCH_TIMEOUT } from '../../lib/constants';

// Re-export circuit breakers from central location
export { containerHealthCB, containerInternalCB, containerSessionsCB } from '../../lib/circuit-breakers';

// Local import for use within this module (re-exports aren't local bindings)
import { containerInternalCB } from '../../lib/circuit-breakers';

export const containerLogger = createLogger('container-routes');

/**
 * Fetch with timeout wrapper for container operations
 * Returns null if request times out instead of hanging indefinitely
 * Real (non-timeout) errors are re-thrown to the caller
 */
/**
 * Races a fetch against a timeout. Note: this is a "soft timeout" — the underlying
 * fetch continues in the background until the isolate terminates. The AbortSignal
 * is not passed to the fetch function because the caller signature doesn't support it.
 * In Cloudflare Workers, isolate termination handles cleanup.
 */
export async function fetchWithTimeout(
  fetchFn: () => Promise<Response>,
  timeoutMs: number = CONTAINER_FETCH_TIMEOUT
): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await Promise.race([
      fetchFn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    ]);
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null; // Timeout — return null as before
    }
    throw error; // Real errors should propagate
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch the stored bucket name from a container's Durable Object.
 * Returns the bucket name string or null if it couldn't be retrieved.
 */
export async function getStoredBucketName(
  container: DurableObjectStub,
  logger: Logger
): Promise<string | null> {
  try {
    const resp = await containerInternalCB.execute(() =>
      container.fetch(
        new Request('http://container/_internal/getBucketName', { method: 'GET' })
      )
    );
    const data = await resp.json();
    if (isBucketNameResponse(data)) {
      return data.bucketName;
    }
    return null;
  } catch (error) {
    const errMsg = toErrorMessage(error);
    if (errMsg.includes('not found') || errMsg.includes('does not exist') || errMsg.includes('Network')) {
      logger.debug('Could not get stored bucket name, DO may not exist yet');
    } else {
      logger.warn('Unexpected error getting stored bucket name', { error: errMsg });
    }
    return null;
  }
}
