import { createStore, produce } from 'solid-js/store';
import type { Session, SessionWithStatus, SessionStatus, InitProgress, TerminalTab, SessionTerminals, TileLayout, TilingState } from '../types';
import * as api from '../api/client';
import { terminalStore } from './terminal';
import { METRICS_POLL_INTERVAL_MS, MAX_TERMINALS_PER_SESSION } from '../lib/constants';

// ============================================================================
// Session Metrics Type
// ============================================================================
interface SessionMetrics {
  bucketName: string;
  syncStatus: 'pending' | 'syncing' | 'success' | 'failed' | 'skipped';
  terminalPid?: number;
  cpu?: string;
  mem?: string;
  hdd?: string;
}

// ============================================================================
// localStorage persistence for terminal tabs
// ============================================================================
const TERMINALS_STORAGE_KEY = 'claudeflare:terminalsPerSession';

function loadTerminalsFromStorage(): Record<string, SessionTerminals> {
  try {
    const stored = localStorage.getItem(TERMINALS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[SessionStore] Failed to load terminals from storage:', e);
  }
  return {};
}

function saveTerminalsToStorage(terminalsPerSession: Record<string, SessionTerminals>): void {
  try {
    localStorage.setItem(TERMINALS_STORAGE_KEY, JSON.stringify(terminalsPerSession));
  } catch (e) {
    console.warn('[SessionStore] Failed to save terminals to storage:', e);
  }
}

interface SessionState {
  sessions: SessionWithStatus[];
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;
  // Track initialization per-session (supports multiple sessions initializing simultaneously)
  initializingSessionIds: Record<string, boolean>;
  initProgressBySession: Record<string, InitProgress>;
  // Nested terminals: Track multiple terminals per session
  terminalsPerSession: Record<string, SessionTerminals>;
  // Developer metrics per session
  sessionMetrics: Record<string, SessionMetrics>;
}

const [state, setState] = createStore<SessionState>({
  sessions: [],
  activeSessionId: null,
  loading: false,
  error: null,
  initializingSessionIds: {},
  initProgressBySession: {},
  terminalsPerSession: loadTerminalsFromStorage(),
  sessionMetrics: {},
});

// Get active session
function getActiveSession(): SessionWithStatus | undefined {
  return state.sessions.find((s) => s.id === state.activeSessionId);
}

// Track startup polling cleanup functions per session
const startupCleanups = new Map<string, () => void>();

// Track if loadSessions is in progress to prevent concurrent calls
let loadSessionsInProgress = false;

// Load sessions from API
async function loadSessions(): Promise<void> {
  // Debounce: prevent concurrent loadSessions calls that cause race conditions
  if (loadSessionsInProgress) {
    console.log('[SessionStore] loadSessions already in progress, skipping');
    return;
  }
  loadSessionsInProgress = true;

  setState('loading', true);
  setState('error', null);

  try {
    // Fetch session list and batch status in parallel (2 calls instead of 1+N+M)
    const [sessions, batchStatuses] = await Promise.all([
      api.getSessions(),
      api.getBatchSessionStatus().catch(() => ({} as Record<string, { status: string; ptyActive: boolean }>)),
    ]);

    // Preserve existing status for sessions we already know about
    // This prevents the "flash to stopped" issue
    const existingStatuses = new Map(
      state.sessions.map(s => [s.id, s.status])
    );

    const sessionsWithStatus: SessionWithStatus[] = sessions.map((s) => ({
      ...s,
      // Use existing status if available, otherwise default to 'stopped'
      status: existingStatuses.get(s.id) || ('stopped' as SessionStatus),
    }));
    setState('sessions', sessionsWithStatus);

    // Apply batch statuses and handle running sessions
    await Promise.all(
      sessionsWithStatus.map(async (session) => {
        try {
          const batchStatus = batchStatuses[session.id];
          if (!batchStatus) {
            // No batch status available - keep existing or default
            return;
          }

          if (batchStatus.status === 'running') {
            // Container is healthy - verify live state for running sessions
            try {
              const liveStatus = await api.getStartupStatus(session.id);
              if (liveStatus.stage === 'ready') {
                updateSessionStatus(session.id, 'running');
                initializeTerminalsForSession(session.id);
              } else if (liveStatus.stage === 'error') {
                updateSessionStatus(session.id, 'error');
              } else if (liveStatus.stage === 'stopped') {
                updateSessionStatus(session.id, 'stopped');
              } else {
                // Container starting/syncing - mark as initializing
                updateSessionStatus(session.id, 'initializing');
                // Store init progress so UI shows the progress bar
                setState(
                  produce((s) => {
                    s.initializingSessionIds[session.id] = true;
                    s.initProgressBySession[session.id] = {
                      stage: liveStatus.stage,
                      progress: liveStatus.progress,
                      message: liveStatus.message,
                    };
                  })
                );
              }
            } catch {
              // Container not reachable via startup-status but batch says running
              // Trust batch - container might be slow to respond
              console.warn(`[SessionStore] Container ${session.id} unreachable via startup-status, keeping batch status: running`);
              updateSessionStatus(session.id, 'running');
              initializeTerminalsForSession(session.id);
            }
          } else {
            updateSessionStatus(session.id, batchStatus.status as SessionStatus);
          }
        } catch {
          // Status check failed, ignore
        }
      })
    );
  } catch (e) {
    setState('error', e instanceof Error ? e.message : 'Failed to load sessions');
  } finally {
    setState('loading', false);
    loadSessionsInProgress = false;
  }
}

// Create new session
async function createSession(name: string): Promise<SessionWithStatus | null> {
  try {
    const session = await api.createSession(name);
    const sessionWithStatus: SessionWithStatus = {
      ...session,
      status: 'stopped',
    };
    setState(
      produce((s) => {
        s.sessions.push(sessionWithStatus);
      })
    );
    return sessionWithStatus;
  } catch (e) {
    setState('error', e instanceof Error ? e.message : 'Failed to create session');
    return null;
  }
}

// Delete session
async function deleteSession(id: string): Promise<void> {
  try {
    // Cancel startup polling if in progress
    const startupCleanup = startupCleanups.get(id);
    if (startupCleanup) {
      startupCleanup();
      startupCleanups.delete(id);
    }
    // Clean up metrics polling and terminal state before deleting
    stopMetricsPolling(id);
    cleanupTerminalsForSession(id);
    await api.deleteSession(id);
    setState(
      produce((s) => {
        s.sessions = s.sessions.filter((session) => session.id !== id);
        if (s.activeSessionId === id) {
          s.activeSessionId = null;
        }
        // Clean up metrics state
        delete s.sessionMetrics[id];
      })
    );
  } catch (e) {
    setState('error', e instanceof Error ? e.message : 'Failed to delete session');
  }
}

// Start session with progress tracking
function startSession(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Track initialization per-session
    setState(
      produce((s) => {
        s.initializingSessionIds[id] = true;
        delete s.initProgressBySession[id];
      })
    );
    updateSessionStatus(id, 'initializing');

    const cleanup = api.startSession(
      id,
      // onProgress
      (progress) => {
        setState(
          produce((s) => {
            s.initProgressBySession[id] = progress;
          })
        );
      },
      // onComplete - keep showing progress UI until user clicks "Open"
      () => {
        // Don't clear initializingSessionId or initProgress here
        // User will dismiss via dismissInitProgress()
        startupCleanups.delete(id);
        updateSessionStatus(id, 'running');
        // Initialize terminals for this session (creates first terminal tab)
        initializeTerminalsForSession(id);
        resolve();
      },
      // onError
      (error) => {
        startupCleanups.delete(id);
        // Clear per-session state on error
        setState(
          produce((s) => {
            delete s.initializingSessionIds[id];
            delete s.initProgressBySession[id];
          })
        );
        updateSessionStatus(id, 'error');
        setState('error', error);
        reject(new Error(error));
      }
    );

    // Store cleanup function so we can cancel polling on stop/delete
    startupCleanups.set(id, cleanup);
  });
}

