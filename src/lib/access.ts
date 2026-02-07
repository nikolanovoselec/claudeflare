import type { AccessUser, Env, UserRole } from '../types';
import { verifyAccessJWT } from './jwt';
import { AuthError, ForbiddenError } from './error-types';

// Module-level cache for auth config (avoids KV reads on every request)
let cachedAuthDomain: string | null | undefined = undefined;
let cachedAccessAud: string | null | undefined = undefined;

/**
 * Reset cached auth config. Call when setup completes or config changes.
 */
export function resetAuthConfigCache(): void {
  cachedAuthDomain = undefined;
  cachedAccessAud = undefined;
}

/**
 * Extract user info from Cloudflare Access.
 *
 * Supports three authentication methods:
 *
 * 1. Browser/JWT authentication (via CF Access login):
 *    - cf-access-jwt-assertion: full JWT (verified via JWKS when auth_domain/access_aud are configured)
 *    - cf-access-authenticated-user-email: user's email (fallback when JWT config not yet stored)
 *
 * 2. Service token authentication (for API/CLI clients):
 *    - CF-Access-Client-Id: service token ID
 *    - CF-Access-Client-Secret: service token secret
 *    When CF Access validates a service token, it sets cf-access-client-id header.
 *    Service tokens are mapped to SERVICE_TOKEN_EMAIL env var or default email.
 *
 * In DEV_MODE, returns a test user when no Access headers are present.
 */
export async function getUserFromRequest(request: Request, env?: Env): Promise<AccessUser> {
  // Check for JWT assertion header first (primary auth method)
  const jwtToken = request.headers.get('cf-access-jwt-assertion');

  if (jwtToken && env?.KV) {
    // Load auth config from KV (with module-level cache)
    if (cachedAuthDomain === undefined) {
      cachedAuthDomain = await env.KV.get('setup:auth_domain');
    }
    if (cachedAccessAud === undefined) {
      cachedAccessAud = await env.KV.get('setup:access_aud');
    }

    if (cachedAuthDomain && cachedAccessAud) {
      // JWT verification is available - use it
      const verifiedEmail = await verifyAccessJWT(jwtToken, cachedAuthDomain, cachedAccessAud);

      if (verifiedEmail) {
        return { email: verifiedEmail, authenticated: true };
      }

      // JWT verification failed
      // In DEV_MODE, fall through to header-based trust
      if (env?.DEV_MODE !== 'true') {
        return { email: '', authenticated: false };
      }
    }
    // auth_domain/access_aud not stored yet (pre-setup state):
    // fall through to header-based trust below
  }

  // Fallback: Browser/JWT authentication - trust email header
  // (used when auth_domain/access_aud not configured yet, or no JWT token)
  const email = request.headers.get('cf-access-authenticated-user-email');

  if (email) {
    return { email, authenticated: true };
  }

  // Method 2: Service token authentication
  // When CF Access validates service token, it passes through cf-access-client-id
  // Check if this is a validated service token request
  const serviceTokenClientId = request.headers.get('cf-access-client-id');

  if (serviceTokenClientId) {
    // Service token was validated by CF Access
    // Use SERVICE_TOKEN_EMAIL env var or fall back to a default based on client ID
    const serviceEmail = env?.SERVICE_TOKEN_EMAIL || `service-${serviceTokenClientId.split('.')[0]}@claudeflare.local`;
    return { email: serviceEmail, authenticated: true };
  }

  // DEV_MODE bypass: return user from SERVICE_TOKEN_EMAIL when no Access headers
  if (env?.DEV_MODE === 'true') {
    const devEmail = env?.SERVICE_TOKEN_EMAIL || 'test@example.com';
    return { email: devEmail, authenticated: true };
  }

  return { email: '', authenticated: false };
}

/**
 * Generate a bucket name from email.
 * Format: claudeflare-{sanitized-email}
 * Rules: lowercase, replace @ and . with -, truncate to 63 chars
 */
export function getBucketName(email: string): string {
  const sanitized = email
    .toLowerCase()
    .trim()
    .replace(/@/g, '-')
    .replace(/\./g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const prefix = 'claudeflare-';
  const maxLength = 63;
  const maxSanitizedLength = maxLength - prefix.length;

  return `${prefix}${sanitized.substring(0, maxSanitizedLength)}`;
}

/**
 * Resolve a user entry from KV, returning role information.
 * Defaults missing role to 'user' for backward compatibility with
 * entries created before role support was added.
 */
export async function resolveUserFromKV(
  kv: KVNamespace,
  email: string
): Promise<{ addedBy: string; addedAt: string; role: UserRole } | null> {
  const raw = await kv.get(`user:${email}`);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return null;
  return {
    addedBy: typeof parsed.addedBy === 'string' ? parsed.addedBy : 'unknown',
    addedAt: typeof parsed.addedAt === 'string' ? parsed.addedAt : '',
    role: parsed.role === 'admin' ? 'admin' : 'user',
  };
}

/**
 * Authenticate a request and resolve user identity + bucket name.
 * Shared between authMiddleware (Hono routes) and handleWebSocketUpgrade (raw handler).
 *
 * Throws AuthError if not authenticated, ForbiddenError if user not in allowlist.
 */
export async function authenticateRequest(
  request: Request,
  env: Env
): Promise<{ user: AccessUser; bucketName: string }> {
  const user = await getUserFromRequest(request, env);
  if (!user.authenticated) {
    throw new AuthError('Not authenticated');
  }
  if (env.DEV_MODE !== 'true') {
    const kvEntry = await resolveUserFromKV(env.KV, user.email);
    if (!kvEntry) {
      throw new ForbiddenError('User not in allowlist');
    }
    user.role = kvEntry.role;
  } else {
    user.role = 'admin';
  }
  const bucketName = getBucketName(user.email);
  return { user, bucketName };
}
