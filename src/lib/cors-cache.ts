/**
 * In-memory cache for CORS origins loaded from KV.
 * Shared between index.ts (CORS middleware) and setup.ts (cache reset on configure).
 */

// Cache KV-stored origins per isolate (avoids KV read on every request)
let cachedKvOrigins: string[] | null = null;

/**
 * Get the cached KV origins.
 */
export function getCachedKvOrigins(): string[] | null {
  return cachedKvOrigins;
}

/**
 * Set the cached KV origins.
 */
export function setCachedKvOrigins(origins: string[]): void {
  cachedKvOrigins = origins;
}

/**
 * Reset the in-memory CORS origins cache. Call this when setup completes
 * so the next request re-reads origins from KV.
 */
export function resetCorsOriginsCache(): void {
  cachedKvOrigins = null;
}
