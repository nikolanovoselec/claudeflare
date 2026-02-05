# Claudeflare Technical Reference

Browser-based Claude Code on Cloudflare Workers with per-session containers and R2 persistence.

**Live URL:** https://claudeflare.your-subdomain.workers.dev (via Cloudflare Access)

---

## 1. Architecture Overview

Claudeflare runs Claude Code in isolated containers, one per browser session (tab). All sessions for a user share a single R2 bucket for persistent storage, with bidirectional sync keeping data consistent.

```
Browser Tab 1 (xterm.js)          Browser Tab 2 (xterm.js)
    | WebSocket                       | WebSocket
    +----------------------------------------------------+
                      |
         Cloudflare Worker (Hono router)
         |                              |
         | containerId=bucket-session1  | containerId=bucket-session2
         |                              |
    Container 1                    Container 2
    (for session 1)                (for session 2)
         |                              |
      PTY + Claude                   PTY + Claude
         |                              |
    rclone bisync (60s)           rclone bisync (60s)
         +---------------+--------------+
                         |
              R2 bucket (shared per user)
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| One container per SESSION | CPU isolation - each tab gets full 0.25 vCPU instead of sharing |
| Container ID format | `{bucketName}-{sessionId}` (e.g., `claudeflare-user-example-com-abc12345`) |
| Per-user R2 buckets | Bucket name derived from email, auto-created on first login |
| rclone bisync | Bidirectional sync every 60s, local disk for all file operations |
| Login shell | `.bashrc` auto-starts Claude Code in workspace |

---

## 2. Components

### 2.1 Worker (Hono Router)

**File:** `src/index.ts`

The Worker serves as the entry point and API gateway. Built with Hono framework.

**Responsibilities:**
- Route API requests to appropriate handlers
- WebSocket upgrade interception (before Hono - required workaround for CF Workers)
- Authentication via Cloudflare Access
- Container lifecycle management through Durable Objects
- CORS handling with configurable allowed origins

**Key Implementation Details:**

```typescript
// WebSocket must be intercepted BEFORE Hono routing
// See: https://github.com/cloudflare/workerd/issues/2319
const wsMatch = url.pathname.match(/^\/api\/terminal\/([^\/]+)\/ws$/);
if (wsMatch && upgradeHeader?.toLowerCase() === 'websocket') {
  // Direct forwarding to container, bypass Hono
  return container.fetch(new Request(terminalUrl.toString(), request));
}
```

**CORS Configuration:**
```typescript
// Reads ALLOWED_ORIGINS from env (comma-separated) or falls back to DEFAULT_ALLOWED_ORIGINS
function isAllowedOrigin(origin: string, env: Env): boolean {
  const allowedPatterns = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : DEFAULT_ALLOWED_ORIGINS;
  return allowedPatterns.some(pattern => origin.endsWith(pattern));
}
```

**Route Registration:**
- `/api/user` - User info endpoints
- `/api/container` - Container lifecycle (start, stop, destroy, health)
- `/api/sessions` - Session CRUD
- `/api/terminal` - WebSocket terminal proxy
- `/api/credentials` - Credential management
- `/api/setup` - Setup wizard (no auth required)

### 2.2 Auth Middleware

**File:** `src/middleware/auth.ts`

Shared authentication middleware used by all authenticated routes.

```typescript
export type AuthVariables = {
  user: AccessUser;
  bucketName: string;
};

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: AuthVariables }>,
  next: Next
) {
  const user = getUserFromRequest(c.req.raw, c.env);

  if (!user.authenticated) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const bucketName = getBucketName(user.email);
  c.set('user', user);
  c.set('bucketName', bucketName);
  return next();
}
```

**Usage in routes:**
```typescript
import { authMiddleware, AuthVariables } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
app.use('*', authMiddleware);

// Now handlers can access c.get('user') and c.get('bucketName')
```

### 2.3 Container Helpers

**File:** `src/lib/container-helpers.ts`

Consolidated container initialization pattern used across routes.

```typescript
// Get sessionId from request (query param or header)
export function getSessionIdFromRequest(c: Context): string {
  const sessionId = c.req.query('sessionId') || c.req.header('X-Browser-Session');
  if (!sessionId) throw new Error('Missing sessionId parameter');
  return sessionId;
}

// Create container ID with validation
export function getContainerId(bucketName: string, sessionId: string): string {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}`);
  }
  return `${bucketName}-${sessionId}`;
}

// Get full container context for route handlers
export function getContainerContext<V extends ContainerVariables>(
  c: Context<{ Bindings: Env; Variables: V }>
) {
  const bucketName = c.get('bucketName');
  const sessionId = getSessionIdFromRequest(c);
  const containerId = getContainerId(bucketName, sessionId);
  const container = getContainer(c.env.CONTAINER, containerId);
  return { bucketName, sessionId, containerId, container };
}
```

### 2.4 Error Handling

**File:** `src/lib/errors.ts`

Standardized error response helpers for consistent API responses.

```typescript
export function errorResponse(c: Context, status: ContentfulStatusCode, message: string) {
  return c.json({ error: message }, status);
}

export function successResponse<T extends object>(c: Context, data: T) {
  return c.json({ success: true, ...data });
}
```

### 2.5 Type Guards

**File:** `src/lib/type-guards.ts`

Runtime type validation to replace unsafe type casts.

```typescript
export function isAdminRequest(data: unknown): data is { doId: string } {
  return typeof data === 'object' && data !== null &&
         'doId' in data && typeof (data as any).doId === 'string';
}

export function isBucketNameResponse(data: unknown): data is { bucketName: string | null } {
  return typeof data === 'object' && data !== null && 'bucketName' in data;
}
```

### 2.6 Constants

**File:** `src/lib/constants.ts`

Single source of truth for configuration values.

```typescript
// Port constants (single port architecture)
export const TERMINAL_SERVER_PORT = 8080;
export const HEALTH_SERVER_PORT = 8080;  // Consolidated with terminal server

// Session ID validation
export const SESSION_ID_PATTERN = /^[a-z0-9]{8,24}$/;

// Retry/polling configuration
export const MAX_HEALTH_CHECK_ATTEMPTS = 30;
export const HEALTH_CHECK_INTERVAL_MS = 1000;

// Terminal refresh delay
export const TERMINAL_REFRESH_DELAY_MS = 150;

// Default CORS origins
export const DEFAULT_ALLOWED_ORIGINS = ['.workers.dev'];
```

### 2.7 Error Handling (AppError Hierarchy)

**File:** `src/lib/error-types.ts`

Centralized error classes for consistent API responses:

```typescript
// Base error class with code, status, internal message, and user message
export class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public userMessage?: string
  ) { ... }
}

// Specialized errors
export class NotFoundError extends AppError { ... }      // 404
export class ValidationError extends AppError { ... }   // 400
export class ContainerError extends AppError { ... }    // 500
export class AuthError extends AppError { ... }         // 401
```

**Usage:**
```typescript
throw new NotFoundError('Session', sessionId);
throw new ValidationError('Invalid session ID format');
throw new ContainerError('start', 'Health check timeout');
```

### 2.8 Circuit Breaker Pattern

**File:** `src/lib/circuit-breaker.ts`

Prevents cascading failures when external services are unavailable:

```typescript
const cb = new CircuitBreaker('container-api', {
  failureThreshold: 5,    // Open after 5 failures
  resetTimeoutMs: 30000,  // Try again after 30s
  halfOpenMaxAttempts: 2,
});

// Wraps container.fetch() calls
const result = await cb.execute(() => container.fetch(request));
```

**States:**
- CLOSED: Normal operation, requests pass through
- OPEN: Requests rejected immediately (fail fast)
- HALF_OPEN: Testing if service recovered

### 2.9 Rate Limiting Middleware

**File:** `src/middleware/rate-limit.ts`

Protects against DoS via excessive session creation:

```typescript
const limiter = createRateLimiter({
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 10,
  keyPrefix: 'session-create',
});
```

