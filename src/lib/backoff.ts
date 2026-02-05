/**
 * Configuration options for exponential backoff
 */
export interface BackoffOptions {
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Multiplier for each subsequent retry (e.g., 2 for doubling) */
  factor: number;
  /** Maximum number of attempts (including the first) */
  maxAttempts: number;
  /** Add randomness to prevent thundering herd problem */
  jitter?: boolean;
}

/**
 * Error thrown when maximum retries are exceeded
 */
export class MaxRetriesExceededError extends Error {
  /**
   * Create a MaxRetriesExceededError
   * @param attempts - Number of attempts made
   * @param lastError - The last error that occurred
   */
  constructor(
    public attempts: number,
    public lastError: Error
  ) {
    super(`Max retries (${attempts}) exceeded`);
    this.name = 'MaxRetriesExceededError';
  }
}

/**
 * Execute a function with exponential backoff retry logic
 *
 * Automatically retries failed operations with increasing delays between attempts.
 * Useful for handling transient failures in network requests or external services.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await withBackoff(
 *   () => fetchFromExternalApi(),
 *   {
 *     initialDelayMs: 100,
 *     maxDelayMs: 5000,
 *     factor: 2,
 *     maxAttempts: 5,
 *   }
 * );
 *
 * // With jitter to prevent thundering herd
 * const result = await withBackoff(
 *   () => databaseQuery(),
 *   {
 *     initialDelayMs: 50,
 *     maxDelayMs: 2000,
 *     factor: 2,
 *     maxAttempts: 3,
 *     jitter: true,
 *   }
 * );
 *
 * // Handling max retries exceeded
 * try {
 *   await withBackoff(unreliableOperation, options);
 * } catch (err) {
 *   if (err instanceof MaxRetriesExceededError) {
 *     console.log(`Failed after ${err.attempts} attempts`);
 *     console.log(`Last error: ${err.lastError.message}`);
 *   }
 * }
 * ```
 *
 * Delay progression example (factor=2, initial=100ms, max=1000ms):
 * - Attempt 1: immediate
 * - Attempt 2: wait 100ms
 * - Attempt 3: wait 200ms
 * - Attempt 4: wait 400ms
 * - Attempt 5: wait 800ms
 * - Attempt 6: wait 1000ms (capped)
 *
 * @param fn - Async function to execute
 * @param options - Backoff configuration
 * @returns The result of the function if successful
 * @throws MaxRetriesExceededError if all attempts fail
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions
): Promise<T> {
  let lastError: Error = new Error('No attempts made');
  let delay = options.initialDelayMs;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === options.maxAttempts) {
        throw new MaxRetriesExceededError(attempt, lastError);
      }

      // Calculate delay with optional jitter
      let currentDelay = Math.min(delay, options.maxDelayMs);
      if (options.jitter) {
        // Jitter ranges from 50% to 150% of the calculated delay
        currentDelay = currentDelay * (0.5 + Math.random());
      }

      await new Promise((resolve) => setTimeout(resolve, currentDelay));
      delay *= options.factor;
    }
  }

  // This should never be reached due to the throw in the loop
  throw new MaxRetriesExceededError(options.maxAttempts, lastError);
}
