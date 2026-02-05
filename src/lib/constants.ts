// Port constants (single source of truth)
// Terminal server handles all endpoints: WebSocket, health, metrics
export const TERMINAL_SERVER_PORT = 8080;
// Health server consolidated into terminal server (same port)
export const HEALTH_SERVER_PORT = 8080;

// Session ID validation
export const SESSION_ID_PATTERN = /^[a-z0-9]{8,24}$/;

// Retry/polling configuration
export const MAX_HEALTH_CHECK_ATTEMPTS = 30;
export const HEALTH_CHECK_INTERVAL_MS = 1000;

// Terminal refresh delay
export const TERMINAL_REFRESH_DELAY_MS = 150;

// Default allowed origin patterns for CORS
// These are used if ALLOWED_ORIGINS environment variable is not set
export const DEFAULT_ALLOWED_ORIGINS = ['.workers.dev'];

/** Idle timeout before container sleeps (30 minutes) */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Delay after setting bucket name before proceeding */
export const BUCKET_NAME_SETTLE_DELAY_MS = 100;

/** Cloudflare R2 Admin permission ID (includes read + write) */
export const R2_WRITE_PERMISSION_ID = 'e0d1f652c7d84d35a4e356734cad1c2b';

/** Cloudflare R2 Read permission ID */
export const R2_READ_PERMISSION_ID = 'f2bfce71c75a4c1b86e288eb50549efc';

/** Request ID display length */
export const REQUEST_ID_LENGTH = 8;

/** CORS max age in seconds */
export const CORS_MAX_AGE_SECONDS = '86400';

/** DO ID validation pattern */
export const DO_ID_PATTERN = /^[a-f0-9]{64}$/i;

/** Maximum session name length */
export const MAX_SESSION_NAME_LENGTH = 100;

/** Container ID display truncation length */
export const CONTAINER_ID_DISPLAY_LENGTH = 24;