// Stop session
async function stopSession(id: string): Promise<void> {
  try {
    // Cancel startup polling if in progress
    const startupCleanup = startupCleanups.get(id);
    if (startupCleanup) {
      startupCleanup();
      startupCleanups.delete(id);
    }
    // Clear initialization state if in progress (allows stopping stuck sessions)
    setState(
      produce((s) => {
        delete s.initializingSessionIds[id];
        delete s.initProgressBySession[id];
      })
    );
    // Stop metrics polling before stopping the session
    stopMetricsPolling(id);
    await api.stopSession(id);
    updateSessionStatus(id, 'stopped');
    // Disconnect terminals but preserve tab layout for restart
    terminalStore.disposeSession(id);
  } catch (e) {
    setState('error', e instanceof Error ? e.message : 'Failed to stop session');
  }
}

// Update session status
function updateSessionStatus(id: string, status: SessionStatus): void {
  const index = state.sessions.findIndex((sess) => sess.id === id);
  if (index !== -1) {
    setState('sessions', index, 'status', status);

    // Start/stop metrics polling based on status
    if (status === 'running') {
      startMetricsPolling(id);
    } else {
      stopMetricsPolling(id);
    }
  }
}

// Set active session
function setActiveSession(id: string | null): void {
  setState('activeSessionId', id);

  // Update lastAccessedAt
  if (id) {
    const index = state.sessions.findIndex((sess) => sess.id === id);
    if (index !== -1) {
      setState('sessions', index, 'lastAccessedAt', new Date().toISOString());
    }
  }
}

