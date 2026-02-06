import type { Session, UserInfo, InitProgress, StartupStatusResponse } from '../types';
import { STARTUP_POLL_INTERVAL_MS, SESSION_ID_DISPLAY_LENGTH } from '../lib/constants';
import { z } from 'zod';
import { SessionSchema, StartupStatusSchema, UserSchema } from '../lib/schemas';

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

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  schema?: z.ZodType<T>
): Promise<T> {
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
    throw new ApiError(response.status, errorText || `HTTP ${response.status}`);
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    // For empty responses, validate against schema if provided
    // Otherwise return empty object (caller must handle this case)
    if (schema) {
      return schema.parse({});
    }
    return {} as T;
  }

  const data = JSON.parse(text);

  // Validate against schema if provided
  if (schema) {
    return schema.parse(data);
  }

  return data;
}

// Response schemas for API endpoints (exported for contract tests)
export const UserResponseSchema = z.object({
  email: z.string(),
  authenticated: z.boolean(),
  bucketName: z.string(),
  bucketCreated: z.boolean().optional(),
  role: z.enum(['admin', 'user']).optional(),
});

export const SessionsResponseSchema = z.object({
  sessions: z.array(SessionSchema),
});

export const CreateSessionResponseSchema = z.object({
  session: SessionSchema,
});

// InitStage enum values from types.ts
export const InitStageSchema = z.enum(['creating', 'starting', 'syncing', 'mounting', 'verifying', 'ready', 'error', 'stopped']);

export const StartupStatusResponseSchema = z.object({
  stage: InitStageSchema,
  progress: z.number(),
  message: z.string(),
  details: z.object({
    bucketName: z.string(),
    container: z.string(),
    path: z.string(),
    email: z.string().optional(),
    containerStatus: z.string().optional(),
    syncStatus: z.string().optional(),
    syncError: z.string().nullable().optional(),
    terminalPid: z.number().optional(),
    healthServerOk: z.boolean().optional(),
    terminalServerOk: z.boolean().optional(),
    cpu: z.string().optional(),
    mem: z.string().optional(),
    hdd: z.string().optional(),
  }),
  error: z.string().optional(),
});

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

// Session status response schema
export const SessionStatusResponseSchema = z.object({
  status: z.string(),
  ptyActive: z.boolean().optional(),
});

/**
 * Get session and container status
 * @see src/routes/session.ts GET /:id/status for backend implementation
 */
export async function getSessionStatus(
  id: string
): Promise<{ status: string; ptyActive?: boolean }> {
  return fetchApi(`/sessions/${id}/status`, {}, SessionStatusResponseSchema);
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
    } catch (e) {
      // If it's a server error (5xx), report it rather than silently continuing
      if (e instanceof ApiError && e.status >= 500) {
        console.error('Container start failed:', e.status, e.message);
        onError(`Container start failed: ${e.message}`);
        return;
      }
      // For other errors (409 conflict, network issues), the container might already be starting
      console.log('Container start request (non-fatal):', e);
    }

    // Start polling for status
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    const poll = async () => {
      if (cancelled) return;

      try {
        const status = await getStartupStatus(id);
        consecutiveErrors = 0;

        // Convert status to InitProgress format with real-time details
        const details: { key: string; value: string; status?: 'ok' | 'error' | 'pending' }[] = [];
        if (status.details) {
          // Container status - dynamic
          const containerStatus = status.details.containerStatus || 'stopped';
          details.push({
            key: 'Container',
            value: containerStatus === 'running' || containerStatus === 'healthy' ? 'Running' : containerStatus,
            status: containerStatus === 'running' || containerStatus === 'healthy' ? 'ok' : 'pending',
          });

          // Sync status - dynamic
          const syncStatus = status.details.syncStatus || 'pending';
          let syncValue = syncStatus;
          let syncStatusIndicator: 'ok' | 'error' | 'pending' = 'pending';
          if (syncStatus === 'success') {
            syncValue = 'Synced';
            syncStatusIndicator = 'ok';
          } else if (syncStatus === 'failed') {
            syncValue = status.details.syncError || 'Failed';
            syncStatusIndicator = 'error';
          } else if (syncStatus === 'syncing') {
            syncValue = 'Syncing...';
            syncStatusIndicator = 'pending';
          } else if (syncStatus === 'skipped') {
            syncValue = 'Skipped';
            syncStatusIndicator = 'ok';
          } else {
            syncValue = 'Pending';
            syncStatusIndicator = 'pending';
          }
          details.push({
            key: 'Sync',
            value: syncValue,
            status: syncStatusIndicator,
          });

          // Terminal status - dynamic
          const terminalServerOk = status.details.terminalServerOk;
          const terminalPid = status.details.terminalPid;
          let terminalValue = 'Starting';
          let terminalStatus: 'ok' | 'error' | 'pending' = 'pending';
          if (terminalServerOk) {
            terminalValue = terminalPid ? `Ready (PID ${terminalPid})` : 'Ready';
            terminalStatus = 'ok';
          } else if (status.details.healthServerOk) {
            terminalValue = 'Starting...';
            terminalStatus = 'pending';
          }
          details.push({
            key: 'Terminal',
            value: terminalValue,
            status: terminalStatus,
          });

          // User email
          if (status.details.email) {
            details.push({ key: 'User', value: status.details.email, status: 'ok' });
          }
        }

        const progress: InitProgress = {
          stage: status.stage,
          progress: status.progress,
          message: status.message,
          details,
        };

        onProgress(progress);

        if (status.stage === 'ready') {
          if (pollInterval) clearInterval(pollInterval);
          onComplete();
        } else if (status.stage === 'error') {
          if (pollInterval) clearInterval(pollInterval);
          onError(status.error || 'Container startup failed');
        }
      } catch (e) {
        consecutiveErrors++;
        console.error('Polling error:', e);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
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

  startPolling();

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

// WebSocket URL helper - uses compound session ID for multiple terminals per session
export function getTerminalWebSocketUrl(sessionId: string, terminalId: string = '1'): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  // Compound session ID: sessionId-terminalId (e.g., "abc123-1", "abc123-2")
  // Backend treats each as a unique PTY session within the same container
  const compoundSessionId = `${sessionId}-${terminalId}`;
  return `${protocol}//${host}/api/terminal/${compoundSessionId}/ws`;
}
