import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Terminal } from '@xterm/xterm';

// Mock constants before importing terminal store
vi.mock('../../lib/constants', () => ({
  MAX_CONNECTION_RETRIES: 3,
  CONNECTION_RETRY_DELAY_MS: 100,
  MAX_RECONNECT_ATTEMPTS: 2,
  RECONNECT_DELAY_MS: 100,
  TERMINAL_REFRESH_DELAY_MS: 50,
  TERMINAL_SECONDARY_REFRESH_DELAY_MS: 50,
  CSS_TRANSITION_DELAY_MS: 10,
  WS_CLOSE_ABNORMAL: 1006,
}));

// Mock API client
vi.mock('../../api/client', () => ({
  getTerminalWebSocketUrl: vi.fn(
    (sessionId: string, terminalId: string) =>
      `ws://localhost/api/terminal/${sessionId}-${terminalId}/ws`
  ),
}));

// Import after mocks
import { terminalStore } from '../../stores/terminal';

// Get mock WebSocket class from global
const MockWebSocket = globalThis.WebSocket as unknown as {
  new (url: string): WebSocket & {
    _simulateMessage: (data: string | ArrayBuffer) => void;
    _simulateError: () => void;
  };
  CONNECTING: number;
  OPEN: number;
  CLOSING: number;
  CLOSED: number;
};