// Clear error
function clearError(): void {
  setState('error', null);
}

// Dismiss init progress for a specific session (called when user clicks "Open" button)
function dismissInitProgressForSession(sessionId: string): void {
  setState(
    produce((s) => {
      delete s.initializingSessionIds[sessionId];
      delete s.initProgressBySession[sessionId];
    })
  );
}

// Check if a specific session is initializing
function isSessionInitializing(sessionId: string): boolean {
  return state.initializingSessionIds[sessionId] === true;
}

// Get init progress for a specific session
function getInitProgressForSession(sessionId: string): InitProgress | null {
  return state.initProgressBySession[sessionId] || null;
}

// ============================================================================
// Session Metrics
// ============================================================================

// Fetch metrics for a session (uses existing api.getStartupStatus)
async function fetchMetricsForSession(sessionId: string): Promise<void> {
  try {
    const status = await api.getStartupStatus(sessionId);
    if (status.details) {
      setState(produce(s => {
        s.sessionMetrics[sessionId] = {
          bucketName: status.details?.bucketName || '...',
          syncStatus: (status.details?.syncStatus as 'pending' | 'syncing' | 'success' | 'failed' | 'skipped') || 'pending',
          terminalPid: status.details?.terminalPid,
          cpu: status.details?.cpu || '...',
          mem: status.details?.mem || '...',
          hdd: status.details?.hdd || '...',
        };
      }));
    }
  } catch (e) {
    console.warn('[SessionStore] Failed to fetch metrics:', e);
  }
}

// Auto-fetch metrics for running sessions (called after session becomes running)
const metricsPollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

function startMetricsPolling(sessionId: string): void {
  // Don't start if already polling
  if (metricsPollingIntervals.has(sessionId)) return;

  // Fetch immediately
  fetchMetricsForSession(sessionId);

  // Poll at regular intervals
  metricsPollingIntervals.set(sessionId, setInterval(() => {
    fetchMetricsForSession(sessionId);
  }, METRICS_POLL_INTERVAL_MS));
}

function stopMetricsPolling(sessionId: string): void {
  const interval = metricsPollingIntervals.get(sessionId);
  if (interval) {
    clearInterval(interval);
    metricsPollingIntervals.delete(sessionId);
    console.log(`[SessionStore] Stopped metrics polling for session ${sessionId}`);
  }
}

// Stop all metrics polling and startup polling (useful for cleanup)
function stopAllMetricsPolling(): void {
  metricsPollingIntervals.forEach((interval, sessionId) => {
    clearInterval(interval);
    console.log(`[SessionStore] Stopped metrics polling for session ${sessionId}`);
  });
  metricsPollingIntervals.clear();

  for (const [sessionId, cleanup] of startupCleanups) {
    cleanup();
    console.log(`[SessionStore] Stopped startup polling for session ${sessionId}`);
  }
  startupCleanups.clear();
}

// Get metrics for a specific session
function getMetricsForSession(sessionId: string): SessionMetrics | null {
  return state.sessionMetrics[sessionId] || null;
}

// ============================================================================
// Nested Terminals: Multiple terminals per session
// ============================================================================

