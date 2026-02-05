import { Component, Show, createSignal, createMemo, onMount } from 'solid-js';
import Header from './Header';
import StatusBar from './StatusBar';
import AppSidebar from './AppSidebar';
import TerminalArea from './TerminalArea';
import SettingsPanel from './SettingsPanel';
import './TiledTerminalContainer.css';
import { sessionStore } from '../stores/session';
import { terminalStore } from '../stores/terminal';
import type { TileLayout } from '../types';

interface LayoutProps {
  userName?: string;
}

/**
 * Main Layout component
 *
 * Structure:
 * +------------------------------------------------------------------+
 * | HEADER (48px)                                                     |
 * +------------+-----------------------------------------------------+
 * | SIDEBAR    | MAIN CONTENT                                         |
 * | (280px)    |                                                      |
 * |            |                                                      |
 * +------------+-----------------------------------------------------+
 * | STATUS BAR (24px)                                                 |
 * +------------------------------------------------------------------+
 */
const Layout: Component<LayoutProps> = (props) => {
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [terminalError, setTerminalError] = createSignal<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = createSignal<Date | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [showTilingOverlay, setShowTilingOverlay] = createSignal(false);

  // Load sessions on mount
  onMount(() => {
    sessionStore.loadSessions();
    // Set initial sync time
    setLastSyncTime(new Date());
  });

  // Check if any session is currently initializing (used for empty state logic)
  const hasInitializingSession = createMemo(() => {
    return sessionStore.sessions.some((s) => sessionStore.isSessionInitializing(s.id));
  });

  // Get active session
  const activeSession = createMemo(() => {
    return sessionStore.getActiveSession();
  });

  // Bug 4 fix: Show terminal even when other sessions are initializing
  // The init progress overlay is now per-session, inside the Terminal component
  const showTerminal = createMemo(() => {
    const session = activeSession();
    return session && (session.status === 'running' || session.status === 'initializing');
  });

  // Bug 4 fix: Get running OR initializing sessions for terminal rendering
  // This allows each session to show its own init progress inside its terminal area
  const runningSessions = createMemo(() => {
    return sessionStore.sessions.filter((s) => s.status === 'running' || s.status === 'initializing');
  });

  // Connection status based on whether we have any running sessions
  const isConnected = createMemo(() => {
    return runningSessions().length > 0;
  });

  // Check if all sessions are stopped (for empty state display)
  const allSessionsStopped = createMemo(() => {
    return sessionStore.sessions.length > 0 &&
      sessionStore.sessions.every((s) => s.status === 'stopped' || s.status === 'error');
  });

  // Get tiling state for active session
  const activeTiling = createMemo(() => {
    const sessionId = sessionStore.activeSessionId;
    if (!sessionId) return null;
    return sessionStore.getTilingForSession(sessionId);
  });

  // Get tab order for active session
  const activeTabOrder = createMemo(() => {
    const sessionId = sessionStore.activeSessionId;
    if (!sessionId) return null;
    return sessionStore.getTabOrder(sessionId);
  });

  // Get terminals for active session (for tiling button)
  const activeTerminals = createMemo(() => {
    const sessionId = sessionStore.activeSessionId;
    if (!sessionId) return null;
    return sessionStore.getTerminalsForSession(sessionId);
  });

  // Handlers
  const handleSelectSession = (id: string) => {
    const session = sessionStore.sessions.find((s) => s.id === id);
    if (session?.status === 'running') {
      sessionStore.setActiveSession(id);
    } else if (session?.status === 'stopped') {
      // Auto-start stopped sessions when clicked
      sessionStore.setActiveSession(id);
      sessionStore.startSession(id);
    }
  };

  const handleStartSession = async (id: string) => {
    sessionStore.setActiveSession(id);
    try {
      await sessionStore.startSession(id);
      setLastSyncTime(new Date());
    } catch (e) {
      console.error('Failed to start session:', e);
    }
  };

  const handleStopSession = async (id: string) => {
    await sessionStore.stopSession(id);
  };

  const handleDeleteSession = async (id: string) => {
    await sessionStore.deleteSession(id);
  };

  const handleCreateSession = async (name: string) => {
    const session = await sessionStore.createSession(name);
    if (session) {
      sessionStore.setActiveSession(session.id);
      await sessionStore.startSession(session.id);
      setLastSyncTime(new Date());
    }
  };

  // Handler for per-session init progress dismiss
  const handleOpenSessionById = (sessionId: string) => {
    sessionStore.dismissInitProgressForSession(sessionId);
  };

  const handleReconnect = (sessionId: string, terminalId: string = '1') => {
    terminalStore.reconnect(sessionId, terminalId, setTerminalError);
  };

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
  };

  // Tiling handlers
  const handleTilingButtonClick = () => {
    setShowTilingOverlay(!showTilingOverlay());
  };

  const handleSelectTilingLayout = (layout: TileLayout) => {
    const sessionId = sessionStore.activeSessionId;
    if (sessionId) {
      sessionStore.setTilingLayout(sessionId, layout);
    }
    setShowTilingOverlay(false);
  };

  const handleCloseTilingOverlay = () => {
    setShowTilingOverlay(false);
  };

  const handleTileClick = (tabId: string) => {
    const sessionId = sessionStore.activeSessionId;
    if (sessionId) {
      sessionStore.setActiveTerminalTab(sessionId, tabId);
    }
  };

  const handleDismissError = () => {
    sessionStore.clearError();
    setTerminalError(null);
  };

  return (
    <div class="layout">
      {/* Header - spans full width */}
      <Header userName={props.userName} onSettingsClick={handleSettingsClick} />

      {/* Middle section - sidebar + main content */}
      <div class="layout-middle">
        {/* Sidebar */}
        <AppSidebar
          collapsed={sidebarCollapsed()}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed())}
          sessions={sessionStore.sessions}
          activeSessionId={sessionStore.activeSessionId}
          onSelectSession={handleSelectSession}
          onStartSession={handleStartSession}
          onStopSession={handleStopSession}
          onDeleteSession={handleDeleteSession}
          onCreateSession={handleCreateSession}
          onReconnect={handleReconnect}
        />

        {/* Main content */}
        <TerminalArea
          activeSession={activeSession() ?? null}
          runningSessions={runningSessions()}
          showTerminal={showTerminal() ?? false}
          hasInitializingSession={hasInitializingSession()}
          allSessionsStopped={allSessionsStopped()}
          activeTiling={activeTiling()}
          activeTabOrder={activeTabOrder()}
          activeTerminals={activeTerminals()}
          showTilingOverlay={showTilingOverlay()}
          onTilingButtonClick={handleTilingButtonClick}
          onSelectTilingLayout={handleSelectTilingLayout}
          onCloseTilingOverlay={handleCloseTilingOverlay}
          onTileClick={handleTileClick}
          onOpenSessionById={handleOpenSessionById}
          onStartSession={handleStartSession}
          onTerminalError={setTerminalError}
          error={sessionStore.error || terminalError()}
          onDismissError={handleDismissError}
        />
      </div>

      {/* Status bar - spans full width */}
      <StatusBar isConnected={isConnected()} lastSyncTime={lastSyncTime()} />

      {/* Settings Panel - slides in from right */}
      <SettingsPanel isOpen={isSettingsOpen()} onClose={handleSettingsClose} />

      <style>{`
        .layout {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
        }

        .layout-middle {
          display: flex;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }

        .layout-sidebar {
          display: flex;
          flex-direction: column;
          width: var(--sidebar-width);
          background: var(--color-bg-surface);
          border-right: 1px solid var(--color-border-subtle);
          transition: width var(--transition-slow);
        }

        .layout-sidebar--collapsed {
          width: var(--sidebar-collapsed-width);
        }

        .layout-sidebar-header {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: var(--space-3);
          border-bottom: 1px solid var(--color-border-subtle);
          min-width: 0;
        }

        .layout-sidebar--collapsed .layout-sidebar-header {
          justify-content: center;
          padding: var(--space-3) var(--space-2);
        }

        .layout-sidebar-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-md);
          color: var(--color-text-secondary);
          transition: all var(--transition-fast);
        }

        .layout-sidebar-toggle:hover {
          background: var(--color-bg-muted);
          color: var(--color-text-primary);
        }

        .layout-sidebar-content {
          flex: 1;
          overflow: hidden;
        }

        .layout-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          background: var(--color-bg-base);
        }

        .layout-error {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-3) var(--space-4);
          background: var(--color-error-muted);
          border-bottom: 1px solid var(--color-error);
          color: var(--color-error);
        }

        .layout-error button {
          padding: var(--space-1) var(--space-3);
          font-size: var(--text-xs);
          background: rgba(239, 68, 68, 0.2);
          border-radius: var(--radius-sm);
          transition: background var(--transition-fast);
        }

        .layout-error button:hover {
          background: rgba(239, 68, 68, 0.3);
        }

        /* Bug 4 fix: layout-init-overlay removed - now handled per-terminal */

        .layout-terminal-container {
          flex: 1;
          position: relative;
          overflow: hidden;
          height: 100%;
          min-height: 0;
        }

        .layout-tiling-button-wrapper {
          position: absolute;
          top: var(--space-2);
          right: var(--space-2);
          z-index: 20;
        }

        .layout-empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: var(--space-8);
        }
      `}</style>
    </div>
  );
};

export default Layout;
