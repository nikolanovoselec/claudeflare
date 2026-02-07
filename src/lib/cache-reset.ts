/**
 * Centralized cache reset functions.
 * Extracted from index.ts to avoid circular imports when setup routes
 * need to reset caches after configuration changes.
 */
import { resetCorsOriginsCache } from './cors-cache';
import { resetAuthConfigCache } from './access';
import { resetJWKSCache } from './jwt';

/**
 * Reset all in-memory caches related to setup configuration.
 * Call this when setup completes or is reconfigured so subsequent
 * requests re-read from KV.
 */
export function resetSetupCache(): void {
  resetCorsOriginsCache();
  resetAuthConfigCache();
  resetJWKSCache();
}