// Initialize terminals for a new/started session (creates first terminal)
function initializeTerminalsForSession(sessionId: string): void {
  if (state.terminalsPerSession[sessionId]) {
    // Migrate existing sessions to include tabOrder and tiling if missing
    const existing = state.terminalsPerSession[sessionId];
    if (!existing.tabOrder || !existing.tiling) {
      setState(
        produce((s) => {
          if (!s.terminalsPerSession[sessionId].tabOrder) {
            s.terminalsPerSession[sessionId].tabOrder = s.terminalsPerSession[sessionId].tabs.map(t => t.id);
          }
          if (!s.terminalsPerSession[sessionId].tiling) {
            s.terminalsPerSession[sessionId].tiling = { enabled: false, layout: 'tabbed' };
          }
        })
      );
      saveTerminalsToStorage(state.terminalsPerSession);
    }
    return;
  }

  setState(
    produce((s) => {
      s.terminalsPerSession[sessionId] = {
        tabs: [{ id: '1', createdAt: new Date().toISOString() }],
        activeTabId: '1',
        tabOrder: ['1'],
        tiling: { enabled: false, layout: 'tabbed' },
      };
    })
  );
  saveTerminalsToStorage(state.terminalsPerSession);
}

// Add a new terminal tab (max 6)
function addTerminalTab(sessionId: string): string | null {
  const terminals = state.terminalsPerSession[sessionId];
  if (!terminals || terminals.tabs.length >= MAX_TERMINALS_PER_SESSION) {
    return null;
  }

  // Find next available ID (1-6)
  const existingIds = new Set(terminals.tabs.map(t => t.id));
  let newId: string | null = null;
  for (let i = 1; i <= MAX_TERMINALS_PER_SESSION; i++) {
    if (!existingIds.has(String(i))) {
      newId = String(i);
      break;
    }
  }

  if (!newId) return null;

  setState(
    produce((s) => {
      s.terminalsPerSession[sessionId].tabs.push({
        id: newId!,
        createdAt: new Date().toISOString(),
      });
      s.terminalsPerSession[sessionId].activeTabId = newId!;
      // Add to tabOrder (at the end)
      if (!s.terminalsPerSession[sessionId].tabOrder) {
        s.terminalsPerSession[sessionId].tabOrder = s.terminalsPerSession[sessionId].tabs.map(t => t.id);
      } else {
        s.terminalsPerSession[sessionId].tabOrder.push(newId!);
      }
    })
  );
  saveTerminalsToStorage(state.terminalsPerSession);

  return newId;
}

// Helper to check if layout is compatible with tab count
function isLayoutCompatible(layout: TileLayout, tabCount: number): boolean {
  switch (layout) {
    case 'tabbed':
      return true;
    case '2-split':
      return tabCount >= 2;
    case '3-split':
      return tabCount >= 3;
    case '4-grid':
      return tabCount >= 4;
    default:
      return false;
  }
}

// Remove a terminal tab (can't remove last one)
function removeTerminalTab(sessionId: string, terminalId: string): boolean {
  const terminals = state.terminalsPerSession[sessionId];
  if (!terminals || terminals.tabs.length <= 1) {
    return false;
  }

  // Dispose the terminal connection
  terminalStore.dispose(sessionId, terminalId);

  setState(
    produce((s) => {
      const tabs = s.terminalsPerSession[sessionId].tabs;
      s.terminalsPerSession[sessionId].tabs = tabs.filter(t => t.id !== terminalId);

      // Remove from tabOrder
      if (s.terminalsPerSession[sessionId].tabOrder) {
        s.terminalsPerSession[sessionId].tabOrder = s.terminalsPerSession[sessionId].tabOrder.filter(
          id => id !== terminalId
        );
      }

      // If we removed the active tab, switch to the first remaining one
      if (s.terminalsPerSession[sessionId].activeTabId === terminalId) {
        s.terminalsPerSession[sessionId].activeTabId =
          s.terminalsPerSession[sessionId].tabs[0]?.id || null;
      }

      // Auto-disable tiling if layout becomes incompatible
      const newTabCount = s.terminalsPerSession[sessionId].tabs.length;
      const currentTiling = s.terminalsPerSession[sessionId].tiling;
      if (currentTiling?.enabled && !isLayoutCompatible(currentTiling.layout, newTabCount)) {
        s.terminalsPerSession[sessionId].tiling = { enabled: false, layout: 'tabbed' };
      }
    })
  );
  saveTerminalsToStorage(state.terminalsPerSession);

  return true;
}

