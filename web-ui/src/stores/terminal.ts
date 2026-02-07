import { createStore, produce } from 'solid-js/store';
import { createSignal } from 'solid-js';
import type { TerminalConnectionState } from '../types';
import { getTerminalWebSocketUrl } from '../api/client';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import {
  MAX_CONNECTION_RETRIES,
  CONNECTION_RETRY_DELAY_MS,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_DELAY_MS,
  TERMINAL_REFRESH_DELAY_MS,
  TERMINAL_SECONDARY_REFRESH_DELAY_MS,
  CSS_TRANSITION_DELAY_MS,
  WS_CLOSE_ABNORMAL,
} from '../lib/constants';

// Helper to create compound key from sessionId and terminalId
function makeKey(sessionId: string, terminalId: string): string {
  return `${sessionId}:${terminalId}`;
}

// Use plain objects to store references (Solid.js stores don't track Map mutations well)
const [state, setState] = createStore<{
  connectionStates: Record<string, TerminalConnectionState>;
  retryMessages: Record<string, string>;
}>({
  connectionStates: {},
  retryMessages: {},
});

// External storage for WebSocket and Terminal instances (keyed by sessionId:terminalId)
const connections = new Map<string, WebSocket>();
const terminals = new Map<string, Terminal>();
const retryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Bug 1 fix: Store inputDisposable outside the connect function to properly clean up
const inputDisposables = new Map<string, { dispose: () => void }>();

// Bug 2 fix: Track reconnection attempts for dropped connections
const reconnectAttempts = new Map<string, number>();

// Store fitAddon references for triggering resize on layout change
const fitAddons = new Map<string, FitAddon>();

// Signal to trigger global terminal resize (incremented when tiling layout changes)
const [layoutChangeCounter, setLayoutChangeCounter] = createSignal(0);

// Trigger all terminals to refit (called when tiling layout changes)
function triggerLayoutResize(): void {
  setLayoutChangeCounter((c) => c + 1);

  // Also manually refit all terminals after a short delay for CSS to settle
  // Use setTimeout to give CSS transitions time to complete
  setTimeout(() => {
    requestAnimationFrame(() => {
      for (const [key, fitAddon] of fitAddons) {
        try {
          fitAddon.fit();
          const terminal = terminals.get(key);
          if (terminal) {
            const cols = terminal.cols;
            const rows = terminal.rows;
            // Send resize to PTY
            const ws = connections.get(key);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
            // Force full terminal refresh to fix garbling/colors in apps like htop
            terminal.scrollToBottom();
            terminal.refresh(0, terminal.rows - 1);
          }
        } catch (e) {
          console.warn(`[Terminal ${key}] Failed to refit on layout change:`, e);
        }
      }
    });
  }, CSS_TRANSITION_DELAY_MS); // Delay for CSS to settle
}

// Register a fitAddon for a terminal (for layout change handling)
function registerFitAddon(sessionId: string, terminalId: string, fitAddon: FitAddon): void {
  const key = makeKey(sessionId, terminalId);
  fitAddons.set(key, fitAddon);
}

// Unregister a fitAddon
function unregisterFitAddon(sessionId: string, terminalId: string): void {
  const key = makeKey(sessionId, terminalId);
  fitAddons.delete(key);
}

// Get connection state
function getConnectionState(sessionId: string, terminalId: string): TerminalConnectionState {
  const key = makeKey(sessionId, terminalId);
  return state.connectionStates[key] || 'disconnected';
}

// Get retry message (for UI display)
function getRetryMessage(sessionId: string, terminalId: string): string | null {
  const key = makeKey(sessionId, terminalId);
  return state.retryMessages[key] || null;
}

// Set connection state
function setConnectionState(
  sessionId: string,
  terminalId: string,
  connectionState: TerminalConnectionState
): void {
  const key = makeKey(sessionId, terminalId);
  setState(
    produce((s) => {
      s.connectionStates[key] = connectionState;
    })
  );
}

// Set retry message
function setRetryMessage(sessionId: string, terminalId: string, message: string | null): void {
  const key = makeKey(sessionId, terminalId);
  setState(
    produce((s) => {
      if (message === null) {
        delete s.retryMessages[key];
      } else {
        s.retryMessages[key] = message;
      }
    })
  );
}

// Store terminal instance
function setTerminal(sessionId: string, terminalId: string, terminal: Terminal): void {
  const key = makeKey(sessionId, terminalId);
  terminals.set(key, terminal);
}

// Get terminal instance
function getTerminal(sessionId: string, terminalId: string): Terminal | undefined {
  const key = makeKey(sessionId, terminalId);
  return terminals.get(key);
}

