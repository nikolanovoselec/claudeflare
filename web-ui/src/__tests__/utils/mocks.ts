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
