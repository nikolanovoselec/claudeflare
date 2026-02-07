/**
 * In-memory cache for CORS origins loaded from KV.
 * Shared between index.ts (CORS middleware), terminal.ts (WebSocket Origin validation),
 * and setup.ts (cache reset on configure).
 */

import type { Env } from '../types';
import { DEFAULT_ALLOWED_ORIGINS } from './constants';
import { createLogger } from './logger';

const logger = createLogger('cors-cache');

// Cache KV-stored origins per isolate (avoids KV read on every request)
let cachedKvOrigins: string[] | null = null;
let cacheTimestamp = 0;
const CORS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the cached KV origins. Returns null if cache is empty or expired.
 */
function getCachedKvOrigins(): string[] | null {
  if (cachedKvOrigins !== null && Date.now() - cacheTimestamp > CORS_CACHE_TTL_MS) {
    cachedKvOrigins = null; // Expired
  }
  return cachedKvOrigins;
}

/**
 * Set the cached KV origins.
 */
function setCachedKvOrigins(origins: string[]): void {
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

/**
 * Load allowed origin patterns from KV (setup:custom_domain + setup:allowed_origins).
 * Results are cached in memory per isolate.
 */
async function getKvOrigins(env: Env): Promise<string[]> {
  const cached = getCachedKvOrigins();
  if (cached !== null) {
    return cached;
  }

  const origins: string[] = [];

  try {
    // Read custom domain
    const customDomain = await env.KV.get('setup:custom_domain');
    if (customDomain) {
      origins.push(customDomain);
    }

    // Read allowed origins list
    const originsJson = await env.KV.get('setup:allowed_origins');
    if (originsJson) {
      const parsed = JSON.parse(originsJson) as string[];
      if (Array.isArray(parsed)) {
        for (const o of parsed) {
          if (!origins.includes(o)) {
            origins.push(o);
          }
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load KV origins, falling back to env/defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  setCachedKvOrigins(origins);
  return origins;
}

/**
 * Check if the request origin is allowed based on environment configuration and KV-stored origins.
 * Combines origins from:
 *   1. env.ALLOWED_ORIGINS (wrangler.toml static config)
 *   2. KV: setup:custom_domain and setup:allowed_origins (dynamic, set by setup wizard)
 * Falls back to DEFAULT_ALLOWED_ORIGINS if env.ALLOWED_ORIGINS is not set.
 *
 * SECURITY NOTE — Suffix-matching trade-off:
 * Origin validation uses suffix matching (origin.endsWith(pattern)) rather than
 * exact-match or regex. This means a pattern like ".example.com" will match any
 * subdomain including sibling subdomains (e.g., "evil.example.com" would pass).
 * This is an intentional trade-off: it keeps configuration simple (no regex to
 * maintain) while Cloudflare Access serves as the primary authentication gate.
 * Any request that passes CORS still needs a valid CF Access JWT, so the
 * practical risk of sibling-subdomain spoofing is mitigated at the auth layer.
 */
export async function isAllowedOrigin(origin: string, env: Env): Promise<boolean> {
  const staticPatterns = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : DEFAULT_ALLOWED_ORIGINS;

  if (staticPatterns.some(pattern => origin.endsWith(pattern))) {
    return true;
  }

  // Check KV-stored origins (cached)
  const kvOrigins = await getKvOrigins(env);
  return kvOrigins.some(pattern => origin.endsWith(pattern));
}