/**
 * Connect to terminal WebSocket with retry logic.
 *
 * Structure analysis (Phase 3 refactoring review):
 * - Uses nested `attemptConnection()` function for retry handling (appropriate since it
 *   needs closure over `cancelled` flag and `key` variable)
 * - WebSocket event handlers (onopen, onmessage, onerror, onclose) are self-contained
 * - Retry logic in onclose is well-commented and handles multiple scenarios:
 *   1. Initial connection retries (MAX_CONNECTION_RETRIES attempts)
 *   2. Reconnection for dropped connections (MAX_RECONNECT_ATTEMPTS)
 * - Returns cleanup function for proper resource disposal
 *
 * Further extraction not warranted because:
 * - Extracting `attemptConnection()` to module level would require passing many parameters
 * - WebSocket event handlers need closure over `ws`, `cancelled`, `terminal`, etc.
 * - Current structure is clear and well-documented
 *
 * @param sessionId - The session ID to connect to
 * @param terminalId - The terminal tab ID within the session
 * @param terminal - The xterm.js Terminal instance
 * @param onError - Optional callback for error reporting
 * @returns Cleanup function to cancel connection and dispose resources
 */
function connect(
  sessionId: string,
  terminalId: string,
  terminal: Terminal,
  onError?: (error: string) => void
): () => void {
  const key = makeKey(sessionId, terminalId);

  // Close existing connection if any
  disconnect(sessionId, terminalId);

  terminals.set(key, terminal);

  // Bug 1 fix: Dispose any existing input handler before creating a new one
  const existingDisposable = inputDisposables.get(key);
  if (existingDisposable) {
    console.log(`[Terminal ${key}] Disposing existing input handler`);
    existingDisposable.dispose();
    inputDisposables.delete(key);
  }

  // Reset reconnection attempts on fresh connect
  reconnectAttempts.delete(key);

  let cancelled = false;

  // Attempt connection with retries
  function attemptConnection(attemptNumber: number): void {
    if (cancelled) return;

    // Clear any existing retry timeout
    const existingTimeout = retryTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      retryTimeouts.delete(key);
    }

    setConnectionState(sessionId, terminalId, 'connecting');

    if (attemptNumber > 1) {
      setRetryMessage(sessionId, terminalId, `Connecting... (attempt ${attemptNumber}/${MAX_CONNECTION_RETRIES})`);
    } else {
      setRetryMessage(sessionId, terminalId, 'Connecting...');
    }

    const url = getTerminalWebSocketUrl(sessionId, terminalId);
    const ws = new WebSocket(url);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (cancelled) {
        ws.close();
        return;
      }
      console.log(`[Terminal ${key}] WebSocket opened`);
      setConnectionState(sessionId, terminalId, 'connected');
      setRetryMessage(sessionId, terminalId, null);

      // Bug 1 fix: Reset reconnection attempts on successful connection
      reconnectAttempts.delete(key);

      // Bug 1 fix: Dispose any existing input handler before creating a new one
      const existingDisposable = inputDisposables.get(key);
      if (existingDisposable) {
        console.log(`[Terminal ${key}] Disposing existing input handler in onopen`);
        existingDisposable.dispose();
        inputDisposables.delete(key);
      }

      // Set up terminal input handler on successful connection
      // Send RAW data directly to PTY (no JSON wrapping)
      const inputDisposable = terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);  // Raw terminal input
        }
      });

      // Bug 1 fix: Store inputDisposable in the external Map for proper cleanup
      inputDisposables.set(key, inputDisposable);
      console.log(`[Terminal ${key}] Created new input handler`);

      // Bug 5 fix: Send initial resize to sync PTY dimensions with xterm.js
      // Without this, PTY starts with default 80x24 but xterm.js may have different dimensions
      // causing garbled/duplicated text until user manually resizes window
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (cols > 0 && rows > 0) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        console.log(`[Terminal ${key}] Sent initial resize: ${cols}x${rows}`);
      }

      // Fix: After receiving replayed buffer, refresh terminal display
      // On page refresh, PTY replays its buffer with escape sequences for old dimensions
      // This causes cursor to appear at wrong position - double refresh with delay fixes it
      setTimeout(() => {
        if (!cancelled) {
          terminal.scrollToBottom();
          terminal.refresh(0, terminal.rows - 1);
          // Send another resize to force PTY to update cursor position
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
          console.log(`[Terminal ${key}] Initial refresh completed`);

          // Second refresh after PTY processes resize - fixes cursor jumping to corner
          setTimeout(() => {
            if (!cancelled && ws.readyState === WebSocket.OPEN) {
              terminal.scrollToBottom();
              terminal.refresh(0, terminal.rows - 1);
              console.log(`[Terminal ${key}] Secondary refresh completed`);
            }
          }, TERMINAL_SECONDARY_REFRESH_DELAY_MS);
        }
      }, TERMINAL_REFRESH_DELAY_MS);
    };

    ws.onmessage = (event) => {
      if (cancelled) return;

      // Server sends RAW terminal data - write directly to xterm
      let messageData: string;
      if (event.data instanceof ArrayBuffer) {
        messageData = new TextDecoder().decode(event.data);
      } else if (typeof event.data === 'string') {
        messageData = event.data;
      } else {
        console.warn('Unknown message type:', typeof event.data);
        return;
      }

      // Check for pong response (only JSON message we expect from server)
      if (messageData.startsWith('{')) {
        try {
          const msg = JSON.parse(messageData);
          if (msg.type === 'pong') {
            // Ping response, ignore
            return;
          }
        } catch {
          // Not JSON, write as raw data
        }
      }

      // Write raw terminal data directly to xterm
      terminal.write(messageData);
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
    };

    ws.onclose = (event) => {
      if (cancelled) return;

      console.log(`[Terminal ${key}] WebSocket closed: code=${event.code}, reason=${event.reason}`);
      connections.delete(key);

      // WS_CLOSE_ABNORMAL (1006) = abnormal closure (connection failed)
      // Retry if we haven't exhausted attempts and connection was never successfully established
      const wasNeverConnected = getConnectionState(sessionId, terminalId) === 'connecting';
      const shouldRetry = wasNeverConnected && attemptNumber < MAX_CONNECTION_RETRIES && event.code === WS_CLOSE_ABNORMAL;

      if (shouldRetry) {
        console.log(`[Terminal ${key}] Retrying initial connection, attempt ${attemptNumber + 1}/${MAX_CONNECTION_RETRIES}`);
        const timeout = setTimeout(() => {
          attemptConnection(attemptNumber + 1);
        }, CONNECTION_RETRY_DELAY_MS);
        retryTimeouts.set(key, timeout);
        return; // Don't fall through to reconnection logic
      }

      // Reconnection logic - used for both:
      // 1. Dropped connections (was connected, now disconnected)
      // 2. Exhausted initial retries (gives extra attempts for slow container wake-up)
      const currentReconnectAttempts = reconnectAttempts.get(key) || 0;

      if (currentReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const nextAttempt = currentReconnectAttempts + 1;
        reconnectAttempts.set(key, nextAttempt);

        const reason = wasNeverConnected ? 'Initial retries exhausted' : 'Connection dropped';
        console.log(`[Terminal ${key}] ${reason}, reconnecting (attempt ${nextAttempt}/${MAX_RECONNECT_ATTEMPTS})`);
        setConnectionState(sessionId, terminalId, 'connecting');
        setRetryMessage(sessionId, terminalId, `Reconnecting... (attempt ${nextAttempt}/${MAX_RECONNECT_ATTEMPTS})`);

        // Schedule reconnection after a delay
        const timeout = setTimeout(() => {
          if (!cancelled) {
            attemptConnection(1); // Start fresh connection attempt
          }
        }, RECONNECT_DELAY_MS);
        retryTimeouts.set(key, timeout);
      } else {
        // Exhausted all reconnection attempts
        console.log(`[Terminal ${key}] Max reconnection attempts reached, giving up`);
        setConnectionState(sessionId, terminalId, wasNeverConnected ? 'error' : 'disconnected');
        setRetryMessage(sessionId, terminalId, null);
        reconnectAttempts.delete(key);
        onError?.(wasNeverConnected
          ? 'Failed to connect to terminal after multiple attempts'
          : 'Connection lost. Click reconnect to try again.');
      }
    };

    connections.set(key, ws);
  }

  // Start first connection attempt
  attemptConnection(1);

  // Return cleanup function
  return () => {
    cancelled = true;

    // Bug 1 fix: Dispose input handler from the external Map
    const disposable = inputDisposables.get(key);
    if (disposable) {
      disposable.dispose();
      inputDisposables.delete(key);
    }

    // Clear any pending retry
    const timeout = retryTimeouts.get(key);
    if (timeout) {
      clearTimeout(timeout);
      retryTimeouts.delete(key);
    }

    // Clear reconnection attempts
    reconnectAttempts.delete(key);

    disconnect(sessionId, terminalId);
  };
}

