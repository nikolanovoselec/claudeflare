import { Component, Show, createSignal, createMemo, onMount } from 'solid-js';
import Header from './Header';
import StatusBar from './StatusBar';
import AppSidebar from './AppSidebar';
import TerminalArea from './TerminalArea';
import SettingsPanel from './SettingsPanel';
import './TiledTerminalContainer.css';
import '../styles/layout.css';
import { sessionStore } from '../stores/session';
import { terminalStore } from '../stores/terminal';
import type { TileLayout } from '../types';

interface LayoutProps {
  userName?: string;
  userRole?: 'admin' | 'user';
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
      <SettingsPanel isOpen={isSettingsOpen()} onClose={handleSettingsClose} currentUserEmail={props.userName} currentUserRole={props.userRole} />

    </div>
  );
};

export default Layout;
