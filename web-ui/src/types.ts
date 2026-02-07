/**
 * Session metadata - mirrors backend Session type from src/types.ts
 * Note: Backend Session includes `userId` which is not exposed to the frontend.
 * @see src/types.ts for the backend definition
 */
export interface Session {
  id: string;
  name: string;
  createdAt: string;
  lastAccessedAt: string;
}

/**
 * Frontend-specific session status (simplified view of container state).
 * Maps to backend ContainerStatus as follows:
 * - 'stopped' -> container not running
 * - 'initializing' -> 'starting' | 'mounting' | 'verifying' | 'launching' (backend states)
 * - 'running' -> container fully operational
 * - 'error' -> container encountered an error
 * @see src/types.ts ContainerStatus for backend definition
 */
export type SessionStatus = 'stopped' | 'initializing' | 'running' | 'error';

export interface SessionWithStatus extends Session {
  status: SessionStatus;
}

/**
 * Progress stages for session initialization.
 * These stages are returned by the startup-status polling endpoint.
 * @see src/routes/container.ts GET /startup-status for backend implementation
 */
export type InitStage =
  | 'creating'
  | 'starting'
  | 'syncing'
  | 'mounting'
  | 'verifying'
  | 'ready'
  | 'error'
  | 'stopped';

export interface InitProgressDetail {
  key: string;
  value: string;
  status?: 'ok' | 'error' | 'pending';
}

export interface InitProgress {
  stage: InitStage;
  progress: number;
  message: string;
  details?: InitProgressDetail[];
}

// Startup status response from polling endpoint
export interface StartupStatusResponse {
  stage: InitStage;
  progress: number;
  message: string;
  details: {
    bucketName: string;
    container: string;
    path: string;
    email?: string;
    containerStatus?: string;
    syncStatus?: string;
    syncError?: string | null;
    terminalPid?: number;
    healthServerOk?: boolean;
    terminalServerOk?: boolean;
    // System metrics from health server
    cpu?: string;
    mem?: string;
    hdd?: string;
  };
  error?: string;
}

export interface UserInfo {
  email: string;
  authenticated: boolean;
  bucketName: string;
  bucketCreated?: boolean;
  role?: 'admin' | 'user';
}

// Terminal connection state
export type TerminalConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

// Terminal tab within a session (multiple terminals per container)
export interface TerminalTab {
  id: string;        // "1", "2", "3", "4"
  createdAt: string;
}

// Tiling layout types
export type TileLayout = 'tabbed' | '2-split' | '3-split' | '4-grid';

export interface TilingState {
  enabled: boolean;
  layout: TileLayout;
}

// Track terminals per session
export interface SessionTerminals {
  tabs: TerminalTab[];
  activeTabId: string | null;
  tabOrder: string[];     // Display order (tab "1" always first)
  tiling: TilingState;    // Tiling configuration
}

