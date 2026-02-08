import { Component, createSignal, createMemo, onMount } from 'solid-js';
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

  // Bug 4 fix: Show terminal even when other sessions are initializing
  // The init progress overlay is now per-session, inside the Terminal component
  const showTerminal = createMemo(() => {
    const session = sessionStore.getActiveSession();
    return session && (session.status === 'running' || session.status === 'initializing');
  });

  // Connection status based on whether we have any running sessions
  const isConnected = createMemo(() => {
    return sessionStore.sessions.some((s) => s.status === 'running' || s.status === 'initializing');
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
    } catch (err) {
      console.error('Failed to start session:', err);
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

  const handleStartMostRecentSession = () => {
    const sessions = sessionStore.sessions;
    if (sessions.length === 0) return;
    const mostRecent = [...sessions].sort((a, b) =>
      new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
    )[0];
    if (mostRecent) {
      handleStartSession(mostRecent.id);
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
          showTerminal={showTerminal() ?? false}
          showTilingOverlay={showTilingOverlay()}
          onTilingButtonClick={handleTilingButtonClick}
          onSelectTilingLayout={handleSelectTilingLayout}
          onCloseTilingOverlay={handleCloseTilingOverlay}
          onTileClick={handleTileClick}
          onOpenSessionById={handleOpenSessionById}
          onStartSession={handleStartSession}
          onStartMostRecentSession={handleStartMostRecentSession}
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
