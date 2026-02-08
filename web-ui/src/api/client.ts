import type { Session, UserInfo, InitProgress, StartupStatusResponse } from '../types';
import { STARTUP_POLL_INTERVAL_MS, SESSION_ID_DISPLAY_LENGTH, MAX_STARTUP_POLL_ERRORS, MAX_TERMINALS_PER_SESSION } from '../lib/constants';
import { z } from 'zod';
import {
  UserResponseSchema,
  SessionsResponseSchema,
  CreateSessionResponseSchema,
  StartupStatusResponseSchema,
  BatchSessionStatusResponseSchema,
} from '../lib/schemas';
import { mapStartupDetailsToProgress } from '../lib/status-mapper';

const BASE_URL = '/api';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options: RequestInit, schema: z.ZodType<T>): Promise<T>;
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T | undefined>;
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  schema?: z.ZodType<T>
): Promise<T | undefined> {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = errorText || `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.error) errorMessage = parsed.error;
    } catch {
      // Not JSON, use raw text
    }
    throw new ApiError(response.status, errorMessage);
  }

  // Handle empty responses (e.g., 204 No Content or empty 200).
  // When a schema is provided, the caller expects structured data — throw
  // so the error is surfaced rather than silently returning garbage.
  // When no schema is provided, callers expect void so `undefined` is fine.
  const text = await response.text();
  if (!text) {
    if (schema) {
      throw new ApiError(response.status, 'Expected response body but received empty response');
    }
    return undefined;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(response.status, 'Invalid JSON response from server');
  }

  // Validate against schema if provided
  if (schema) {
    return schema.parse(data);
  }

  return data as T;
}

// User API
export async function getUser(): Promise<UserInfo> {
  return fetchApi('/user', {}, UserResponseSchema);
}

// Session API
export async function getSessions(): Promise<Session[]> {
  const response = await fetchApi('/sessions', {}, SessionsResponseSchema);
  return response.sessions || [];
}

export async function createSession(name: string): Promise<Session> {
  const response = await fetchApi('/sessions', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }, CreateSessionResponseSchema);
  if (!response.session) {
    throw new Error('Failed to create session');
  }
  return response.session;
}

export async function deleteSession(id: string): Promise<void> {
  await fetchApi(`/sessions/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Get status for all sessions in a single batch call
 * Returns a map of sessionId -> { status, ptyActive, startupStage? }
 */
export async function getBatchSessionStatus(): Promise<Record<string, { status: string; ptyActive: boolean; startupStage?: string }>> {
  const response = await fetchApi('/sessions/batch-status', {}, BatchSessionStatusResponseSchema);
  return response.statuses;
}

// Get container startup status (polling endpoint)
export async function getStartupStatus(sessionId: string): Promise<StartupStatusResponse> {
  return fetchApi(`/container/startup-status?sessionId=${sessionId}`, {}, StartupStatusResponseSchema);
}

// Start session with polling progress (replaces SSE)
export function startSession(
  id: string,
  onProgress: (progress: InitProgress) => void,
  onComplete: () => void,
  onError: (error: string) => void
): () => void {
  let cancelled = false;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const startPolling = async () => {
    // First, trigger container start
    try {
      // Send initial creating stage
      onProgress({
        stage: 'creating',
        progress: 5,
        message: 'Preparing session...',
        details: [{ key: 'Session', value: id.substring(0, SESSION_ID_DISPLAY_LENGTH) }],
      });

      // Trigger container start with the actual session ID
      await fetchApi(`/container/start?sessionId=${id}`, { method: 'POST' });
    } catch (err) {
      // If it's a server error (5xx), report it rather than silently continuing
      if (err instanceof ApiError && err.status >= 500) {
        console.error('Container start failed:', err.status, err.message);
        onError(`Container start failed: ${err.message}`);
        return;
      }
      // For other errors (409 conflict, network issues), the container might already be starting
      console.log('Container start request (non-fatal):', err);
      onError(`Container start failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Start polling for status
    let consecutiveErrors = 0;

    const poll = async () => {
      if (cancelled) return;

      try {
        const status = await getStartupStatus(id);
        consecutiveErrors = 0;

        const progress = mapStartupDetailsToProgress(status);
        onProgress(progress);

        if (status.stage === 'ready') {
          if (pollInterval) clearInterval(pollInterval);
          onComplete();
        } else if (status.stage === 'error') {
          if (pollInterval) clearInterval(pollInterval);
          onError(status.error || 'Container startup failed');
        }
      } catch (err) {
        consecutiveErrors++;
        console.error('Polling error:', err);
        if (consecutiveErrors >= MAX_STARTUP_POLL_ERRORS) {
          if (pollInterval) clearInterval(pollInterval);
          onError('Polling failed after too many consecutive errors');
          return;
        }
      }
    };

    // Initial poll
    await poll();

    // Continue polling at regular intervals
    pollInterval = setInterval(poll, STARTUP_POLL_INTERVAL_MS);
  };

  startPolling().catch((err) => onError(err instanceof Error ? err.message : String(err)));

  // Return cleanup function
  return () => {
    cancelled = true;
    if (pollInterval) clearInterval(pollInterval);
  };
}

export async function stopSession(id: string): Promise<void> {
  await fetchApi(`/sessions/${id}/stop`, {
    method: 'POST',
  });
}

// User management
export interface UserEntry {
  email: string;
  addedBy: string;
  addedAt: string;
  role: 'admin' | 'user';
}

const UserEntrySchema = z.object({
  email: z.string(),
  addedBy: z.string(),
  addedAt: z.string(),
  role: z.enum(['admin', 'user']).default('user'),
});

const GetUsersResponseSchema = z.object({
  users: z.array(UserEntrySchema),
});

const UserMutationResponseSchema = z.object({
  success: z.boolean(),
  email: z.string(),
});

export async function getUsers(): Promise<UserEntry[]> {
  const data = await fetchApi('/users', {}, GetUsersResponseSchema);
  return data.users;
}

export async function addUser(email: string, role: 'admin' | 'user' = 'user'): Promise<void> {
  await fetchApi('/users', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  }, UserMutationResponseSchema);
}

export async function removeUser(email: string): Promise<void> {
  await fetchApi(`/users/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  }, UserMutationResponseSchema);
}

// Setup API
const SetupStatusResponseSchema = z.object({
  configured: z.boolean(),
  tokenDetected: z.boolean(),
});

export type SetupStatusResponse = z.infer<typeof SetupStatusResponseSchema>;

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  return fetchApi('/setup/status', {}, SetupStatusResponseSchema);
}

const DetectTokenResponseSchema = z.object({
  detected: z.boolean(),
  valid: z.boolean().optional(),
  account: z.object({ id: z.string(), name: z.string() }).optional(),
  error: z.string().optional(),
});

export type DetectTokenResponse = z.infer<typeof DetectTokenResponseSchema>;

export async function detectToken(): Promise<DetectTokenResponse> {
  return fetchApi('/setup/detect-token', {}, DetectTokenResponseSchema);
}

const ConfigureResponseSchema = z.object({
  success: z.boolean(),
  steps: z.array(z.object({ step: z.string(), status: z.string(), error: z.string().optional() })).optional(),
  error: z.string().optional(),
  customDomainUrl: z.string().optional(),
  accountId: z.string().optional(),
});

export type ConfigureResponse = z.infer<typeof ConfigureResponseSchema>;

export async function configure(body: {
  customDomain: string;
  allowedUsers: string[];
  adminUsers: string[];
  allowedOrigins?: string[];
}): Promise<ConfigureResponse> {
  return fetchApi('/setup/configure', {
    method: 'POST',
    body: JSON.stringify(body),
  }, ConfigureResponseSchema);
}

// Session ID format: 8-24 lowercase alphanumeric characters (matches backend SESSION_ID_PATTERN)
const SESSION_ID_RE = /^[a-z0-9]{8,24}$/;

// WebSocket URL helper - uses compound session ID for multiple terminals per session
export function getTerminalWebSocketUrl(sessionId: string, terminalId: string = '1'): string {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(`Invalid sessionId "${sessionId}": must be 8-24 lowercase alphanumeric characters`);
  }
  const id = parseInt(terminalId, 10);
  if (isNaN(id) || id < 1 || id > MAX_TERMINALS_PER_SESSION) {
    throw new Error(`Invalid terminalId "${terminalId}": must be between 1 and ${MAX_TERMINALS_PER_SESSION}`);
  }
  // Compound session ID: sessionId-terminalId (e.g., "abc123-1", "abc123-2")
  // Backend treats each as a unique PTY session within the same container
  const compoundSessionId = `${sessionId}-${terminalId}`;
  const wsUrl = new URL(`/api/terminal/${compoundSessionId}/ws`, window.location.href);
  wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return wsUrl.toString();
}
