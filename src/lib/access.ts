import type { AccessUser, Env } from '../types';

/**
 * Extract user info from Cloudflare Access.
 *
 * Supports two authentication methods:
 *
 * 1. Browser/JWT authentication (via CF Access login):
 *    - cf-access-authenticated-user-email: user's email (set by CF Access after JWT validation)
 *    - cf-access-jwt-assertion: full JWT
 *
 * 2. Service token authentication (for API/CLI clients):
 *    - CF-Access-Client-Id: service token ID
 *    - CF-Access-Client-Secret: service token secret
 *    When CF Access validates a service token, it sets cf-access-client-id header.
 *    Service tokens are mapped to SERVICE_TOKEN_EMAIL env var or default email.
 *
 * In DEV_MODE, returns a test user when no Access headers are present.
 */
export function getUserFromRequest(request: Request, env?: Env): AccessUser {
  // Method 1: Browser/JWT authentication - check for email header
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
