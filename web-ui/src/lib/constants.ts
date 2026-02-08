/**
 * Frontend Constants - Single source of truth for magic numbers
 * Keep in sync with backend constants where applicable (src/lib/constants.ts)
 */

// =============================================================================
// Polling Intervals
// =============================================================================

/** Interval for polling startup status during session initialization (ms) */
export const STARTUP_POLL_INTERVAL_MS = 1500;

/** Interval for polling session metrics when running (ms) */
export const METRICS_POLL_INTERVAL_MS = 5000;

/** Maximum consecutive polling errors before aborting startup */
export const MAX_STARTUP_POLL_ERRORS = 10;

// =============================================================================
// Terminal Connection
// =============================================================================

/** Maximum connection retries during initial connect */
export const MAX_CONNECTION_RETRIES = 45;

/** Delay between initial connection retry attempts (ms) */
export const CONNECTION_RETRY_DELAY_MS = 1500;

/** Maximum reconnection attempts for dropped connections */
export const MAX_RECONNECT_ATTEMPTS = 5;

/** Delay between reconnection attempts (ms) */
export const RECONNECT_DELAY_MS = 2000;

/** Secondary refresh delay for cursor position fix (ms) */
export const TERMINAL_SECONDARY_REFRESH_DELAY_MS = 100;

/** Idle threshold: if no data received for this long, buffer replay is considered done (ms) */
export const BUFFER_REPLAY_IDLE_THRESHOLD_MS = 100;

/** Maximum time to wait for buffer replay to finish before forcing refresh (ms) */
export const BUFFER_REPLAY_MAX_WAIT_MS = 2000;

/** Polling interval for checking buffer replay idle state (ms) */
export const BUFFER_REPLAY_CHECK_INTERVAL_MS = 50;

// =============================================================================
// UI Timing
// =============================================================================

/** Delay for CSS transitions to settle before layout operations (ms) */
export const CSS_TRANSITION_DELAY_MS = 50;

// =============================================================================
// WebSocket Close Codes
// =============================================================================

/** WebSocket close code for abnormal closure (connection failed) */
export const WS_CLOSE_ABNORMAL = 1006;

// =============================================================================
// Session
// =============================================================================

/** Maximum terminals per session */
export const MAX_TERMINALS_PER_SESSION = 6;

/** Duration display refresh interval (ms) - for relative time updates */
export const DURATION_REFRESH_INTERVAL_MS = 60000;

/** Session ID display length */
export const SESSION_ID_DISPLAY_LENGTH = 8;
