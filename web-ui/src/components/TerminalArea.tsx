import { Component, Show, For, createMemo, Setter } from 'solid-js';
import Terminal from './Terminal';
import TerminalTabs from './TerminalTabs';
import TilingButton from './TilingButton';
import TilingOverlay from './TilingOverlay';
import TiledTerminalContainer from './TiledTerminalContainer';
import {
  NoSessionsEmptyState,
  AllStoppedEmptyState,
} from './EmptyStateVariants';
import { sessionStore } from '../stores/session';
import type { SessionWithStatus, TileLayout, TilingState, SessionTerminals } from '../types';

export interface TerminalAreaProps {
  activeSession: SessionWithStatus | null;
  runningSessions: SessionWithStatus[];
  showTerminal: boolean;
  hasInitializingSession: boolean;
  allSessionsStopped: boolean;
  activeTiling: TilingState | null;
  activeTabOrder: string[] | null;
  activeTerminals: SessionTerminals | null;
  showTilingOverlay: boolean;
  onTilingButtonClick: () => void;
  onSelectTilingLayout: (layout: TileLayout) => void;
  onCloseTilingOverlay: () => void;
  onTileClick: (tabId: string) => void;
  onOpenSessionById: (sessionId: string) => void;
  onStartSession: (id: string) => void;
  onTerminalError: Setter<string | null>;
  error: string | null;
  onDismissError: () => void;
}

const TerminalArea: Component<TerminalAreaProps> = (props) => {
  return (
    <main class="layout-main">
      {/* Error display */}
      <Show when={props.error}>
        <div class="layout-error">
          <span>{props.error}</span>
          <button onClick={props.onDismissError}>
            Dismiss
          </button>
        </div>
      </Show>

      {/* Terminal tabs - show when active session is running/initializing */}
      <Show when={props.showTerminal && sessionStore.activeSessionId}>
        <TerminalTabs sessionId={sessionStore.activeSessionId!} />
      </Show>

      {/* Terminal container - keep all terminals mounted for instant switching */}
      <div class="layout-terminal-container">
        {/* Tiling button - only show when active session is running with 2+ tabs */}
        <Show when={props.showTerminal && sessionStore.activeSessionId && props.activeTerminals}>
          <div class="layout-tiling-button-wrapper">
            <TilingButton
              sessionId={sessionStore.activeSessionId!}
              tabCount={props.activeTerminals?.tabs.length || 0}
              isActive={props.activeTiling?.enabled || false}
              onClick={props.onTilingButtonClick}
            />
            {/* Tiling overlay - positioned relative to button wrapper */}
            <Show when={props.showTilingOverlay}>
              <TilingOverlay
                tabCount={props.activeTerminals?.tabs.length || 0}
                currentLayout={props.activeTiling?.layout || 'tabbed'}
                onSelectLayout={props.onSelectTilingLayout}
                onClose={props.onCloseTilingOverlay}
              />
            </Show>
          </div>
        </Show>

        {/* Tiled terminal view - when tiling is enabled */}
        <Show when={props.activeTiling?.enabled && sessionStore.activeSessionId && props.activeTerminals}>
          <TiledTerminalContainer
            sessionId={sessionStore.activeSessionId!}
            terminals={props.activeTerminals!.tabs}
            tabOrder={props.activeTabOrder || []}
            layout={props.activeTiling!.layout}
            activeTabId={props.activeTerminals!.activeTabId}
            onTileClick={props.onTileClick}
            renderTerminal={(tabId, slotIndex) => {
              const session = props.activeSession;
              if (!session) return null;
              return (
                <Terminal
                  sessionId={session.id}
                  terminalId={tabId}
                  sessionName={session.name}
                  active={true}
                  alwaysObserveResize={true}
                  onError={props.onTerminalError}
                  onInitComplete={() => props.onOpenSessionById(session.id)}
                />
              );
            }}
          />
        </Show>

        {/* Standard tabbed view - when tiling is disabled */}
        <Show when={!props.activeTiling?.enabled}>
          <For each={props.runningSessions}>
            {(session) => {
              // Get terminals for this session
              const terminals = createMemo(() => sessionStore.getTerminalsForSession(session.id));

              return (
                <For each={terminals()?.tabs || [{ id: '1', createdAt: '' }]}>
                  {(tab) => {
                    // Terminal is active if: session is active AND this tab is the active tab
                    // During initialization, sessionTerminals is null - use fallback logic
                    const isActive = createMemo(() => {
                      const isActiveSession = session.id === sessionStore.activeSessionId;
                      const sessionTerminals = sessionStore.getTerminalsForSession(session.id);
                      // If no terminals yet (initializing), fallback tab '1' is active
                      const isActiveTab = sessionTerminals
                        ? sessionTerminals.activeTabId === tab.id
                        : tab.id === '1';  // Fallback tab is always '1'
                      return isActiveSession && isActiveTab;
                    });

                    return (
                      <Terminal
                        sessionId={session.id}
                        terminalId={tab.id}
                        sessionName={session.name}
                        active={isActive()}
                        onError={props.onTerminalError}
                        onInitComplete={() => props.onOpenSessionById(session.id)}
                      />
                    );
                  }}
                </For>
              );
            }}
          </For>
        </Show>
      </div>

      {/* Empty state: No sessions */}
      <Show when={!props.activeSession && !props.hasInitializingSession && sessionStore.sessions.length === 0}>
        <div class="layout-empty-state">
          <NoSessionsEmptyState />
        </div>
      </Show>

      {/* Empty state: All sessions stopped */}
      <Show when={!props.activeSession && !props.hasInitializingSession && props.allSessionsStopped}>
        <div class="layout-empty-state">
          <AllStoppedEmptyState onStartLast={() => {
            const lastSession = getMostRecentSession();
            if (lastSession) {
              props.onStartSession(lastSession.id);
            }
          }} />
        </div>
      </Show>

      {/* Session selected but not running */}
      <Show when={props.activeSession && props.activeSession?.status === 'stopped' && !props.hasInitializingSession}>
        <div class="layout-empty-state">
          <AllStoppedEmptyState onStartLast={() => props.onStartSession(props.activeSession!.id)} />
        </div>
      </Show>
    </main>
  );
};

// Helper function to get most recent session
function getMostRecentSession(): SessionWithStatus | null {
  if (sessionStore.sessions.length === 0) return null;
  return [...sessionStore.sessions].sort((a, b) =>
    new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
  )[0];
}

export default TerminalArea;
