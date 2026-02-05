import type { Session, UserInfo, TerminalConnection, TerminalConnectionState } from '../../types';

/**
 * Create a mock Session object
 */
export function createMockSession(overrides: Partial<Session> = {}): Session {
  const now = new Date().toISOString();
  return {
    id: 'mock-session-' + Math.random().toString(36).substring(2, 10),
    name: 'Test Session',
    createdAt: now,
    lastAccessedAt: now,
    ...overrides,
  };
}

/**
 * Create multiple mock sessions
 */
export function createMockSessions(count: number, overrides: Partial<Session> = {}): Session[] {
  return Array.from({ length: count }, (_, i) =>
    createMockSession({
      id: `mock-session-${i + 1}`,
      name: `Test Session ${i + 1}`,
      ...overrides,
    })
  );
}

/**
 * Create a mock TerminalConnection object
 */
export function createMockTerminalConnection(
  overrides: Partial<TerminalConnection> = {}
): TerminalConnection {
  return {
    sessionId: 'mock-session-1',
    terminalId: '1',
    state: 'disconnected' as TerminalConnectionState,
    ws: undefined,
    ...overrides,
  };
}

/**
 * Create a connected terminal connection with a mock WebSocket
 */
export function createMockConnectedTerminalConnection(
  overrides: Partial<Omit<TerminalConnection, 'ws'>> = {}
): TerminalConnection {
  const mockWs = new WebSocket('ws://localhost/test') as WebSocket;
  return {
    sessionId: 'mock-session-1',
    terminalId: '1',
    state: 'connected' as TerminalConnectionState,
    ws: mockWs,
    ...overrides,
  };
}

/**
 * Create a mock UserInfo object
 */
export function createMockUserInfo(overrides: Partial<UserInfo> = {}): UserInfo {
  return {
    email: 'test@example.com',
    authenticated: true,
    bucketName: 'claudeflare-test-example-com',
    ...overrides,
  };
}

/**
 * Create a mock fetch response
 */
export function createMockFetchResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create a mock API error response
 */
export function createMockErrorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mock the global fetch for testing API calls
 */
export function mockFetch(responses: Map<string, Response | (() => Response)>): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    for (const [pattern, response] of responses) {
      if (url.includes(pattern)) {
        return typeof response === 'function' ? response() : response.clone();
      }
    }

    // Default: return 404
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  // Return cleanup function
  return () => {
    globalThis.fetch = originalFetch;
  };
}
