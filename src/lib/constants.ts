// Port constants (single source of truth)
// Terminal server handles all endpoints: WebSocket, health, metrics
export const TERMINAL_SERVER_PORT = 8080;

// Session ID validation
export const SESSION_ID_PATTERN = /^[a-z0-9]{8,24}$/;

// Retry/polling configuration
export const MAX_HEALTH_CHECK_ATTEMPTS = 30;
export const HEALTH_CHECK_INTERVAL_MS = 1000;

// Default allowed origin patterns for CORS
// These are used if ALLOWED_ORIGINS environment variable is not set
export const DEFAULT_ALLOWED_ORIGINS = ['.workers.dev'];

/** Idle timeout before container sleeps (30 minutes) */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Delay after setting bucket name before proceeding */
export const BUCKET_NAME_SETTLE_DELAY_MS = 100;

/** Request ID display length */
export const REQUEST_ID_LENGTH = 8;

/** CORS max age in seconds */
export const CORS_MAX_AGE_SECONDS = 86400;

/** DO ID validation pattern */
export const DO_ID_PATTERN = /^[a-f0-9]{64}$/i;

/** Maximum session name length */
export const MAX_SESSION_NAME_LENGTH = 100;

/** Container ID display truncation length */
export const CONTAINER_ID_DISPLAY_LENGTH = 24;

/** Activity poll interval for container idle detection (5 minutes) */
export const ACTIVITY_POLL_INTERVAL_MS = 5 * 60 * 1000;