**Features:**
- Per-user rate limiting (uses bucketName from auth)
- Falls back to IP if user not authenticated
- Stores counts in Cloudflare KV
- Adds `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers

### 2.10 Structured Logging

**File:** `src/lib/logger.ts`

JSON logging for log aggregation services:

```typescript
const logger = createLogger('session-handler');
logger.info('Session created', { sessionId });
logger.error('Operation failed', error, { containerId });

// Child logger with request context
const reqLogger = logger.child({ requestId: 'req-123' });
```

**Output format:**
```json
{
  "timestamp": "2026-02-04T10:30:00.000Z",
  "level": "info",
  "module": "session-handler",
  "message": "Session created",
  "data": { "sessionId": "abc123" }
}
```

### 2.11 Exponential Backoff

**File:** `src/lib/backoff.ts`

Retry operations with increasing delays:

```typescript
import { withBackoff, MaxRetriesExceededError } from '../lib/backoff';

const result = await withBackoff(
  () => fetchFromExternalApi(),
  {
    initialDelayMs: 100,
    maxDelayMs: 5000,
    factor: 2,
    maxAttempts: 5,
    jitter: true,  // Prevents thundering herd
  }
);
```

### 2.12 Credential Encryption

**File:** `src/lib/crypto.ts`

AES-256-GCM encryption for credentials at rest:

```typescript
import { encrypt, decrypt, importKeyFromBase64 } from '../lib/crypto';

