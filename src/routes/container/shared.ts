/**
 * Shared utilities for container routes
 * Includes timeout utilities, circuit breakers, and logger
 */
import { createLogger } from '../../lib/logger';
import { CONTAINER_FETCH_TIMEOUT } from '../../lib/constants';

// Re-export circuit breakers from central location
export { containerHealthCB, containerInternalCB, containerSessionsCB } from '../../lib/circuit-breakers';

export const containerLogger = createLogger('container');

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