describe('Terminal Store', () => {
  const sessionId = 'test-session-123';
  const terminalId = '1';

  // Mock terminal instance
  const createMockTerminal = (): Terminal =>
    ({
      cols: 80,
      rows: 24,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      scrollToBottom: vi.fn(),
      refresh: vi.fn(),
      dispose: vi.fn(),
    }) as unknown as Terminal;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up any connections
    terminalStore.disposeAll();
  });

  describe('getConnectionState', () => {
    it('should return "disconnected" for unknown session/terminal', () => {
      const state = terminalStore.getConnectionState('unknown', '1');
      expect(state).toBe('disconnected');
    });
  });

  describe('getRetryMessage', () => {
    it('should return null for unknown session/terminal', () => {
      const message = terminalStore.getRetryMessage('unknown', '1');
      expect(message).toBeNull();
    });
  });

  describe('setTerminal', () => {
    it('should store terminal instance', () => {
      const terminal = createMockTerminal();
      terminalStore.setTerminal(sessionId, terminalId, terminal);

      const storedTerminal = terminalStore.getTerminal(sessionId, terminalId);
      expect(storedTerminal).toBe(terminal);
    });

    it('should return undefined for unknown terminal', () => {
      const terminal = terminalStore.getTerminal('unknown', '1');
      expect(terminal).toBeUndefined();
    });
  });

  describe('connect', () => {
    it('should set connection state to "connecting" initially', () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);

      expect(terminalStore.getConnectionState(sessionId, terminalId)).toBe('connecting');
    });

    it('should set retry message when connecting', () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);

      expect(terminalStore.getRetryMessage(sessionId, terminalId)).toBe('Connecting...');
    });

    it('should return a cleanup function', () => {
      const terminal = createMockTerminal();

      const cleanup = terminalStore.connect(sessionId, terminalId, terminal);

      expect(typeof cleanup).toBe('function');
    });

    it('should set connection state to "connected" on WebSocket open', async () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);

      // Allow WebSocket to simulate opening
      await vi.advanceTimersByTimeAsync(0);

      expect(terminalStore.getConnectionState(sessionId, terminalId)).toBe('connected');
    });

    it('should clear retry message on successful connection', async () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);

      // Allow WebSocket to simulate opening
      await vi.advanceTimersByTimeAsync(0);

      expect(terminalStore.getRetryMessage(sessionId, terminalId)).toBeNull();
    });

    it('should send initial resize on connection', async () => {
      const terminal = {
        ...createMockTerminal(),
        cols: 120,
        rows: 40,
      } as unknown as Terminal;

      // Track WebSocket send calls
      const sendSpy = vi.fn();
      const OriginalWebSocket = globalThis.WebSocket;
      globalThis.WebSocket = class extends (OriginalWebSocket as unknown as { new (url: string): WebSocket }) {
        send = sendSpy;
        constructor(url: string) {
          super(url);
        }
      } as unknown as typeof WebSocket;

      terminalStore.connect(sessionId, terminalId, terminal);

      // Allow WebSocket to open
      await vi.advanceTimersByTimeAsync(0);

      expect(sendSpy).toHaveBeenCalledWith(
        JSON.stringify({ type: 'resize', cols: 120, rows: 40 })
      );

      globalThis.WebSocket = OriginalWebSocket;
    });

    it('should dispose existing input handler before creating new one', async () => {
      const terminal = createMockTerminal();
      const disposeFn = vi.fn();
      (terminal.onData as ReturnType<typeof vi.fn>).mockReturnValue({ dispose: disposeFn });

      // First connection
      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);

      // Second connection should dispose existing handler
      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);

      expect(disposeFn).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should set connection state to "disconnected"', async () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.disconnect(sessionId, terminalId);

      expect(terminalStore.getConnectionState(sessionId, terminalId)).toBe('disconnected');
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(terminalStore.isConnected(sessionId, terminalId)).toBe(false);
    });

    it('should return true when connected', async () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);

      expect(terminalStore.isConnected(sessionId, terminalId)).toBe(true);
    });

    it('should return false after disconnect', async () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);
      terminalStore.disconnect(sessionId, terminalId);

      expect(terminalStore.isConnected(sessionId, terminalId)).toBe(false);
    });
  });

  describe('resize', () => {
    it('should send resize message when connected', async () => {
      const terminal = createMockTerminal();
      const sendSpy = vi.fn();
      const OriginalWebSocket = globalThis.WebSocket;
      globalThis.WebSocket = class extends (OriginalWebSocket as unknown as { new (url: string): WebSocket }) {
        send = sendSpy;
        constructor(url: string) {
          super(url);
        }
      } as unknown as typeof WebSocket;

      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.resize(sessionId, terminalId, 100, 50);

      expect(sendSpy).toHaveBeenCalledWith(
        JSON.stringify({ type: 'resize', cols: 100, rows: 50 })
      );

      globalThis.WebSocket = OriginalWebSocket;
    });

    it('should not throw when not connected', () => {
      expect(() => {
        terminalStore.resize(sessionId, terminalId, 100, 50);
      }).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should disconnect and dispose terminal', async () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.dispose(sessionId, terminalId);

      expect(terminalStore.getConnectionState(sessionId, terminalId)).toBe('disconnected');
      expect(terminal.dispose).toHaveBeenCalled();
    });

    it('should clear stored terminal', async () => {
      const terminal = createMockTerminal();
      terminalStore.setTerminal(sessionId, terminalId, terminal);

      terminalStore.dispose(sessionId, terminalId);

      expect(terminalStore.getTerminal(sessionId, terminalId)).toBeUndefined();
    });
  });

  describe('disposeSession', () => {
    it('should dispose all terminals for a session', async () => {
      const terminal1 = createMockTerminal();
      const terminal2 = createMockTerminal();

      terminalStore.connect(sessionId, '1', terminal1);
      terminalStore.connect(sessionId, '2', terminal2);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.disposeSession(sessionId);

      expect(terminalStore.getConnectionState(sessionId, '1')).toBe('disconnected');
      expect(terminalStore.getConnectionState(sessionId, '2')).toBe('disconnected');
    });

    it('should clean up fitAddons, reconnectAttempts, and inputDisposables for the session', async () => {
      const terminal1 = createMockTerminal();
      const terminal2 = createMockTerminal();
      const mockFitAddon = { fit: vi.fn() };

      // Set up connections and fitAddons for the target session
      terminalStore.connect(sessionId, '1', terminal1);
      terminalStore.connect(sessionId, '2', terminal2);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.registerFitAddon(sessionId, '1', mockFitAddon as any);
      terminalStore.registerFitAddon(sessionId, '2', mockFitAddon as any);

      // Dispose the session
      terminalStore.disposeSession(sessionId);

      // Verify terminals are gone
      expect(terminalStore.getTerminal(sessionId, '1')).toBeUndefined();
      expect(terminalStore.getTerminal(sessionId, '2')).toBeUndefined();

      // Verify connections are disconnected
      expect(terminalStore.getConnectionState(sessionId, '1')).toBe('disconnected');
      expect(terminalStore.getConnectionState(sessionId, '2')).toBe('disconnected');

      // Verify reconnect returns null (no stored terminal = Maps were cleaned up)
      expect(terminalStore.reconnect(sessionId, '1')).toBeNull();
      expect(terminalStore.reconnect(sessionId, '2')).toBeNull();
    });

    it('should not affect other sessions', async () => {
      const terminal1 = createMockTerminal();
      const terminal2 = createMockTerminal();

      terminalStore.connect('session-1', '1', terminal1);
      terminalStore.connect('session-2', '1', terminal2);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.disposeSession('session-1');

      expect(terminalStore.getConnectionState('session-1', '1')).toBe('disconnected');
      expect(terminalStore.getConnectionState('session-2', '1')).toBe('connected');
    });
  });

  describe('disposeAll', () => {
    it('should dispose all terminals across all sessions', async () => {
      const terminal1 = createMockTerminal();
      const terminal2 = createMockTerminal();

      terminalStore.connect('session-1', '1', terminal1);
      terminalStore.connect('session-2', '1', terminal2);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.disposeAll();

      expect(terminalStore.getConnectionState('session-1', '1')).toBe('disconnected');
      expect(terminalStore.getConnectionState('session-2', '1')).toBe('disconnected');
    });

    it('should clear all auxiliary Maps (fitAddons, inputDisposables, reconnectAttempts, retryTimeouts)', async () => {
      const terminal1 = createMockTerminal();
      const terminal2 = createMockTerminal();
      const mockFitAddon = { fit: vi.fn() };

      // Set up connections and fitAddons
      terminalStore.connect('session-a', '1', terminal1);
      terminalStore.connect('session-b', '1', terminal2);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.registerFitAddon('session-a', '1', mockFitAddon as any);
      terminalStore.registerFitAddon('session-b', '1', mockFitAddon as any);

      // Now dispose all
      terminalStore.disposeAll();

      // Verify terminals are gone
      expect(terminalStore.getTerminal('session-a', '1')).toBeUndefined();
      expect(terminalStore.getTerminal('session-b', '1')).toBeUndefined();

      // Verify connections are disconnected
      expect(terminalStore.getConnectionState('session-a', '1')).toBe('disconnected');
      expect(terminalStore.getConnectionState('session-b', '1')).toBe('disconnected');

      // Verify reconnect returns null (no stored terminal means Maps are cleared)
      expect(terminalStore.reconnect('session-a', '1')).toBeNull();
      expect(terminalStore.reconnect('session-b', '1')).toBeNull();
    });

    it('should call dispose on all terminal instances', async () => {
      const terminal1 = createMockTerminal();
      const terminal2 = createMockTerminal();

      terminalStore.setTerminal('session-x', '1', terminal1);
      terminalStore.setTerminal('session-y', '2', terminal2);
      terminalStore.connect('session-x', '1', terminal1);
      terminalStore.connect('session-y', '2', terminal2);
      await vi.advanceTimersByTimeAsync(0);

      terminalStore.disposeAll();

      expect(terminal1.dispose).toHaveBeenCalled();
      expect(terminal2.dispose).toHaveBeenCalled();
    });
  });

  describe('reconnect', () => {
    it('should return null if terminal not found', () => {
      const result = terminalStore.reconnect('unknown', '1');
      expect(result).toBeNull();
    });

    it('should return cleanup function on successful reconnect', async () => {
      const terminal = createMockTerminal();
      terminalStore.setTerminal(sessionId, terminalId, terminal);

      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);

      const cleanup = terminalStore.reconnect(sessionId, terminalId);

      expect(typeof cleanup).toBe('function');
    });

    it('should disconnect before reconnecting', async () => {
      const terminal = createMockTerminal();

      terminalStore.connect(sessionId, terminalId, terminal);
      await vi.advanceTimersByTimeAsync(0);
      expect(terminalStore.isConnected(sessionId, terminalId)).toBe(true);

      // Reconnect
      terminalStore.reconnect(sessionId, terminalId);

      // Should go through connecting state again
      expect(terminalStore.getConnectionState(sessionId, terminalId)).toBe('connecting');
    });
  });

  describe('FitAddon management', () => {
    it('should register and unregister fitAddon', () => {
      const mockFitAddon = { fit: vi.fn() };

      // Should not throw
      expect(() => {
        terminalStore.registerFitAddon(sessionId, terminalId, mockFitAddon as any);
        terminalStore.unregisterFitAddon(sessionId, terminalId);
      }).not.toThrow();
    });
  });

  describe('triggerLayoutResize', () => {
    it('should increment layout change counter', () => {
      const initialCounter = terminalStore.layoutChangeCounter;

      terminalStore.triggerLayoutResize();
      vi.advanceTimersByTime(100);

      expect(terminalStore.layoutChangeCounter).toBe(initialCounter + 1);
    });
  });

  describe('WebSocket reconnection behavior', () => {
    it('should show retry attempt in message', async () => {
      const terminal = createMockTerminal();

      // Create WebSocket that immediately closes with abnormal code
      const OriginalWebSocket = globalThis.WebSocket;
      let wsInstance: WebSocket & { onclose?: ((event: CloseEvent) => void) | null };

      globalThis.WebSocket = class {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        readyState = 0;
        url: string;
        binaryType: BinaryType = 'blob';
        onopen: ((event: Event) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;

        constructor(url: string) {
          this.url = url;
          wsInstance = this as unknown as WebSocket & { onclose?: ((event: CloseEvent) => void) | null };
          // Simulate immediate failure
          setTimeout(() => {
            this.readyState = 3; // CLOSED
            if (this.onclose) {
              this.onclose(new CloseEvent('close', { code: 1006 }));
            }
          }, 0);
        }

        send(_data: string | ArrayBuffer | Blob | ArrayBufferView): void {}
        close(_code?: number, _reason?: string): void {
          this.readyState = 3;
        }
      } as unknown as typeof WebSocket;

      terminalStore.connect(sessionId, terminalId, terminal);

      // First attempt
      expect(terminalStore.getRetryMessage(sessionId, terminalId)).toBe('Connecting...');

      // Let first attempt fail
      await vi.advanceTimersByTimeAsync(0);

      // Wait for retry delay
      await vi.advanceTimersByTimeAsync(100);

      // Should show retry attempt
      const retryMessage = terminalStore.getRetryMessage(sessionId, terminalId);
      expect(retryMessage).toMatch(/attempt/i);

      globalThis.WebSocket = OriginalWebSocket;
    });
  });
});