// Set active terminal tab
function setActiveTerminalTab(sessionId: string, terminalId: string): void {
  setState(
    produce((s) => {
      if (s.terminalsPerSession[sessionId]) {
        s.terminalsPerSession[sessionId].activeTabId = terminalId;
      }
    })
  );
  saveTerminalsToStorage(state.terminalsPerSession);
}

// Get terminals for a session
function getTerminalsForSession(sessionId: string): SessionTerminals | null {
  return state.terminalsPerSession[sessionId] || null;
}

// Reorder terminal tabs (tab 1 must stay first)
function reorderTerminalTabs(sessionId: string, newOrder: string[]): boolean {
  const terminals = state.terminalsPerSession[sessionId];
  if (!terminals) return false;

  // Validate: tab 1 must be first
  if (newOrder[0] !== '1') return false;

  // Validate: all existing tabs must be present
  const existingIds = new Set(terminals.tabs.map(t => t.id));
  const newIds = new Set(newOrder);

  // Check same length
  if (existingIds.size !== newIds.size) return false;

  // Check all existing tabs are in new order
  for (const id of existingIds) {
    if (!newIds.has(id)) return false;
  }

  // Check no extra tabs in new order
  for (const id of newIds) {
    if (!existingIds.has(id)) return false;
  }

  setState(
    produce((s) => {
      s.terminalsPerSession[sessionId].tabOrder = [...newOrder];
    })
  );
  saveTerminalsToStorage(state.terminalsPerSession);

  return true;
}

// Set tiling layout
function setTilingLayout(sessionId: string, layout: TileLayout): boolean {
  const terminals = state.terminalsPerSession[sessionId];
  if (!terminals) return false;

  const tabCount = terminals.tabs.length;

  // Validate layout compatibility
  if (!isLayoutCompatible(layout, tabCount)) return false;

  setState(
    produce((s) => {
      s.terminalsPerSession[sessionId].tiling = {
        enabled: layout !== 'tabbed',
        layout,
      };
    })
  );
  saveTerminalsToStorage(state.terminalsPerSession);

  // Trigger terminal resize for all tiled terminals after layout change
  // This ensures TUI apps (htop, yazi, etc.) receive SIGWINCH and redraw
  terminalStore.triggerLayoutResize();

  return true;
}

// Get tiling state for a session
function getTilingForSession(sessionId: string): TilingState | null {
  const terminals = state.terminalsPerSession[sessionId];
  return terminals?.tiling || null;
}

// Get tab order for a session
function getTabOrder(sessionId: string): string[] | null {
  const terminals = state.terminalsPerSession[sessionId];
  return terminals?.tabOrder || null;
}

// Clean up terminals when session is stopped/deleted
function cleanupTerminalsForSession(sessionId: string): void {
  // Dispose all terminal connections for this session
  terminalStore.disposeSession(sessionId);

  setState(
    produce((s) => {
      delete s.terminalsPerSession[sessionId];
    })
  );
  saveTerminalsToStorage(state.terminalsPerSession);
}

// Export store and actions
export const sessionStore = {
  // State (readonly)
  get sessions() {
    return state.sessions;
  },
  get activeSessionId() {
    return state.activeSessionId;
  },
  get loading() {
    return state.loading;
  },
  get error() {
    return state.error;
  },

  // Derived
  getActiveSession,

  // Per-session initialization state accessors
  isSessionInitializing,
  getInitProgressForSession,

  // Session metrics
  getMetricsForSession,
  stopMetricsPolling,
  stopAllMetricsPolling,

  // Actions
  loadSessions,
  createSession,
  deleteSession,
  startSession,
  stopSession,
  setActiveSession,
  clearError,
  dismissInitProgressForSession,

  // Nested terminals management
  getTerminalsForSession,
  initializeTerminalsForSession,
  addTerminalTab,
  removeTerminalTab,
  setActiveTerminalTab,
  cleanupTerminalsForSession,

  // Tiling management
  reorderTerminalTabs,
  setTilingLayout,
  getTilingForSession,
  getTabOrder,
};
