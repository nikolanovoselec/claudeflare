/**
 * KV key utilities for session management
 */
import type { Session } from '../types';
import { NotFoundError } from './error-types';

/** Maximum number of pagination iterations for listAllKvKeys to prevent infinite loops */
const MAX_KV_LIST_ITERATIONS = 100;

/**
 * Sanitize a session name to a strict allowlist.
 * Allows only alphanumeric characters, spaces, hyphens, and underscores.
 * Rejects shell metacharacters like $(), |, ;, etc.
 */
export function sanitizeSessionName(name: string): string {
  // Allow only alphanumeric, spaces, hyphens, underscores
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Untitled';
}

/**
 * Get KV key for a session
 */
export function getSessionKey(bucketName: string, sessionId: string): string {
  return `session:${bucketName}:${sessionId}`;
}

/**
 * Get KV prefix for user sessions
 */
export function getSessionPrefix(bucketName: string): string {
  return `session:${bucketName}:`;
}

/**
 * Generate a random session ID.
 *
 * Produces 96 bits of entropy (12 random bytes) encoded as 24 lowercase hex
 * characters, which matches the {@link SESSION_ID_PATTERN} validation regex
 * (`/^[a-z0-9]{8,24}$/`).
 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fetch a session from KV or throw NotFoundError if it doesn't exist.
 */
export async function getSessionOrThrow(kv: KVNamespace, key: string): Promise<Session> {
  const session = await kv.get<Session>(key, 'json');
  if (!session) {
    throw new NotFoundError('Session');
  }
  return session;
}

/**
 * List all KV keys with a given prefix, handling pagination.
 * KV returns max 1000 keys per call; this loops until all are fetched.
 * Capped at {@link MAX_KV_LIST_ITERATIONS} iterations to prevent infinite loops.
 */
export async function listAllKvKeys(kv: KVNamespace, prefix: string): Promise<KVNamespaceListKey<unknown>[]> {
  const keys: KVNamespaceListKey<unknown>[] = [];
  let cursor: string | undefined;
  let iterations = 0;
  do {
    const result = await kv.list({ prefix, cursor });
    keys.push(...result.keys);
    cursor = result.list_complete ? undefined : result.cursor;
    iterations++;
  } while (cursor && iterations < MAX_KV_LIST_ITERATIONS);
  return keys;
}
