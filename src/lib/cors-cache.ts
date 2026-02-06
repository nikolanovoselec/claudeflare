/**
 * In-memory cache for CORS origins loaded from KV.
 * Shared between index.ts (CORS middleware) and setup.ts (cache reset on configure).
 */

// Cache KV-stored origins per isolate (avoids KV read on every request)
let cachedKvOrigins: string[] | null = null;
let cacheTimestamp = 0;
const CORS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the cached KV origins. Returns null if cache is empty or expired.
 */
export function getCachedKvOrigins(): string[] | null {
  if (cachedKvOrigins !== null && Date.now() - cacheTimestamp > CORS_CACHE_TTL_MS) {
    cachedKvOrigins = null; // Expired
  }
  return cachedKvOrigins;
}

/**
 * Set the cached KV origins.
 */
export function setCachedKvOrigins(origins: string[]): void {
  cachedKvOrigins = origins;
  cacheTimestamp = Date.now();
}

/**
 * Reset the in-memory CORS origins cache. Call this when setup completes
 * so the next request re-reads origins from KV.
 */
export function resetCorsOriginsCache(): void {
  cachedKvOrigins = null;
  cacheTimestamp = 0;
}