// Disconnect from terminal
function disconnect(sessionId: string, terminalId: string): void {
  const key = makeKey(sessionId, terminalId);

  // Bug 1 fix: Dispose input handler before closing WebSocket
  const disposable = inputDisposables.get(key);
  if (disposable) {
    console.log(`[Terminal ${key}] Disposing input handler in disconnect`);
    disposable.dispose();
    inputDisposables.delete(key);
  }

  const ws = connections.get(key);
  if (ws) {
    ws.close();
    connections.delete(key);
  }
  setConnectionState(sessionId, terminalId, 'disconnected');
}

// Send resize event to terminal
function resize(sessionId: string, terminalId: string, cols: number, rows: number): void {
  const key = makeKey(sessionId, terminalId);
  const ws = connections.get(key);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

// Check if connected
function isConnected(sessionId: string, terminalId: string): boolean {
  return getConnectionState(sessionId, terminalId) === 'connected';
}

// Dispose terminal and connection
function dispose(sessionId: string, terminalId: string): void {
  const key = makeKey(sessionId, terminalId);
  disconnect(sessionId, terminalId);
  const terminal = terminals.get(key);
  if (terminal) {
    terminal.dispose();
    terminals.delete(key);
  }
}

// Dispose ALL terminals for a session (called when session stops/deletes)
function disposeSession(sessionId: string): void {
  const prefix = `${sessionId}:`;

  // Find and dispose all terminals for this session
  for (const key of [...connections.keys()]) {
    if (key.startsWith(prefix)) {
      const terminalId = key.slice(prefix.length);
      disconnect(sessionId, terminalId);
    }
  }

  for (const key of [...terminals.keys()]) {
    if (key.startsWith(prefix)) {
      const terminal = terminals.get(key);
      if (terminal) {
        terminal.dispose();
      }
      terminals.delete(key);
    }
  }

  // Clean up auxiliary Maps (mirrors disposeAll pattern)
  for (const key of [...fitAddons.keys()]) {
    if (key.startsWith(prefix)) {
      fitAddons.delete(key);
    }
  }

  for (const key of [...reconnectAttempts.keys()]) {
    if (key.startsWith(prefix)) {
      reconnectAttempts.delete(key);
    }
  }

  for (const key of [...inputDisposables.keys()]) {
    if (key.startsWith(prefix)) {
      const disposable = inputDisposables.get(key);
      if (disposable) {
        disposable.dispose();
      }
      inputDisposables.delete(key);
    }
  }

  // Clean up state
  setState(produce((s) => {
    for (const key of Object.keys(s.connectionStates)) {
      if (key.startsWith(prefix)) {
        delete s.connectionStates[key];
      }
    }
    for (const key of Object.keys(s.retryMessages)) {
      if (key.startsWith(prefix)) {
        delete s.retryMessages[key];
      }
    }
  }));
}

// Dispose all terminals and connections
function disposeAll(): void {
  for (const key of connections.keys()) {
    const [sessionId, terminalId] = key.split(':');
    disconnect(sessionId, terminalId);
  }
  for (const [, terminal] of terminals) {
    terminal.dispose();
  }
  terminals.clear();

  // Clear auxiliary Maps that live outside the reactive store
  for (const disposable of inputDisposables.values()) {
    disposable.dispose();
  }
  inputDisposables.clear();

  for (const timeout of retryTimeouts.values()) {
    clearTimeout(timeout);
  }
  retryTimeouts.clear();

  reconnectAttempts.clear();
  fitAddons.clear();
}

// Reconnect to terminal WebSocket
function reconnect(sessionId: string, terminalId: string, onError?: (error: string) => void): (() => void) | null {
  const key = makeKey(sessionId, terminalId);
  const terminal = terminals.get(key);
  if (!terminal) {
    console.error(`Cannot reconnect: no terminal for ${key}`);
    return null;
  }

  // Clear any existing retry timeout
  const existingTimeout = retryTimeouts.get(key);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    retryTimeouts.delete(key);
  }

  // Close existing connection and reconnect
  disconnect(sessionId, terminalId);
  return connect(sessionId, terminalId, terminal, onError);
}

// Export store and actions
export const terminalStore = {
  // State accessors
  getConnectionState,
  getRetryMessage,
  getTerminal,
  isConnected,

  // Layout change signal (for reactive resize in tiled mode)
  get layoutChangeCounter() {
    return layoutChangeCounter();
  },

  // Actions
  setTerminal,
  connect,
  disconnect,
  reconnect,
  resize,
  dispose,
  disposeSession,
  disposeAll,

  // FitAddon management for layout changes
  registerFitAddon,
  unregisterFitAddon,
  triggerLayoutResize,
};