const key = await importKeyFromBase64(env.ENCRYPTION_KEY);
const encrypted = await encrypt(JSON.stringify(credentials), key);
const decrypted = await decrypt(encrypted, key);
```

**Key generation:**
```bash
# Generate a new key (run once)
node -e "import('./src/lib/crypto.js').then(m => m.generateEncryptionKey().then(k => m.exportKeyToBase64(k).then(console.log)))"
# Store as secret
echo "base64-key" | wrangler secret put ENCRYPTION_KEY
```

### 2.13 DEV_MODE Gating

Certain endpoints are restricted to development mode for security:

**Gated Routes:**
- `/api/container/debug/*` - Exposes internal container state
- `/api/credentials/*` - Exposes credential management APIs

**Implementation:**
```typescript
// In routes/container/debug.ts and routes/credentials.ts
app.use('*', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') {
    throw new AuthError('Endpoint only available in DEV_MODE');
  }
  await next();
});
```

**Admin Routes:** Use `ADMIN_SECRET` authentication instead of DEV_MODE, allowing production access with proper authorization.

### 2.14 Session Route Architecture

**Directory:** `src/routes/session/`

Session routes are split into modules for maintainability:

| File | Purpose |
|------|---------|
| `index.ts` | Route aggregator, applies shared auth middleware |
| `crud.ts` | GET/POST/PATCH/DELETE session endpoints |
| `lifecycle.ts` | start/stop/status session endpoints |

**Usage:**
```typescript
// In src/index.ts
import sessionRoutes from './routes/session';
app.route('/api/sessions', sessionRoutes);
```

### 2.15 Frontend Zod Validation

**File:** `web-ui/src/lib/schemas.ts`

The frontend uses Zod schemas to validate API responses at runtime:

```typescript
import { z } from 'zod';

export const SessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastAccessedAt: z.string(),
  status: z.enum(['stopped', 'starting', 'running', 'error']).optional(),
});

export const StartupStatusSchema = z.object({
  stage: z.string(),
  progress: z.number(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

// Export types derived from schemas
export type SessionFromSchema = z.infer<typeof SessionSchema>;
```

**Benefits:**
- Catches backend/frontend type mismatches early
- Provides runtime type safety for API responses
- Self-documenting API contract

### 2.16 Frontend Constants

**File:** `web-ui/src/lib/constants.ts`

Centralized magic numbers for frontend operations:

| Constant | Value | Purpose |
|----------|-------|---------|
| `STARTUP_POLL_INTERVAL_MS` | 1500 | Startup status polling interval |
| `METRICS_POLL_INTERVAL_MS` | 5000 | Running session metrics polling |
| `MAX_CONNECTION_RETRIES` | 45 | Initial WebSocket connection attempts |
| `MAX_RECONNECT_ATTEMPTS` | 5 | Dropped connection recovery attempts |
| `CSS_TRANSITION_DELAY_MS` | 50 | Layout transition settle time |
| `MAX_TERMINALS_PER_SESSION` | 6 | Maximum terminal tabs per session |
| `SESSION_ID_DISPLAY_LENGTH` | 8 | Truncated session ID display |

### 2.17 Terminal Tab Configuration

**File:** `web-ui/src/lib/terminal-config.ts`

Tab configuration extracted for maintainability:

```typescript
export const TERMINAL_TAB_CONFIG: Record<string, { name: string; icon: string }> = {
  '1': { name: 'claude', icon: mdiRobotOutline },
  '2': { name: 'htop', icon: mdiChartLine },
  '3': { name: 'yazi', icon: mdiFolderOutline },
  '4': { name: 'terminal', icon: mdiConsole },
  '5': { name: 'terminal', icon: mdiConsole },
  '6': { name: 'terminal', icon: mdiConsole },
};
```

### 2.18 Container DO (ClaudeflareContainer)

**File:** `src/container/index.ts`

Extends `Container` from `@cloudflare/containers`. Manages container lifecycle and environment.

**Configuration:**
```typescript
defaultPort = 8080;           // Terminal server
sleepAfter = '24h';           // Extended timeout (activity-based hibernation handles actual sleep)
```

**Activity-Based Hibernation:**

The container uses DO alarms for intelligent hibernation instead of relying solely on `sleepAfter`:

1. **Polling mechanism**: DO alarm fires every 5 minutes to check activity
2. **Activity endpoint**: Container exposes `/activity` returning:
   - `hasActiveConnections` - Are WebSocket clients connected?
   - `lastPtyOutputMs` - Time since last PTY output (Claude activity)
   - `lastWsActivityMs` - Time since last WebSocket message
3. **Hibernation criteria**: Container hibernates only when:
   - No active WebSocket connections AND
   - No PTY output for 30 minutes (indicates idle Claude Code)
4. **Alarm cleanup**: `destroy()` override MUST call `this.ctx.storage.deleteAlarm()` to prevent zombie containers

```typescript
// In destroy() override
override async destroy(): Promise<void> {
  await this.ctx.storage.deleteAlarm();  // Critical: prevent alarm restart
  await super.destroy();
}
```

**Environment Variables Injection:**
```typescript
this.envVars = {
  AWS_ACCESS_KEY_ID: accessKeyId,      // For rclone S3 compatibility
  AWS_SECRET_ACCESS_KEY: secretAccessKey,
  R2_ACCESS_KEY_ID: accessKeyId,
  R2_SECRET_ACCESS_KEY: secretAccessKey,
  R2_ACCOUNT_ID: accountId,
  R2_BUCKET_NAME: bucketName,          // Per-user bucket
  R2_ENDPOINT: endpoint,
  TERMINAL_PORT: '3000',
};
```

**Critical: envVars must be set in constructor**, not as a getter. Cloudflare Containers doesn't invoke property getters correctly.

**Internal Endpoints:**
- `/_internal/setBucketName` - Set user's bucket name
- `/_internal/getBucketName` - Get stored bucket name
- `/_internal/debugEnvVars` - Debug environment (masked secrets)

### 2.19 Terminal Server (node-pty)

**File:** `host/server.js`

Node.js server running inside the container. Manages PTY sessions and WebSocket connections.

**Port:**
- 8080: Terminal WebSocket + REST API + Health/metrics endpoints (single port architecture)

**Session Management:**
```javascript
class Session {
  id, name, ptyProcess, clients, buffer, createdAt, lastAccessedAt

  start(cols, rows)     // Spawn PTY process
  attach(ws)            // Connect WebSocket client
  detach(ws)            // Disconnect client
  write(data)           // Input to PTY
  resize(cols, rows)    // Resize PTY
  kill()                // Terminate session
}
```

**Activity Tracking:**

The terminal server tracks activity for hibernation decisions:

```javascript
const activityTracker = {
  lastPtyOutput: Date.now(),
  lastWsActivity: Date.now(),
  activeConnections: 0
};
```

- `lastPtyOutput` updates on every PTY data event (Claude thinking, output, tool results)
- `lastWsActivity` updates on every WebSocket message (user input)
- `activeConnections` increments/decrements on WebSocket connect/disconnect

**Activity Endpoint:**
```
GET /activity
{
  "hasActiveConnections": true,
  "lastPtyOutputMs": 5000,
  "lastWsActivityMs": 12000
}
```

**WebSocket Protocol:**
- Raw terminal data sent directly (NOT JSON-wrapped)
- Control messages (resize, ping) sent as JSON
- Buffer last 10KB for reconnection

**PTY Configuration:**
```javascript
pty.spawn('/bin/bash', ['-l'], {  // Login shell for .bashrc
  name: 'xterm-256color',
  cols, rows,
  cwd: getWorkingDirectory(),
  env: { TERM: 'xterm-256color', COLORTERM: 'truecolor', ... }
});
```

### 2.20 Frontend (SolidJS + xterm.js)

**Directory:** `web-ui/`

SolidJS application with xterm.js terminal emulation.

**Key Files:**
- `src/App.tsx` - Root component, auth handling
- `src/components/Terminal.tsx` - xterm.js integration with terminalId support
- `src/components/TerminalTabs.tsx` - Tab bar for multiple terminals per session
- `src/components/Layout.tsx` - Main layout orchestrating AppSidebar and TerminalArea
- `src/components/AppSidebar.tsx` - Sidebar wrapper (extracted from Layout)
- `src/components/TerminalArea.tsx` - Terminal section wrapper (extracted from Layout)
- `src/components/SessionList.tsx` - Session list with search
- `src/components/SessionCard.tsx` - Individual session card (extracted from SessionList)
- `src/stores/terminal.ts` - WebSocket connection state (compound key: `sessionId:terminalId`)
- `src/stores/session.ts` - Session state including `terminalsPerSession` tracking
- `src/lib/schemas.ts` - Zod validation schemas for API responses
- `src/lib/constants.ts` - Centralized magic numbers (polling intervals, timeouts)
- `src/lib/terminal-config.ts` - Tab configuration (names, icons)

**Terminal Configuration:**
```typescript
const terminal = new XTerm({
  fontFamily: "'JetBrains Mono', 'Fira Code', ...",
  fontSize: 14,
  theme: {
    background: '#1a1a2e',
    foreground: '#e4e4f0',
    cursor: '#d97706',
    // ... full 16-color palette
  },
  scrollback: 10000,
});
```

**Addons:**
- `FitAddon` - Auto-resize to container
- `WebLinksAddon` - Clickable URLs

**Auto-Reconnect:**

The terminal implements automatic reconnection for dropped WebSocket connections:
- 5 reconnection attempts with 2-second delay between attempts
- Exponential backoff could be added for production hardening
- Reconnection triggers session buffer replay for seamless experience

**Character Doubling Fix:**

Critical implementation detail: The `inputDisposable` (xterm input handler) must be stored outside the `connect()` function and disposed before creating a new handler on reconnect. Otherwise, multiple handlers accumulate and each keystroke gets sent multiple times.

```typescript
// Store outside connect() scope
let inputDisposable: IDisposable | null = null;

function connect() {
  // Dispose previous handler before creating new one
  inputDisposable?.dispose();
  inputDisposable = terminal.onData((data) => ws.send(data));
}
```

**Per-Session Modal:**

The initialization progress overlay is scoped per-session, allowing other sessions to remain interactive while one session initializes.

---

## 3. UI Features

### 3.1 WebSocket Status Indicator

The session tab displays a single status circle next to the session name that provides real-time connection feedback.

**Visual States:**

| Color | Animation | Meaning |
|-------|-----------|---------|
| Green | Solid | Connected - WebSocket connection is active |
| Red | Solid | Disconnected/Error - Connection lost or failed |
| Yellow | Pulsing | Connecting - Attempting to establish connection |

**Behavior:**

- **When container is running:** The indicator shows the WebSocket connection state in real-time
- **When container is stopped:** The indicator reflects the overall session state
- **Reconnection:** Click the session tab to trigger a reconnection attempt when disconnected

**Implementation Notes:**

The status indicator is tied to the terminal store's WebSocket state management. The connection state is tracked and propagated to the UI components for consistent visual feedback across the application.

### 3.2 Nested Terminals (Multiple PTYs per Session)

Each session supports up to 4 terminal tabs, allowing users to run multiple tools simultaneously within the same container.

**Use Cases:**
- Tab 1: Claude Code (AI assistant)
- Tab 2: yazi (file manager)
- Tab 3: htop/btop (system monitor)
- Tab 4: lazygit (git UI)

**UI Layout:**
```
+------------------+----------------------------------------------+
|  SIDEBAR         | +------+------+------+------+               |
|                  | |  1   |  2   |  3   |  +   |  Terminal Tabs|
|  * Session 1     | +------+------+------+------+               |
|  * Session 2     |                                              |
|                  |  [Active terminal content]                   |
|  [+ New Session] |                                              |
+------------------+----------------------------------------------+
```

**Technical Implementation:**

1. **Compound Key Strategy:**
   - Frontend state: `sessionId:terminalId` (e.g., `abc123:1`, `abc123:2`)
   - WebSocket URL: `/api/terminal/{sessionId}-{terminalId}/ws`
   - Backend parses compound ID to validate base session

2. **Session Store (`session.ts`):**
   ```typescript
   terminalsPerSession: Record<string, SessionTerminals>

   interface SessionTerminals {
     tabs: TerminalTab[];      // Max 4 tabs
     activeTabId: string;      // Currently visible tab
   }
   ```

3. **Terminal Store (`terminal.ts`):**
   - All Maps use compound keys: `${sessionId}:${terminalId}`
   - `disposeSession(sessionId)` cleans up all terminals for a session

4. **Backend Route (`src/routes/terminal.ts`):**
   ```typescript
   // Parse compound session ID
   const compoundMatch = fullSessionId.match(/^(.+)-([1-4])$/);
   const baseSessionId = compoundMatch ? compoundMatch[1] : fullSessionId;
   const terminalId = compoundMatch ? compoundMatch[2] : '1';

   // Validate BASE session exists, forward full compound ID to container
   ```

5. **Container Terminal Server (`host/server.js`):**
   - No changes needed! SessionManager already handles multiple session IDs
   - Each compound ID (e.g., `abc123-1`) creates a separate PTY

**Tab Behavior:**
- Click `+` to add new terminal (max 4)
- Click `x` to close terminal (can't close last one)
- Click tab to switch active terminal
- Each session remembers its terminals and active tab
- Session stop/delete cleans up all associated terminals

---

## 4. Data Flow

### Session Creation to Terminal Connection

```
1. User opens new tab
   |
2. Frontend: POST /api/sessions { name: "Session 1" }
   |
3. Worker: Generate sessionId, store in KV
   |
4. Frontend: POST /api/container/start?sessionId=xxx
   |
5. Worker:
   a) Create R2 bucket if not exists (Cloudflare API)
   b) Set bucket name in Container DO storage
   c) Call container.start() (non-blocking, waitUntil)
   |
6. Frontend: Poll GET /api/container/startup-status
   |
7. Container startup (entrypoint.sh):
   a) Create rclone config
   b) Step 1: rclone sync R2 -> local (restore data)
   c) Step 2: rclone bisync --resync (establish baseline)
   d) Start bisync daemon (every 60s)
   e) Start terminal server (port 8080)
   f) Start health server (port 3000)
   |
8. startup-status returns "ready" when terminal server /sessions responds
   |
9. Frontend: WebSocket connect /api/terminal/{sessionId}/ws
   |
10. Worker: Forward WebSocket to container port 8080
   |
11. Terminal server: Create PTY session, attach WebSocket
   |
12. PTY spawns bash -l, .bashrc runs Claude auto-start
```

### Startup Status Stages

| Stage | Progress | Condition |
|-------|----------|-----------|
| stopped | 0% | Container not running |
| starting | 10-20% | Container state = running but health server not responding |
| syncing | 30-45% | Health server up, syncStatus = pending/syncing |
| mounting | 65-70% | Sync complete, terminal server starting |
| verifying | 85% | Terminal server up, checking /sessions |
| ready | 100% | All checks passed |
| error | 0% | Sync failed or other error |

---

## 5. Storage and Sync

### Why rclone bisync (Not s3fs)

**s3fs FUSE Approach (v3 - Abandoned):**
- Every file operation = network call to R2
- PUT latency ~340ms P90, HEAD ~50ms
- FUSE mounts fragile on network hiccups
- "Socket not connected" errors common
- Cache invalidation unreliable

**rclone bisync Approach (v4 - Current):**
- All file operations on local disk (<1ms)
- Background sync every 60s
- Stable, no mount issues
- Simple conflict resolution

### Two-Step Initial Sync

**Why needed:** A fresh container has empty `/home/user`. Running `bisync --resync` on empty local would DELETE all R2 data (bisync thinks local deletions should propagate).

**Solution:**
```bash
# Step 1: One-way R2 -> local (restore user's data)
rclone sync "r2:$BUCKET/" "$HOME/" --exclude ...

# Step 2: Establish bisync baseline
rclone bisync "$HOME/" "r2:$BUCKET/" --resync --conflict-resolve newer
```

### What's Synced vs Excluded

| Path | Synced | Reason |
|------|--------|--------|
| `~/.claude/` | Yes | Claude credentials, config, projects |
| `~/.config/` | Yes | App configs (gh CLI, etc.) |
| `~/.gitconfig` | Yes | Git configuration |
| `~/workspace/` | Yes | User project files persist across sessions |
| `~/.npm/` | **NO** | Cache, can be regenerated |
| `~/.config/rclone/**` | **NO** | Rclone's own config/cache |
| `~/.cache/rclone/**` | **NO** | Rclone cache files |

### rclone bisync Configuration

```bash
rclone bisync "$USER_HOME/" "r2:$R2_BUCKET_NAME/" \
    --config "$RCLONE_CONFIG" \
    --exclude ".config/rclone/**" \
    --exclude ".cache/rclone/**" \
    --exclude ".npm/**" \
    --conflict-resolve newer \
    --resilient \
    --recover \
    -v
```

**Flags Explained:**
- `--conflict-resolve newer` - Newest file wins on conflicts
- `--resilient` - Continue on errors
- `--recover` - Attempt recovery from failed syncs
- Auto `--resync` on bisync failure (handles empty listing errors)

### Conflict Resolution

- **Strategy:** Newest file wins based on modification timestamp
- **Fallback:** On bisync failure, automatic `--resync` re-establishes baseline
- **Shutdown:** Final sync on SIGTERM ensures data persistence

### Sync Daemon

```bash
while true; do
    sleep 60
    bisync_with_r2
done &
```

Runs continuously in background. On failure, retries next interval.

---

## 6. Authentication

### Cloudflare Access Integration

Two authentication methods supported:

**1. Browser/JWT Authentication:**
```
cf-access-authenticated-user-email: user@example.com
cf-access-jwt-assertion: <JWT>
```
Set by Cloudflare Access after successful login.

**2. Service Token Authentication:**
```
CF-Access-Client-Id: <token-id>
CF-Access-Client-Secret: <token-secret>
```
For API/CLI clients. Mapped to email via `SERVICE_TOKEN_EMAIL` env var.

### Auth Flow with Middleware

```
Request
   |
   v
CORS Middleware (src/index.ts)
   |
   v
Auth Middleware (src/middleware/auth.ts)
   |
   +-- getUserFromRequest() checks headers
   |   |
   |   +-- cf-access-authenticated-user-email? -> Browser auth
   |   +-- cf-access-client-id? -> Service token auth
   |   +-- DEV_MODE=true? -> Test user bypass
   |   +-- None -> 401 Unauthorized
   |
   +-- getBucketName() derives bucket from email
   |
   +-- Sets c.get('user') and c.get('bucketName')
   |
   v
Route Handler
```

### Per-User Bucket Naming

```typescript
function getBucketName(email: string): string {
  // user@example.com -> claudeflare-user-example-com
  const sanitized = email
    .toLowerCase()
    .replace(/@/g, '-')
    .replace(/\./g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 63 - 'claudeflare-'.length);
  return `claudeflare-${sanitized}`;
}
```

### Bucket Auto-Creation

**File:** `src/lib/r2-admin.ts`

Buckets created via Cloudflare API on first container start:
```typescript
await createBucketIfNotExists(accountId, apiToken, bucketName);
```

---

## 7. API Reference

### Common Response Headers

All API responses include these headers:

| Header | Description |
|--------|-------------|
| `X-Request-ID` | Unique request identifier for tracing (UUID) |
| `X-RateLimit-Limit` | Maximum requests allowed per window (rate-limited endpoints) |
| `X-RateLimit-Remaining` | Requests remaining in current window (rate-limited endpoints) |

### Error Response Format

All errors use a consistent JSON format:

```json
{
  "error": "User-friendly error message",
  "code": "ERROR_CODE"
}
```

Error codes:
- `NOT_FOUND` - Resource not found (404)
- `VALIDATION_ERROR` - Invalid input (400)
- `CONTAINER_ERROR` - Container operation failed (500)
- `AUTH_ERROR` - Authentication required (401)

### Container Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/container/start` | Start container (non-blocking) |
| POST | `/api/container/destroy` | Destroy container (SIGKILL) |
| GET | `/api/container/state` | Get container state |
| GET | `/api/container/health` | Check container health |
| GET | `/api/container/startup-status` | Poll startup progress |
| GET | `/api/container/sync-log` | Get rclone sync log |
| GET | `/api/container/debug` | Debug info (bucket, envVars) |

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/destroy-by-id` | Kill zombie container by raw DO ID |

**Admin Endpoint Parameters:**
- `secret` - Must match `ADMIN_SECRET` environment variable (query param or Bearer token)
- Body: `{ "doId": "<64-char-hex-do-id>" }`

**Use case:** When a container becomes a zombie (alarm keeps restarting it), use this endpoint to forcibly destroy it by its DO ID visible in the Cloudflare dashboard.

**REMOVED ENDPOINTS (were creating zombies instead of destroying them):**
- ~~`/api/admin/nuke-all`~~ - Used `idFromName()` which CREATES DOs
- ~~`/api/admin/destroy-by-name`~~ - Used `idFromName()` which CREATES DOs
- ~~`/api/container/nuke-all`~~ - Same issue
- ~~`/api/container/destroy-by-name`~~ - Same issue

**CRITICAL:** Only `destroy-by-id` uses `idFromString()` which safely references EXISTING DOs. All `idFromName()` approaches CREATE new DOs if they don't exist - this is fundamental to how Cloudflare Durable Objects work.

### Session Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Create session |
| DELETE | `/api/sessions/:id` | Delete session |

### Terminal Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| WS | `/api/terminal/:sessionId/ws` | WebSocket terminal connection |
| WS | `/api/terminal/:sessionId-:terminalId/ws` | WebSocket for specific terminal tab |

### User Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user` | Get authenticated user info |

### Setup Endpoints (No Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/setup/status` | Check if setup is complete |
| POST | `/api/setup/verify-token` | Verify token permissions |
| POST | `/api/setup/configure` | Run full configuration |
| POST | `/api/setup/reset` | Reset setup state (requires ADMIN_SECRET) |

### Examples

**Start Container:**
```bash
curl -X POST https://claudeflare.your-subdomain.workers.dev/api/container/start \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>"
```

**Poll Startup Status:**
```bash
curl https://claudeflare.your-subdomain.workers.dev/api/container/startup-status?sessionId=abc12345 \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>"
```

**Response:**
```json
{
  "stage": "ready",
  "progress": 100,
  "message": "Container ready (workspace synced)",
  "details": {
    "bucketName": "claudeflare-user-example-com",
    "container": "container-claudeflare-user-example-com-abc12345",
    "path": "/home/user/workspace",
    "email": "user@example.com"
  }
}
```

---

## 8. Environment Variables

### Worker Environment

| Variable | Purpose | Source |
|----------|---------|--------|
| `DEV_MODE` | "true" bypasses CF Access auth | wrangler.toml |
| `SERVICE_TOKEN_EMAIL` | Email for service token auth | wrangler.toml |
| `CLOUDFLARE_API_TOKEN` | R2 bucket creation | Wrangler secret |
| `R2_ACCESS_KEY_ID` | R2 auth for containers | Wrangler secret |
| `R2_SECRET_ACCESS_KEY` | R2 auth for containers | Wrangler secret |
| `R2_ACCOUNT_ID` | R2 endpoint construction | wrangler.toml |
| `R2_ENDPOINT` | S3-compatible endpoint | wrangler.toml |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated patterns) | wrangler.toml |
| `ADMIN_SECRET` | Admin endpoint authentication | Wrangler secret |

### Container Environment

| Variable | Purpose |
|----------|---------|
| `R2_BUCKET_NAME` | User's personal bucket |
| `R2_ACCESS_KEY_ID` | rclone auth |
| `R2_SECRET_ACCESS_KEY` | rclone auth |
| `R2_ACCOUNT_ID` | rclone endpoint |
| `R2_ENDPOINT` | rclone endpoint |
| `AWS_ACCESS_KEY_ID` | S3 compatibility |
| `AWS_SECRET_ACCESS_KEY` | S3 compatibility |
| `TERMINAL_PORT` | Always 3000 |

---

## 9. File Structure

```
claudeflare/
|
+-- src/
|   +-- index.ts              # Hono router, WebSocket intercept, CORS middleware
|   +-- types.ts              # TypeScript types (Env, AccessUser, Session, etc.)
|   +-- routes/
|   |   +-- container/        # Container lifecycle API (split for maintainability)
|   |   |   +-- index.ts      # Route aggregator (exports merged Hono app)
|   |   |   +-- lifecycle.ts  # Start, destroy, stop endpoints
|   |   |   +-- status.ts     # Health, state, startup-status, sync-log endpoints
|   |   |   +-- debug.ts      # Debug endpoints (DEV_MODE gated)
|   |   |   +-- shared.ts     # Shared types and container circuit breaker
|   |   +-- session/          # Session API (split for maintainability)
|   |   |   +-- index.ts      # Route aggregator with shared auth middleware
|   |   |   +-- crud.ts       # GET/POST/PATCH/DELETE session endpoints
|   |   |   +-- lifecycle.ts  # start/stop/status session endpoints
|   |   +-- admin.ts          # Admin-only endpoints (destroy-by-id)
|   |   +-- terminal.ts       # WebSocket terminal proxy
|   |   +-- user.ts           # User info
|   |   +-- credentials.ts    # Credential management (DEV_MODE gated)
|   |   +-- setup.ts          # Setup wizard API
|   +-- middleware/
|   |   +-- auth.ts           # Shared auth middleware (authMiddleware)
|   +-- lib/
|   |   +-- access.ts         # CF Access auth helpers
|   |   +-- r2-admin.ts       # R2 bucket API
|   |   +-- kv-keys.ts        # KV key utilities
|   |   +-- constants.ts      # Centralized constants (ports, patterns, R2 IDs)
|   |   +-- container-helpers.ts  # Container initialization helpers
|   |   +-- errors.ts         # Standardized error responses
|   |   +-- error-types.ts    # Centralized error classes (AppError hierarchy)
|   |   +-- type-guards.ts    # Runtime type validation
|   |   +-- circuit-breaker.ts  # Circuit breaker pattern for resilience
|   |   +-- logger.ts         # Structured JSON logging
|   |   +-- backoff.ts        # Exponential backoff with jitter
|   +-- container/
|   |   +-- index.ts          # ClaudeflareContainer DO class
|   +-- __tests__/
|       +-- lib/              # Unit tests for lib modules
|       +-- routes/           # Unit tests for route handlers
|
+-- e2e/
|   +-- setup.ts              # E2E test setup
|   +-- api.test.ts           # E2E API tests
|
+-- host/
|   +-- server.js             # Terminal server (node-pty + WebSocket)
|   +-- package.json          # Terminal server deps
|
+-- web-ui/
|   +-- src/
|   |   +-- App.tsx           # Root component
|   |   +-- components/
|   |   |   +-- Terminal.tsx     # xterm.js wrapper
|   |   |   +-- TerminalTabs.tsx # Tab bar UI
|   |   |   +-- Layout.tsx       # Main layout
|   |   |   +-- AppSidebar.tsx   # Sidebar wrapper (extracted from Layout)
|   |   |   +-- TerminalArea.tsx # Terminal section wrapper (extracted from Layout)
|   |   |   +-- SessionList.tsx  # Session list with search
|   |   |   +-- SessionCard.tsx  # Individual session card (extracted)
|   |   +-- stores/
|   |   |   +-- terminal.ts   # WebSocket state
|   |   |   +-- session.ts    # Session state
|   |   |   +-- setup.ts      # Setup wizard state
|   |   +-- api/
|   |   |   +-- client.ts     # API client
|   |   +-- lib/
|   |   |   +-- constants.ts      # Frontend constants (intervals, timeouts)
|   |   |   +-- schemas.ts        # Zod validation schemas
|   |   |   +-- terminal-config.ts # Tab configuration (names, icons)
|   |   +-- styles/
|   |       +-- session-list.css   # Session list styles
|   |       +-- init-progress.css  # Init progress modal styles
|   |       +-- settings-panel.css # Settings panel styles
|   +-- dist/                 # Built frontend (static assets)
|
+-- Dockerfile                # Container image
+-- entrypoint.sh             # Container startup script
+-- wrangler.toml             # Cloudflare configuration
+-- vitest.config.ts          # Unit test config
+-- vitest.e2e.config.ts      # E2E test config
+-- CLAUDE.md                 # Project context for Claude
+-- docs/
    +-- STORAGE-EVOLUTION.md  # Storage architecture history
```

### Critical Paths Inside Container

| Path | Purpose |
|------|---------|
| `/home/user` | User home directory |
| `/home/user/workspace` | Working directory (synced to R2) |
| `/home/user/.claude/` | Claude config and credentials |
| `/home/user/.config/rclone/rclone.conf` | rclone configuration |
| `/tmp/sync-status.json` | Sync daemon status |
| `/tmp/sync.log` | Sync log for debugging |
| `/tmp/.bisync-initialized` | Marker for baseline established |

---

## 10. Container Startup - Pure Polling Approach

**File:** `entrypoint.sh`

The container startup script uses **pure polling with no arbitrary timeouts**. This is critical for reliable startup.

### Why No Static Timeouts?

**Problems with static timeouts:**
- If npm install takes 5 seconds but timeout is 60s → 55 seconds wasted
- If npm install takes 90 seconds but timeout is 60s → premature failure
- Network conditions vary → fixed timeouts are wrong in both directions

**Pure polling approach:**
- Poll until success OR the background process exits
- Exit immediately on success (no waiting)
- No upper limit on wait time (if process is still running, keep waiting)

### preseed_claude_yolo() Implementation

```bash
# Phase 1: Wait for npm install (version update)
while kill -0 $PRESEED_PID 2>/dev/null; do  # Process still alive?
    UPDATED=$(grep -oP ... "$PACKAGE_JSON")
    if [ "$UPDATED" = "$LATEST_NPM" ]; then
        break  # SUCCESS! Exit immediately
    fi
    sleep 1
done

# Phase 2: Wait for consent files
while kill -0 $PRESEED_PID 2>/dev/null; do  # Process still alive?
    if [ -f ".claude-yolo-consent" ] && [ -f "cli-yolo.mjs" ]; then
        break  # SUCCESS! Exit immediately
    fi
    sleep 1
done
```

**Key pattern:** `kill -0 $PID` returns success if process is running, failure if it exited.

| Scenario | Old (60s timeout) | New (pure polling) |
|----------|-------------------|-------------------|
| npm install takes 5s | Waits 60s anyway | Exits after 5s ✓ |
| npm install takes 90s | Fails at 60s ✗ | Waits 90s, succeeds ✓ |
| claude-yolo crashes | Waits 60s anyway | Detects immediately ✓ |

### Parallel Startup

The entrypoint runs R2 sync and claude-yolo pre-seeding in parallel:

```
Container Start
├── preseed_claude_yolo() &     ← Background process #1
├── initial_sync_from_r2() &    ← Background process #2
├── wait for R2 sync            ← Block until data restored
├── establish_bisync_baseline() &   ← Background (non-blocking)
├── configure_claude_autostart()
├── wait $PRESEED_PID           ← Block until consent complete
└── Start servers (ports 8080, 3000)
```

This means:
1. R2 sync and claude-yolo run simultaneously (saves time)
2. Servers start only after BOTH complete (correct ordering)
3. No fixed timeouts anywhere (pure polling throughout)

---

## 11. Container Image

**File:** `Dockerfile`

Base: `node:22-alpine`

### Installed Tools

| Category | Packages |
|----------|----------|
| Sync | rclone |
| Version Control | git, github-cli (gh), lazygit |
| Editors | vim, neovim, nano |
| Network | curl, wget, openssh-client |
| Build | make, gcc, g++, python3, nodejs, npm |
| Utilities | jq, ripgrep, fd, tree, btop, htop, tmux, yazi |
| Terminal | ncurses, ncurses-terminfo |

### Global NPM Packages

- `@anthropic-ai/claude-code` - Claude Code CLI

### Build Process

```dockerfile
# Install system packages
RUN apk add --no-cache rclone git vim ... \
    && apk add --no-cache yazi --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing \
    && apk add --no-cache lazygit --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Copy and install terminal server
COPY host/package.json host/server.js /app/host/
RUN cd /app/host && npm install --production

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

### Ports

- 8080: Terminal server (WebSocket + REST + Health/metrics) - single port architecture

---

## 12. Claude-YOLO Integration

Claudeflare uses [claude-yolo](https://github.com/maxparez/claude-yolo) to enable `--dangerously-skip-permissions` when running as root inside containers.

### Why Claude-YOLO?

Standard Claude Code CLI prevents combining:
- `--dangerously-skip-permissions` flag (skips permission prompts)
- Running as root user (detected via `process.getuid() === 0`)

Since Cloudflare Containers run as root, the standard Claude CLI would reject YOLO mode. Claude-yolo wraps the official CLI and bypasses these restrictions by patching runtime checks.

### How It Works

1. **Runtime patching:**
   - Replaces `process.getuid() === 0` checks with `false`
   - Replaces `getIsDocker()` calls with `true`
   - Auto-adds `--dangerously-skip-permissions` to all invocations

2. **Consent management:**
   - First run requires interactive consent prompt
   - Creates `.claude-yolo-consent` file to remember consent
   - State stored in `~/.claude_yolo_state`

3. **Auto-updating:**
   - Checks for and installs latest Claude CLI version on startup

### Container Configuration

**Dockerfile installs claude-yolo:**
```dockerfile
RUN npm install -g claude-yolo
```

**Consent pre-configuration (Dockerfile):**
```dockerfile
RUN CLAUDE_CODE_DIR=$(npm root -g)/claude-yolo/node_modules/@anthropic-ai/claude-code && \
    echo "consent-given" > "$CLAUDE_CODE_DIR/.claude-yolo-consent"
```

**Wrapper script for transparent usage:**
```dockerfile
RUN echo '#!/bin/bash' > /usr/local/bin/claude && \
    echo 'export IS_SANDBOX=1' >> /usr/local/bin/claude && \
    echo 'export DISABLE_INSTALLATION_CHECKS=1' >> /usr/local/bin/claude && \
    echo 'exec /usr/local/bin/claude-yolo "$@"' >> /usr/local/bin/claude && \
    chmod +x /usr/local/bin/claude
```

### Entrypoint Pre-seeding

The `preseed_claude_yolo()` function in `entrypoint.sh` handles automatic consent and updates:

```bash
# Run claude-yolo with "yes" piped to auto-answer consent prompt
echo "yes" | claude-yolo &
PRESEED_PID=$!

# Poll until consent files appear OR process exits
while kill -0 $PRESEED_PID 2>/dev/null; do
    if [ -f ".claude-yolo-consent" ] && [ -f "cli-yolo.mjs" ]; then
        kill $PRESEED_PID 2>/dev/null
        break
    fi
    sleep 1
done
```

This runs during container init (before terminal opens), so users never see consent prompts.

### Environment Variables

| Variable | Purpose | Value |
|----------|---------|-------|
| `IS_SANDBOX` | Tells claude-yolo this is a sandbox environment | `1` |
| `DISABLE_INSTALLATION_CHECKS` | Skips PATH checks that fail in sudo/root contexts | `1` |
| `DEBUG` | Enable verbose debug output from claude-yolo | `1` (optional) |

### Security Considerations

**Acceptable trade-offs for Claudeflare:**
- Containers are isolated and ephemeral
- Each user has their own container
- Container destruction cleans up all state
- Users explicitly chose to use this service

**What YOLO mode bypasses:**
- File read/write permission prompts
- Shell command execution prompts
- Network access prompts

### Troubleshooting

**claude-yolo not found:**
```bash
npm list -g claude-yolo
ls -la $(npm root -g)/claude-yolo
```

**Consent file missing:**
```bash
CLAUDE_CODE_DIR=$(npm root -g)/claude-yolo/node_modules/@anthropic-ai/claude-code
ls -la "$CLAUDE_CODE_DIR/.claude-yolo-consent"
```

**YOLO mode not activating:**
```bash
cat ~/.claude_yolo_state
# Should output: YOLO
```

---

## 13. Testing

### Unit Tests

**Configuration:** `vitest.config.ts`

Uses `@cloudflare/vitest-pool-workers` for testing Worker code.

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

**Test Files:** `src/__tests__/lib/`
- `constants.test.ts` - Port and pattern validation
- `container-helpers.test.ts` - Container ID generation
- `type-guards.test.ts` - Runtime type validation

**Run:** `npm test`

### E2E Tests

**Configuration:** `vitest.e2e.config.ts`

```typescript
export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

**Test Files:** `e2e/`
- `setup.ts` - Base URL and API request helper
- `api.test.ts` - API endpoint tests

**Run:** `npm run test:e2e`

**Environment:** Tests run against the deployed worker. Set `E2E_BASE_URL` to override.

---

## 14. Troubleshooting

### Bisync Empty Listing Error

**Symptom:** Bisync fails with "empty directory listing" error.

**Cause:** R2 bucket or local directory returns empty listing on fresh start.

**Fix:** Automatic fallback to `--resync` on bisync failure (implemented in entrypoint.sh).

### envVars Getter Not Working

**Symptom:** Container starts without R2 credentials.

**Cause:** Cloudflare Containers doesn't invoke property getters on DO class.

**Fix:** Set `envVars` directly in constructor after `super()`, not as getter.

```typescript
// WRONG
get envVars() { return { ... }; }

// CORRECT
constructor(ctx, env) {
  super(ctx, env);
  this.envVars = { ... };  // Set after super()
}
```

### Container Stuck at "Waiting for Services"

**Symptom:** Startup progress stuck at 20%.

**Cause:** Terminal server (port 8080) not starting, usually sync blocking.

**Diagnosis:**
```bash
curl /api/container/sync-log?sessionId=xxx
```

**Common Issues:**
- Missing R2 credentials
- Bucket doesn't exist
- Network timeout to R2

### Slow Sync Despite Workspace Exclusion

**Symptom:** Container startup slow even with workspace excluded.

**Cause:** Workspace data already exists in R2 from before exclusions were added. `--exclude` prevents new uploads but doesn't delete existing data.

**Fix:** Manually delete from R2:
```bash
rclone delete r2:claudeflare-<user-bucket>/workspace/ -v
rclone delete r2:claudeflare-<user-bucket>/.npm/ -v
```

### WebSocket Connection Failures

**Symptom:** Terminal never connects, WebSocket errors.

**Diagnosis:**
1. Check container state: `GET /api/container/state`
2. Check terminal server health: `GET /api/container/health`
3. Look for startup errors in sync log

**Common Causes:**
- Container not fully started (poll startup-status first)
- Session doesn't exist in KV
- Authentication failed

### Port Routing Issues

**Symptom:** Requests go to wrong port (e.g., health check goes to terminal server).

**Fix:** Use `switchPort()` from `@cloudflare/containers`:
```typescript
import { switchPort } from '@cloudflare/containers';

const request = switchPort(
  new Request('http://container/health'),
  3000  // Target port
);
```

### Zombie Container (DO Alarm Loop)

**Symptom:** Container keeps restarting after destroy. Dashboard shows DO alarm scheduled.

**Cause:** `destroy()` override doesn't clear the DO alarm. Alarm fires, calls `alarm()` method, which restarts the container.

**Fix:** Always clear alarm in destroy():
```typescript
override async destroy(): Promise<void> {
  await this.ctx.storage.deleteAlarm();  // Must be BEFORE super.destroy()
  await super.destroy();
}
```

**Recovery:** Use admin endpoint to kill zombie:
```bash
curl -X POST "/api/admin/destroy-by-id" \
  -H "Authorization: Bearer ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"doId":"<DO_ID_FROM_DASHBOARD>"}'
```

### Character Doubling in Terminal

**Symptom:** Each keystroke appears twice in the terminal.

**Cause:** Multiple `terminal.onData()` handlers registered due to reconnection without disposing the previous handler.

**Fix:** Store disposable outside `connect()` scope and dispose before creating new handler:
```typescript
let inputDisposable: IDisposable | null = null;

function connect() {
  inputDisposable?.dispose();  // Clean up previous
  inputDisposable = terminal.onData((data) => ws.send(data));
}
```

### Secrets Lost After Worker Deletion

**Symptom:** After running `wrangler delete`, worker redeploys with missing secrets (R2 credentials, admin secret, etc.).

**Cause:** `wrangler delete` nukes the entire worker including all stored secrets. They are NOT restored on redeployment.

**Fix:** Re-set all secrets after redeployment:
```bash
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put ADMIN_SECRET
```

Verify with:
```bash
wrangler secret list
```

### Orphan/Zombie Container Root Cause

**Symptom:** Zombie containers that keep restarting even after calling `destroy()`.

**Root Cause:** The `getContainerId()` function must NEVER have a fallback pattern. Always throw on invalid input.

```typescript
// DANGEROUS - this creates orphan containers!
function getContainerId(bucketName: string, sessionId: string | null): string {
  if (sessionId && /^[a-z0-9]{8,24}$/.test(sessionId)) {
    return `${bucketName}-${sessionId}`;
  }
  return bucketName;  // <-- THIS LINE CREATES ORPHANS
}

// CORRECT - always require valid sessionId
function getContainerId(bucketName: string, sessionId: string): string {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}`);
  }
  return `${bucketName}-${sessionId}`;
}
```

**Prevention:** Container ID format is ALWAYS `${bucketName}-${sessionId}`. Never allow fallbacks or alternate patterns.

---

## 15. Debugging Guide

### Container Status via API

**Check if container is running:**
```bash
curl -H "CF-Access-Client-Id: <id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://claudeflare.your-subdomain.workers.dev/api/container/state?sessionId=abc12345
```

**Response:**
```json
{
  "state": "running",
  "startTime": 1234567890,
  "stopTime": null
}
```

**Check container health:**
```bash
curl -H "CF-Access-Client-Id: <id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://claudeflare.your-subdomain.workers.dev/api/container/health?sessionId=abc12345
```

**Response:**
```json
{
  "healthy": true,
  "terminalServer": "ok",
  "healthServer": "ok",
  "lastCheck": "2026-02-02T10:30:00Z"
}
```

### Verify Secrets Are Set

After deployment, verify all secrets are accessible:

```bash
# List all secrets
wrangler secret list

# Expected output should include:
# CLOUDFLARE_API_TOKEN
# R2_ACCESS_KEY_ID
# R2_SECRET_ACCESS_KEY
# ADMIN_SECRET
```

**If missing after `wrangler delete`:**
```bash
wrangler secret put CLOUDFLARE_API_TOKEN
# Paste your Cloudflare API token

wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put ADMIN_SECRET
```

### Monitor with wrangler tail

**Real-time worker logs:**
```bash
wrangler tail --service claudeflare
```

**Filter by level:**
```bash
wrangler tail --service claudeflare --level error
wrangler tail --service claudeflare --level warn
```

**Search for specific session:**
```bash
wrangler tail --service claudeflare | grep abc12345
```

### Common Failure Modes and Fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Container won't start, sync fails | Missing R2 credentials in worker secrets | Run `wrangler secret list` to verify, then `wrangler secret put` |
| `403 Forbidden` on R2 operations | Expired/wrong R2 credentials | Check Cloudflare dashboard, regenerate credentials, update secrets |
| Container stuck at "starting" | Terminal server (port 8080) not responding | Check sync status with `/api/container/sync-log?sessionId=xxx` |
| WebSocket connection fails | Container not running or wrong sessionId | Verify `?sessionId=` matches actual 24-char ID, not browser session |
| Zombie container keeps restarting | DO alarm not cleared in `destroy()` | Use admin endpoint: `/api/admin/destroy-by-id` |
| Character doubling in terminal | inputDisposable not disposed on reconnect | Check Terminal.tsx, ensure disposal before creating new handler |
| Slow sync after deletion | Old workspace/cache data still in R2 | Manually delete: `rclone delete r2:bucket/workspace/ -v` |

### Debug Environment Variables

**Check what the container receives:**
```bash
curl -H "CF-Access-Client-Id: <id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://claudeflare.your-subdomain.workers.dev/api/container/debug?sessionId=abc12345
```

**Response (masked for security):**
```json
{
  "bucketName": "claudeflare-user-example-com",
  "envVars": {
    "R2_BUCKET_NAME": "claudeflare-user-example-com",
    "R2_ENDPOINT": "https://account-id.r2.cloudflarestorage.com",
    "R2_ACCESS_KEY_ID": "***masked***",
    "R2_SECRET_ACCESS_KEY": "***masked***",
    "AWS_ACCESS_KEY_ID": "***masked***",
    "AWS_SECRET_ACCESS_KEY": "***masked***"
  }
}
```

### Sync Log Inspection

**Get sync status and log:**
```bash
curl -H "CF-Access-Client-Id: <id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://claudeflare.your-subdomain.workers.dev/api/container/sync-log?sessionId=abc12345
```

**Response:**
```json
{
  "status": "synced",
  "lastSync": "2026-02-02T10:25:00Z",
  "nextSync": "2026-02-02T10:26:00Z",
  "log": [
    "[2026-02-02 10:20:00] Starting R2 -> local sync",
    "[2026-02-02 10:20:30] Sync complete: 1205 files, 450MB",
    "[2026-02-02 10:20:35] Establishing bisync baseline",
    "[2026-02-02 10:20:45] Baseline established"
  ]
}
```

---

## 16. Cost

### Per-Container Pricing

| Resource | Tier | Specs | Monthly Cost |
|----------|------|-------|--------------|
| Container | Basic | 0.25 vCPU, 1GB RAM, 4GB disk | ~$14 |

### Scaling Model

- **Cost scales per ACTIVE SESSION** - each browser tab = dedicated container
- **Idle containers hibernate** after 30 minutes (configurable via `sleepAfter`)
- **Hibernated containers** don't incur CPU costs, only storage

### Example Monthly Costs

| Usage | Containers | Estimated Cost |
|-------|------------|----------------|
| Single session | 1 | ~$14 |
| 3 concurrent sessions | 3 | ~$42 |
| 10 concurrent sessions | 10 | ~$140 |

### R2 Storage

- First 10GB free per month
- $0.015/GB/month after that
- User config typically <100MB per bucket

---

## 17. Lessons Learned

1. **rclone bisync > s3fs FUSE** - FUSE mounts are fragile and slow. Periodic bisync with local disk is faster and more reliable.

2. **Newest file wins** - Simple conflict resolution that works well for single-user scenarios.

3. **Auto-resync on failure** - Bisync can fail for many reasons. Automatic `--resync` recovery handles most cases.

4. **envVars in constructor** - Container class reads envVars as property, not getter. Set in constructor.

5. **switchPort() for non-default ports** - Must use `switchPort()` when routing to container ports other than defaultPort.

6. **WebSocket sends RAW bytes** - xterm.js expects raw terminal data, not JSON-wrapped messages.

7. **Login shell for .bashrc** - PTY must spawn `bash -l` for .bashrc to execute and auto-start Claude.

8. **Two-step sync prevents data loss** - Empty local directory + bisync resync = deleted R2 data. Always restore first.

9. **DO alarm cleanup in destroy()** - Alarms persist across hibernation. If destroy() doesn't clear the alarm, it fires and restarts the container.

10. **Activity-based hibernation** - Don't rely on `sleepAfter` alone. Poll container activity and hibernate based on actual usage (no connections + no PTY output).

11. **Don't getState() after destroy()** - Calling `getState()` wakes up the Durable Object, undoing the hibernation. Check state before destroy, not after.

12. **inputDisposable scope matters** - Terminal input handlers must be disposed on reconnect. Store disposable outside connect() function to prevent character doubling.

13. **Auto-reconnect with cleanup** - WebSocket reconnection must dispose previous handlers first. 5 attempts with 2s delay is a reasonable default.

14. **No fallback container IDs** - The `getContainerId()` function must NEVER fallback to just `bucketName` when `sessionId` is missing. This was the root cause of zombie containers. Always throw an error instead.

15. **Secrets persist with worker state** - When using `wrangler delete`, all secrets are destroyed along with the worker. They must be re-set after redeployment with `wrangler secret put`.

16. **credentials.ts must validate sessionId** - The credentials route must never create containers without a valid sessionId. Always use the full `${bucketName}-${sessionId}` pattern.

17. **Extract shared middleware** - Auth logic should be centralized in `src/middleware/auth.ts` rather than duplicated across routes.

18. **Use type guards for runtime validation** - Replace unsafe type casts with proper type guards from `src/lib/type-guards.ts`.

19. **Centralize constants** - Configuration values like ports, patterns, and timeouts should be in `src/lib/constants.ts` for single-source-of-truth.

20. **Configurable CORS** - Allow CORS origins to be configured via environment variable (`ALLOWED_ORIGINS`) rather than hardcoding domains.

21. **Pure polling over static timeouts** - Never use fixed timeouts (e.g., `while [ $WAITED -lt 60 ]`) for process synchronization. Instead, poll with `kill -0 $PID` to check if process is still running, and exit immediately on success. This handles both fast and slow scenarios correctly.

22. **Zombie prevention with _destroyed flag** - In Cloudflare Durable Objects, calling ANY method (including `getState()`) wakes up a hibernated DO. When `destroy()` is called, a pre-scheduled alarm may still fire and resurrect the zombie. The fix: (1) set a `_destroyed` flag in DO storage BEFORE calling `super.destroy()`, (2) in `alarm()`, check the flag FIRST using only `ctx.storage.get()` (which doesn't wake the DO), and (3) if destroyed, clear all storage and exit without calling Container methods.

23. **Kill early health server before full health server** - The entrypoint.sh starts two health servers sequentially: an early one (minimal, for startup diagnostics) and a full one (with cpu/mem/hdd metrics). Both listen on port 3000. If the early server isn't killed before the full server starts, the early server holds the port and metrics are never returned.

24. **idFromName() CREATES DOs, idFromString() references existing** - Cloudflare Durable Objects are "Virtual Actors" that always exist conceptually. Calling `idFromName(name)` + `get()` + ANY method (fetch, destroy, getState) **CREATES** a new DO if it doesn't exist. The ONLY safe way to reference an existing DO without creating it is via `idFromString(hexId)` with a known 64-character hex ID. Admin endpoints that tried to "nuke" containers by name were actually CREATING zombies because they used `idFromName()`. The only way to truly DELETE DOs is to delete the entire class via migration (`deleted_classes` in wrangler.toml).

25. **CPU metrics show load average, not utilization** - The session card CPU% uses `os.loadavg()[0] / cpus * 100` which measures run queue depth (processes waiting), NOT actual CPU utilization. Values >100% are normal when processes are queueing for CPU time. htop shows actual CPU utilization which will typically be lower.

---

## Session Card Enhancements

### LIVE Badge
- Positioned at right edge of card header using flexbox `justify-content: space-between`
- Includes shimmer animation (2s infinite) for visual prominence
- Status dot with pulse animation for running sessions

### Slide-in Action Buttons
- Stop/Delete buttons positioned **outside** the session card
- Hidden by default (`translateX(100%)`, `opacity: 0`)
- Slide in from right on card hover (200ms transition)
- Stacked vertically, centered on card height
- DOM structure: `.session-card-wrapper` contains sibling `.session-card` and `.session-card-actions-overlay`
- **Always visible**: Delete button shows for ALL session statuses (including initializing)
- **Stop during init**: Stop button visible during initialization to cancel stuck startups

### Developer Metrics Section
Displayed for running sessions only. Shows:
| Metric | Source |
|--------|--------|
| CPU | From startup-status API health data |
| MEM | From startup-status API health data |
| HDD | From startup-status API health data |
| R2 Bucket | From startup-status API (full width row) |
| Sync Status | From startup-status API |
| Terminals | From `sessionStore.getTerminalsForSession()` (X/6 format) |
| Uptime | Computed from `session.createdAt` using `formatUptime()` |

Styled similar to InitProgress DETAILS panel (dark boxes with labels).

### Metrics Display Layout
```
+------------------+--------+--------+
|       CPU        |  MEM   |  HDD   |   <- Row 1: System metrics
+------------------+--------+--------+
|             R2 Bucket              |   <- Row 2: Full width
+------------------------------------+
|           Sync Status              |   <- Row 3: Sync indicator
+------------------+-----------------+
|    Terminals     |     Uptime      |   <- Row 4: Session info
+------------------+-----------------+
```

### Ready Detection on Page Load
When `loadSessions()` runs, it now verifies live container status for sessions marked as 'running' in KV:
1. Fetch KV status via `getSessionStatus()`
2. If KV returns 'running', call `getStartupStatus()` to verify live state
3. Based on `stage`:
   - `ready` → Mark as running, initialize terminals
   - `error` → Mark as error
   - `stopped` → Mark as stopped
   - Other stages → Mark as initializing, show progress bar
4. If `getStartupStatus()` fails → Mark as stopped (container unreachable)

This fixes the stale status issue where sessions didn't show as ready until browser refresh.

### System Metrics in All Stages
Backend `startup-status` endpoint now returns cpu/mem/hdd metrics in ALL stages where health server has responded (not just 'ready'):
- syncing stage: includes metrics if health server up
- mounting stage: includes metrics
- verifying stage: includes metrics
- ready stage: includes metrics

Frontend types updated with optional `cpu`, `mem`, `hdd` fields in `StartupStatusResponse.details`.

---

*Generated: 2026-02-04 (updated: DO zombie prevention, removed broken admin endpoints)*
