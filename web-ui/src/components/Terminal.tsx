import { Component, onMount, onCleanup, createEffect, createSignal, Show, createMemo } from 'solid-js';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { terminalStore } from '../stores/terminal';
import { sessionStore } from '../stores/session';
import InitProgress from './InitProgress';

interface TerminalProps {
  sessionId: string;
  terminalId: string;
  sessionName?: string;
  active: boolean;
  /** When true, always observe resize (used in tiled mode where multiple terminals are visible) */
  alwaysObserveResize?: boolean;
  onError?: (error: string) => void;
  onInitComplete?: () => void;
}

// Patterns that indicate Claude has fully loaded
const CLAUDE_READY_PATTERNS = [
  'Welcome back',        // Claude welcome message
  'Tips for getting',    // Tips section
  '~/workspace',         // Working directory shown
  'Try "',               // Suggestion prompt
];

const Terminal: Component<TerminalProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let terminal: XTerm | undefined;
  let fitAddon: FitAddon | undefined;
  let cleanup: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let outputBuffer = '';  // Buffer to accumulate terminal output for pattern matching

  const [dimensions, setDimensions] = createSignal({ cols: 80, rows: 24 });

  // Get retry message for this terminal (using compound key internally)
  const retryMessage = createMemo(() => terminalStore.getRetryMessage(props.sessionId, props.terminalId));
  const connectionState = createMemo(() => terminalStore.getConnectionState(props.sessionId, props.terminalId));

  // Bug 4 fix: Check if this specific session is initializing
  const isInitializing = createMemo(() => sessionStore.isSessionInitializing(props.sessionId));
  const initProgress = createMemo(() => sessionStore.getInitProgressForSession(props.sessionId));

  // Initialize terminal
  onMount(() => {
    if (!containerRef) return;

    // Create terminal with dark theme
    terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: '#1a1a2e',
        foreground: '#e4e4f0',
        cursor: '#d97706',
        cursorAccent: '#1a1a2e',
        selectionBackground: '#d9770644',
        selectionForeground: '#e4e4f0',
        black: '#1a1a2e',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e4e4f0',
        brightBlack: '#6c6c8a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
      convertEol: true,
      scrollback: 10000,
    });

    // Add addons
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Open terminal in container
    terminal.open(containerRef);

    // Custom key handler for Ctrl+C/V/X shortcuts
    // Enables standard GUI copy/paste + Ctrl+X as alternative interrupt
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      // Ctrl+C: Copy if selection exists, otherwise send SIGINT
      if (event.ctrlKey && event.key === 'c') {
        const selection = terminal!.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
          terminal!.clearSelection();
          return false; // Don't send to PTY
        }
        // No selection - let Ctrl+C pass through as SIGINT
        return true;
      }

      // Ctrl+X: Always send SIGINT (alternative interrupt key)
      if (event.ctrlKey && event.key === 'x') {
        // Send Ctrl+C (ASCII 3) to PTY for interrupt
        const ws = terminalStore.getTerminal(props.sessionId, props.terminalId);
        if (ws) {
          // The onData handler sends to WebSocket, so we write to terminal input
          terminal!.paste('\x03'); // ASCII 3 = Ctrl+C / ETX
        }
        return false;
      }

      // Ctrl+V: Paste from clipboard
      if (event.ctrlKey && event.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          if (text && terminal) {
            terminal.paste(text);
          }
        }).catch((err) => {
          console.warn('Clipboard read failed:', err);
        });
        return false;
      }

      return true;
    });

    // Store terminal reference (with terminalId)
    terminalStore.setTerminal(props.sessionId, props.terminalId, terminal);

    // Register fitAddon for layout change handling
    terminalStore.registerFitAddon(props.sessionId, props.terminalId, fitAddon);

    // Initial fit
    requestAnimationFrame(() => {
      if (fitAddon && containerRef) {
        fitAddon.fit();
        setDimensions({ cols: terminal!.cols, rows: terminal!.rows });
      }
    });

    // Don't connect immediately - wait for initialization to complete
    // Connection is triggered by createEffect watching isInitializing()

    // Handle resize - observe when active OR when alwaysObserveResize is true (tiled mode)
    resizeObserver = new ResizeObserver(() => {
      const shouldResize = props.active || props.alwaysObserveResize;
      if (fitAddon && shouldResize) {
        requestAnimationFrame(() => {
          fitAddon!.fit();
          const cols = terminal!.cols;
          const rows = terminal!.rows;
          setDimensions({ cols, rows });
          terminalStore.resize(props.sessionId, props.terminalId, cols, rows);
        });
      }
    });

    resizeObserver.observe(containerRef);
  });

  // Connect to WebSocket only after initialization completes
  // This prevents connection attempts while container is starting up
  createEffect(() => {
    const initializing = isInitializing();
    if (!initializing && terminal && !cleanup) {
      console.log(`[Terminal ${props.sessionId}:${props.terminalId}] Session ready, connecting WebSocket`);
      cleanup = terminalStore.connect(props.sessionId, props.terminalId, terminal, props.onError);
    }
  });

  // Handle active state changes - includes cursor position bugfix
  createEffect(() => {
    if (props.active && fitAddon && terminal) {
      requestAnimationFrame(() => {
        fitAddon!.fit();
        // Bug 6 fix: Ensure viewport is at bottom and force full refresh
        // This fixes cursor appearing in wrong position after switching sessions/tabs
        terminal!.scrollToBottom();
        terminal!.refresh(0, terminal!.rows - 1);
        terminal!.focus();
        terminalStore.resize(props.sessionId, props.terminalId, terminal!.cols, terminal!.rows);
      });
    }
  });

  // Refit terminal when initialization completes (overlay hides, layout changes)
  createEffect(() => {
    const initializing = isInitializing();
    if (!initializing && fitAddon && terminal && props.active) {
      // Double requestAnimationFrame ensures layout has settled after overlay removal
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitAddon!.fit();
          terminal!.scrollToBottom();
          terminal!.refresh(0, terminal!.rows - 1);
          terminalStore.resize(props.sessionId, props.terminalId, terminal!.cols, terminal!.rows);
        });
      });
    }
  });

  // React to layout changes (for tiled mode resize)
  createEffect(() => {
    // Access the layout change counter to create reactive dependency
    const _counter = terminalStore.layoutChangeCounter;

    // Only refit if in tiled mode (alwaysObserveResize) and terminal is ready
    if (props.alwaysObserveResize && fitAddon && terminal) {
      // Use setTimeout to let CSS transitions settle before refitting
      setTimeout(() => {
        requestAnimationFrame(() => {
          if (!fitAddon || !terminal) return;
          fitAddon.fit();
          const cols = terminal.cols;
          const rows = terminal.rows;
          setDimensions({ cols, rows });
          terminalStore.resize(props.sessionId, props.terminalId, cols, rows);
          // Force full refresh to fix garbling in apps like htop
          terminal.scrollToBottom();
          terminal.refresh(0, terminal.rows - 1);
        });
      }, 50); // 50ms delay for CSS transitions to complete
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    cleanup?.();
    resizeObserver?.disconnect();
    terminalStore.unregisterFitAddon(props.sessionId, props.terminalId);
    // Don't dispose terminal - keep it alive for session/tab switching
  });

  return (
    <div
      class="terminal-wrapper"
      style={{
        width: '100%',
        height: '100%',
        display: props.active ? 'flex' : 'none',
        'flex-direction': 'column',
        position: 'relative',
        'min-height': '0',
      }}
    >
      {/* Bug 4 fix: Per-session initialization progress overlay */}
      <Show when={isInitializing()}>
        <div class="terminal-init-overlay">
          <InitProgress
            sessionName={props.sessionName || 'Terminal'}
            progress={initProgress()}
            onOpen={props.onInitComplete}
          />
        </div>
      </Show>

      {/* Connection status overlay - show until actually connected (not just during retries) */}
      {/* This fixes ghost cursor bug on page reload: covers terminal before WebSocket connects */}
      <Show when={!isInitializing() && connectionState() !== 'connected'}>
        <div class="terminal-connection-status">
          <div class="terminal-connection-spinner" />
          <span>{retryMessage() || 'Connecting...'}</span>
        </div>
      </Show>

      <div
        ref={containerRef}
        class="terminal-container"
        style={{
          width: '100%',
          flex: '1',
          'min-height': '0',
          'background-color': '#1a1a2e',
        }}
      />

      <style>{`
        .terminal-init-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          background: var(--color-bg-primary);
          z-index: 15;
          overflow-y: auto;
          padding: 40px 20px;
        }

        .terminal-connection-status {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          background: rgba(26, 26, 46, 0.98);
          color: var(--color-text-secondary);
          font-size: 14px;
          z-index: 10;
        }

        .terminal-connection-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid var(--color-border);
          border-top-color: var(--color-accent);
          border-radius: 50%;
          animation: terminal-spin 1s linear infinite;
        }

        @keyframes terminal-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};

export default Terminal;
