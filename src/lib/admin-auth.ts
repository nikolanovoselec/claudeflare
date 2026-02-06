/**
 * Shared admin authentication verification
 * Used by admin routes, setup reconfigure, and setup reset endpoints
 */
import type { Env } from '../types';
import { AuthError } from './error-types';

/**
 * Verify that the provided Authorization header contains a valid admin secret.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param env - Environment bindings containing ADMIN_SECRET
 * @param authHeader - The Authorization header value (e.g., "Bearer <secret>")
 * @throws AuthError if the secret is missing or invalid
 */
export function verifyAdminSecret(env: Env, authHeader: string | undefined): void {
  const providedSecret = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!env.ADMIN_SECRET || !providedSecret) {
    throw new AuthError('Unauthorized');
  }

  const encoder = new TextEncoder();
  const a = encoder.encode(env.ADMIN_SECRET);
  const b = encoder.encode(providedSecret);
  if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) {
    throw new AuthError('Unauthorized');
  }
}
