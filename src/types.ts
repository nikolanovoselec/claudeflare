import type { Container } from '@cloudflare/containers';

/**
 * Cloudflare environment bindings
 */
export interface Env {
  // Static assets binding (auto-injected by Cloudflare when [assets] is configured)
  ASSETS: Fetcher;

  // KV namespace for session metadata
  KV: KVNamespace;

  // Container Durable Object
  CONTAINER: DurableObjectNamespace<Container<Env>>;

  // Environment variables
  // Only available inside containers (set via envVars)
  R2_BUCKET_NAME?: string;
  R2_ACCOUNT_ID?: string;
  R2_ENDPOINT?: string;

  // Secrets (injected via wrangler secret)
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;

  // Development mode - set to 'true' to bypass Cloudflare Access
  DEV_MODE?: string;

  // Service token email - when using CF Access service tokens, this email is used
  // Default: service-{clientId}@claudeflare.local
  SERVICE_TOKEN_EMAIL?: string;

  // Cloudflare API token for R2 bucket management
  CLOUDFLARE_API_TOKEN: string;

  // Allowed CORS origins (comma-separated patterns, e.g., ".workers.dev,.example.com")
  ALLOWED_ORIGINS?: string;

}

/**
 * Possible user roles within the application
 */
export type UserRole = 'admin' | 'user';

/**
 * User extracted from Cloudflare Access JWT
 */
export interface AccessUser {
  email: string;
  authenticated: boolean;
  role?: UserRole;
}

/**
 * Session metadata stored in KV
 */
export interface Session {
  id: string;
  name: string;
  userId: string;
  createdAt: string;
  lastAccessedAt: string;
}

/**
 * Credential status (cached in KV, does NOT contain actual credentials)
 */
export interface CredentialsStatus {
  exists: boolean;
  expiresAt: number;
  scopes: string[];
  updatedAt: string;
}
