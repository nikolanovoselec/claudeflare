# Claudeflare Technical Reference

Browser-based Claude Code on Cloudflare Workers with per-session containers and R2 persistence.

**Workers.dev URL:** `https://<CLOUDFLARE_WORKER_NAME>.<ACCOUNT_SUBDOMAIN>.workers.dev` — used only for initial setup. After the setup wizard configures a custom domain, all traffic should go through the custom domain (protected by CF Access). The workers.dev URL should then be gated behind one-click Access in the Cloudflare dashboard.

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
| One container per SESSION | CPU isolation - each tab gets full 1 vCPU instead of sharing |
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
// Checks static patterns from env.ALLOWED_ORIGINS + dynamic origins from KV (cached in memory)
async function isAllowedOrigin(origin: string, env: Env): Promise<boolean> {
  const staticPatterns = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : DEFAULT_ALLOWED_ORIGINS;

  if (staticPatterns.some(pattern => origin.endsWith(pattern))) {
    return true;
  }

  // Check KV-stored origins (setup:custom_domain + setup:allowed_origins, cached per isolate)
  const kvOrigins = await getKvOrigins(env);
  return kvOrigins.some(pattern => origin.endsWith(pattern));
}
```

**Route Registration:**
- `/api/user` - User info endpoints
- `/api/users` - User management (add/remove allowed users)
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

  // Check user allowlist in KV (skip in DEV_MODE)
  if (c.env.DEV_MODE !== 'true') {
    const userEntry = await c.env.KV.get(`user:${user.email}`);
    if (!userEntry) {
      return c.json({ error: 'Forbidden: user not in allowlist' }, 403);
    }
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

**File:** `src/lib/error-types.ts`

Standardized error classes for consistent API responses (see section 2.7 for full hierarchy). Key utilities:
- `toError(unknown)` -- safely convert catch clause values to Error instances
- `toErrorMessage(unknown)` -- quick string extraction from unknown errors (used consistently across entire codebase)

### 2.5 Type Guards

**File:** `src/lib/type-guards.ts`

Runtime type validation to replace unsafe type casts.

```typescript
export function isBucketNameResponse(data: unknown): data is { bucketName: string | null } {
  return typeof data === 'object' && data !== null && 'bucketName' in data;
}
```

### 2.6 Constants

**File:** `src/lib/constants.ts`

Single source of truth for configuration values. Exports 16 constants:

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

// Idle timeout before container sleeps (30 minutes)
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Delay after setting bucket name before proceeding
export const BUCKET_NAME_SETTLE_DELAY_MS = 100;

// Cloudflare R2 permission IDs
export const R2_WRITE_PERMISSION_ID = 'e0d1f652c7d84d35a4e356734cad1c2b';
export const R2_READ_PERMISSION_ID = 'f2bfce71c75a4c1b86e288eb50549efc';

// Request ID display length
export const REQUEST_ID_LENGTH = 8;

// CORS max age in seconds
export const CORS_MAX_AGE_SECONDS = '86400';

// DO ID validation pattern
export const DO_ID_PATTERN = /^[a-f0-9]{64}$/i;

// Maximum session name length
export const MAX_SESSION_NAME_LENGTH = 100;

// Container ID display truncation length
export const CONTAINER_ID_DISPLAY_LENGTH = 24;
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

### 2.11 JWT Verification

**File:** `src/lib/jwt.ts`

JWT verification for Cloudflare Access tokens using RS256:

```typescript
import { verifyAccessJWT } from '../lib/jwt';

const payload = await verifyAccessJWT(token, authDomain, accessAud);
// Returns email, exp, aud, etc.
```

**Features:**
- JWKS fetched from `https://{authDomain}/cdn-cgi/access/certs`
- JWKS cached per-isolate with `resetJWKSCache()` for invalidation
- RS256 signature verification using Web Crypto API

### 2.12 Cache Reset

**File:** `src/lib/cache-reset.ts`

Centralized cache invalidation for module-level caches:

```typescript
import { resetSetupCache } from '../lib/cache-reset';

// Resets CORS + auth config + JWKS caches
resetSetupCache();
```

Called by setup wizard after configuration changes so subsequent requests pick up new KV values.

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

**Admin Routes:** Use CF Access `authMiddleware` + `requireAdmin` for authentication, allowing production access with role-based authorization.

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

Centralized magic numbers for frontend operations. Exports 13 constants:

| Constant | Value | Purpose |
|----------|-------|---------|
| `STARTUP_POLL_INTERVAL_MS` | 1500 | Startup status polling interval |
| `METRICS_POLL_INTERVAL_MS` | 5000 | Running session metrics polling |
| `MAX_CONNECTION_RETRIES` | 45 | Initial WebSocket connection attempts |
| `CONNECTION_RETRY_DELAY_MS` | 1500 | Delay between initial connection retries |
| `MAX_RECONNECT_ATTEMPTS` | 5 | Dropped connection recovery attempts |
| `RECONNECT_DELAY_MS` | 2000 | Delay between reconnection attempts |
| `TERMINAL_REFRESH_DELAY_MS` | 150 | Terminal refresh delay after WebSocket connect |
| `TERMINAL_SECONDARY_REFRESH_DELAY_MS` | 100 | Secondary refresh for cursor position fix |
| `CSS_TRANSITION_DELAY_MS` | 50 | Layout transition settle time |
| `WS_CLOSE_ABNORMAL` | 1006 | WebSocket close code for abnormal closure |
| `MAX_TERMINALS_PER_SESSION` | 6 | Maximum terminal tabs per session |
| `DURATION_REFRESH_INTERVAL_MS` | 60000 | Duration display refresh interval |
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

R2 credentials flow from the Worker to the container process through two paths:

1. **setBucketName path** (new containers, bucket updates): The Worker passes R2 credentials explicitly via `_internal/setBucketName` request body (`r2AccessKeyId`, `r2SecretAccessKey`, `r2AccountId`, `r2Endpoint`). This is the primary path and most reliable because the Worker definitely has the secrets.
2. **Constructor path** (container restart): The DO reads from `this.env` (Worker secrets) + `getR2Config()` (account ID/endpoint from KV or API). This is a fallback for when the DO is reactivated without going through `setBucketName`.

```typescript
// updateEnvVars() resolves with fallback chain:
const accessKeyId = this._r2AccessKeyId || this.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = this._r2SecretAccessKey || this.env.R2_SECRET_ACCESS_KEY || '';
const accountId = this._r2AccountId || this.env.R2_ACCOUNT_ID || '';
const endpoint = this._r2Endpoint || this.env.R2_ENDPOINT || '';

this.envVars = {
  AWS_ACCESS_KEY_ID: accessKeyId,      // For rclone S3 compatibility
  AWS_SECRET_ACCESS_KEY: secretAccessKey,
  R2_ACCESS_KEY_ID: accessKeyId,
  R2_SECRET_ACCESS_KEY: secretAccessKey,
  R2_ACCOUNT_ID: accountId,
  R2_BUCKET_NAME: bucketName,          // Per-user bucket
  R2_ENDPOINT: endpoint,
  TERMINAL_PORT: '8080',
};
```

**Critical: envVars must be set as a property assignment**, not as a getter. Cloudflare Containers reads `this.envVars` as a plain property at `start()` time.

**Internal Endpoints:**
- `/_internal/setBucketName` - Set user's bucket name + R2 credentials (passed from Worker)
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

Each session supports up to 6 terminal tabs, allowing users to run multiple tools simultaneously within the same container.

**Use Cases:**
- Tab 1: Claude Code (AI assistant)
- Tab 2: htop (system monitor)
- Tab 3: yazi (file manager)
- Tab 4: plain bash terminal

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
     tabs: TerminalTab[];      // Max 6 tabs
     activeTabId: string;      // Currently visible tab
   }
   ```

3. **Terminal Store (`terminal.ts`):**
   - All Maps use compound keys: `${sessionId}:${terminalId}`
   - `disposeSession(sessionId)` cleans up all terminals for a session

4. **Backend Route (`src/routes/terminal.ts`):**
   ```typescript
   // Parse compound session ID
   const compoundMatch = fullSessionId.match(/^(.+)-([1-6])$/);
   const baseSessionId = compoundMatch ? compoundMatch[1] : fullSessionId;
   const terminalId = compoundMatch ? compoundMatch[2] : '1';

   // Validate BASE session exists, forward full compound ID to container
   ```

5. **Container Terminal Server (`host/server.js`):**
   - No changes needed! SessionManager already handles multiple session IDs
   - Each compound ID (e.g., `abc123-1`) creates a separate PTY

**Tab Behavior:**
- Click `+` to add new terminal (max 6)
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
   e) Start terminal server (port 8080, handles WebSocket + REST + health)
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

Sync filters are controlled by `SYNC_MODE` env var (default: `full`):

| Mode | Workspace Sync | Use Case |
|------|---------------|----------|
| `full` | Entire `workspace/` folder (minus `node_modules/`) | Persistent storage across stop/resume (Cloudflare Containers have ephemeral disk) |
| `metadata` | Only `CLAUDE.md` and `.claude/` per repo | Lightweight sync, gitignored project context only |

To switch: change `${SYNC_MODE:-full}` default in `entrypoint.sh` or add `ENV SYNC_MODE=metadata` to Dockerfile.

Both modes always exclude: `.bashrc`, `.bash_profile`, `.config/rclone/`, `.cache/rclone/`, `.npm/`, `**/node_modules/`.

All rclone commands use `--filter` flags (NOT `--include`/`--exclude`). See entrypoint.sh `RCLONE_FILTERS` array.

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
Edge-level redirect: GET / -> 302 /setup (if setup:complete not in KV)
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
   +-- Check user allowlist in KV (user:{email} key)
   |   +-- Not found -> 403 Forbidden
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

### Session Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Create session (rate limited) |
| GET | `/api/sessions/:id` | Get a specific session |
| PATCH | `/api/sessions/:id` | Update session (e.g., rename) |
| DELETE | `/api/sessions/:id` | Delete session and destroy its container |
| POST | `/api/sessions/:id/touch` | Update lastAccessedAt timestamp |
| GET | `/api/sessions/:id/start` | Start session container |
| POST | `/api/sessions/:id/stop` | Stop session (kills PTY, container sleeps naturally) |
| GET | `/api/sessions/:id/status` | Get session and container status |

### Container Lifecycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/container/start` | Start a container (non-blocking) |
| POST | `/api/container/explicit-start` | Explicitly start container (blocking) |
| POST | `/api/container/destroy` | Destroy a container (SIGKILL) |
| GET | `/api/container/startup-status` | Poll startup progress |
| GET | `/api/container/health` | Health check |
| GET | `/api/container/state` | Get container state (DEV_MODE) |
| GET | `/api/container/debug` | Debug info (DEV_MODE) |
| GET | `/api/container/sync-log` | Get rclone sync log (DEV_MODE) |
| GET | `/api/container/mount-test` | Test mount (DEV_MODE) |

### Terminal

| Method | Endpoint | Description |
|--------|----------|-------------|
| WS | `/api/terminal/:sessionId-:terminalId/ws` | Terminal WebSocket (compound ID) |
| GET | `/api/terminal/:sessionId/status` | Terminal connection status |

### User Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user` | Get authenticated user info |
| GET | `/api/users` | List allowed users |
| POST | `/api/users` | Add allowed user |
| DELETE | `/api/users/:email` | Remove allowed user |

### Setup (No Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/setup/status` | Check setup status (`{ configured, tokenDetected }`) |
| GET | `/api/setup/detect-token` | Auto-detect token from env |
| POST | `/api/setup/configure` | Run configuration (`{ customDomain, allowedUsers, allowedOrigins? }`). After initial setup, requires admin role via CF Access. |
| POST | `/api/setup/reset-for-tests` | Reset for E2E tests (DEV_MODE only) |
| POST | `/api/setup/restore-for-tests` | Restore after E2E tests (DEV_MODE only) |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/destroy-by-id` | Kill zombie container by raw DO ID (requires admin role via CF Access) |

**Admin Endpoint Authentication:** Requires CF Access authentication with admin role (`authMiddleware` + `requireAdmin`).
- Body: `{ "doId": "<64-char-hex-do-id>" }`

**Use case:** When a container becomes a zombie (alarm keeps restarting it), use this endpoint to forcibly destroy it by its DO ID visible in the Cloudflare dashboard.

**REMOVED ENDPOINTS (were creating zombies instead of destroying them):**
- ~~`/api/admin/nuke-all`~~ - Used `idFromName()` which CREATES DOs
- ~~`/api/admin/destroy-by-name`~~ - Used `idFromName()` which CREATES DOs
- ~~`/api/container/nuke-all`~~ - Same issue
- ~~`/api/container/destroy-by-name`~~ - Same issue

**CRITICAL:** Only `destroy-by-id` uses `idFromString()` which safely references EXISTING DOs. All `idFromName()` approaches CREATE new DOs if they don't exist - this is fundamental to how Cloudflare Durable Objects work.

### Credentials (DEV_MODE)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/credentials` | Check credential status |
| POST | `/api/credentials` | Upload credentials |
| DELETE | `/api/credentials` | Remove credentials |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Worker health check |
| GET | `/api/health` | API health check (with timestamp) |

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
| `SERVICE_TOKEN_EMAIL` | Email for service token auth | Optional env var or .dev.vars |
| `CLOUDFLARE_API_TOKEN` | R2 bucket creation | Wrangler secret |
| `R2_ACCESS_KEY_ID` | R2 auth for containers | Wrangler secret |
| `R2_SECRET_ACCESS_KEY` | R2 auth for containers | Wrangler secret |
| `R2_ACCOUNT_ID` | R2 endpoint construction | Dynamic (env var with KV fallback via r2-config.ts) |
| `R2_ENDPOINT` | S3-compatible endpoint | Dynamic (env var with KV fallback via r2-config.ts) |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated patterns) | wrangler.toml |
| `ENCRYPTION_KEY` | AES-256 key for encrypting credentials at rest (DEPRECATED: crypto.ts removed) | Wrangler secret (optional) |

### Container Environment

| Variable | Purpose | Source |
|----------|---------|--------|
| `R2_BUCKET_NAME` | User's personal bucket | Worker → DO via `setBucketName` |
| `R2_ACCESS_KEY_ID` | rclone auth | Worker → DO via `setBucketName` (preferred) or DO `this.env` fallback |
| `R2_SECRET_ACCESS_KEY` | rclone auth | Worker → DO via `setBucketName` (preferred) or DO `this.env` fallback |
| `R2_ACCOUNT_ID` | rclone endpoint | Worker → DO via `setBucketName` or `getR2Config()` fallback |
| `R2_ENDPOINT` | rclone endpoint | Worker → DO via `setBucketName` or `getR2Config()` fallback |
| `AWS_ACCESS_KEY_ID` | S3 compatibility | Mirrors `R2_ACCESS_KEY_ID` |
| `AWS_SECRET_ACCESS_KEY` | S3 compatibility | Mirrors `R2_SECRET_ACCESS_KEY` |
| `TERMINAL_PORT` | Always 8080 | Hardcoded in DO class |

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
|   |   |   +-- lifecycle.ts  # Start, destroy, explicit-start endpoints
|   |   |   +-- status.ts     # Health, startup-status endpoints
|   |   |   +-- debug.ts      # Debug, state, sync-log, mount-test endpoints (DEV_MODE gated)
|   |   |   +-- shared.ts     # Shared types, logger, and container circuit breakers
|   |   +-- session/          # Session API (split for maintainability)
|   |   |   +-- index.ts      # Route aggregator with shared auth middleware
|   |   |   +-- crud.ts       # GET/POST/PATCH/DELETE session endpoints
|   |   |   +-- lifecycle.ts  # start/stop/status/batch-status session endpoints
|   |   +-- setup/            # Setup wizard API (split into modules)
|   |   |   +-- index.ts      # Route aggregator (status, detect-token, configure)
|   |   |   +-- handlers.ts   # Status, detect-token, reset/restore-for-tests
|   |   |   +-- secrets.ts    # handleSetSecrets (R2 credentials, error 10215 fallback)
|   |   |   +-- custom-domain.ts # handleConfigureCustomDomain (DNS, worker route)
|   |   |   +-- access.ts     # handleCreateAccessApp (CF Access app + policy)
|   |   |   +-- account.ts    # handleGetAccount (account ID resolution)
|   |   |   +-- credentials.ts # handleDeriveR2Credentials (SHA-256 derivation)
|   |   |   +-- shared.ts     # Shared: logger, rate limiter, helpers
|   |   +-- admin.ts          # Admin-only endpoints (destroy-by-id)
|   |   +-- terminal.ts       # Terminal WebSocket proxy
|   |   +-- user-profile.ts   # User info
|   |   +-- users.ts          # User management API (GET/POST /api/users, DELETE /api/users/:email)
|   |   +-- credentials.ts    # Credential management (DEV_MODE gated)
|   +-- middleware/
|   |   +-- auth.ts           # Shared auth middleware (checks user allowlist in KV)
|   |   +-- rate-limit.ts     # Per-user rate limiting middleware
|   +-- lib/
|   |   +-- access.ts         # CF Access auth helpers
|   |   +-- access-policy.ts  # Shared user/Access operations helper
|   |   +-- r2-admin.ts       # R2 bucket API (handles "already exists" race)
|   |   +-- r2-config.ts      # R2 config resolution (env vars with KV fallback)
|   |   +-- kv-keys.ts        # KV key utilities
|   |   +-- constants.ts      # Centralized constants (ports, patterns, R2 IDs, timeouts)
|   |   +-- container-helpers.ts  # Container initialization helpers
|   |   +-- error-types.ts    # Centralized error classes (AppError hierarchy)
|   |   +-- type-guards.ts    # Runtime type validation
|   |   +-- circuit-breaker.ts  # Circuit breaker pattern for resilience
|   |   +-- circuit-breakers.ts # Shared circuit breaker instances for container routes
|   |   +-- cors-cache.ts     # In-memory CORS origins cache (shared between index.ts and setup)
|   |   +-- cache-reset.ts    # Centralized cache reset (CORS + auth + JWKS)
|   |   +-- jwt.ts            # JWT verification against CF Access JWKS (RS256)
|   |   +-- logger.ts         # Structured JSON logging
|   +-- container/
|   |   +-- index.ts          # container DO class (extends Container)
|   +-- __tests__/
|       +-- index.test.ts     # Edge-level redirect tests
|       +-- lib/              # Unit tests for lib modules
|       |   +-- access.test.ts
|       |   +-- access-policy.test.ts
|       |   +-- circuit-breaker.test.ts
|       |   +-- constants.test.ts
|       |   +-- container-helpers.test.ts
|       |   +-- error-types.test.ts
|       |   +-- jwt.test.ts
|       |   +-- logger.test.ts
|       |   +-- r2-config.test.ts
|       |   +-- type-guards.test.ts
|       +-- middleware/       # Auth and rate-limit tests
|       |   +-- auth.test.ts
|       |   +-- rate-limit.test.ts
|       +-- routes/           # Unit tests for route handlers
|           +-- session.test.ts
|           +-- setup.test.ts
|           +-- setup-shared.test.ts
|           +-- container-lifecycle.test.ts
|           +-- container-status.test.ts
|           +-- users.test.ts
|
+-- e2e/
|   +-- config.ts             # E2E test configuration
|   +-- setup.ts              # E2E test setup (BASE_URL, apiRequest helper)
|   +-- api.test.ts           # E2E API tests
|   +-- helpers/
|   |   +-- test-utils.ts     # Cleanup utilities (cleanupAllSessions, restoreSetupComplete)
|   +-- ui/                   # E2E UI tests (Puppeteer)
|       +-- setup.ts          # Puppeteer helpers (launchBrowser, navigateTo)
|       +-- helpers.ts        # UI test utilities (waitForSelector, click)
|       +-- layout.test.ts
|       +-- session-management.test.ts
|       +-- terminal-interaction.test.ts
|       +-- settings-panel.test.ts
|       +-- setup-wizard.test.ts
|       +-- session-card-enhancements.test.ts
|       +-- tiling.test.ts
|       +-- full-journey.test.ts
|       +-- error-handling.test.ts
|       +-- rate-limiting.test.ts
|       +-- request-tracing.test.ts
|
+-- host/
|   +-- server.js             # Terminal server (node-pty + WebSocket)
|   +-- package.json          # Terminal server deps
|
+-- web-ui/
|   +-- src/
|   |   +-- App.tsx           # Root component
|   |   +-- index.tsx         # Entry point
|   |   +-- index.css         # Global styles (imports design tokens)
|   |   +-- types.ts          # Frontend types
|   |   +-- components/
|   |   |   +-- Terminal.tsx     # xterm.js wrapper
|   |   |   +-- TerminalTabs.tsx # Tab bar UI with icons and animations
|   |   |   +-- Layout.tsx       # Main layout (Header + AppSidebar + TerminalArea)
|   |   |   +-- Header.tsx       # App header with logo and settings
|   |   |   +-- StatusBar.tsx    # Connection status, sync time, shortcuts
|   |   |   +-- AppSidebar.tsx   # Sidebar wrapper (extracted from Layout)
|   |   |   +-- TerminalArea.tsx # Terminal section wrapper (extracted from Layout)
|   |   |   +-- SessionList.tsx  # Session list with search
|   |   |   +-- SessionCard.tsx  # Individual session card (extracted)
|   |   |   +-- InitProgress.tsx # Session init progress modal
|   |   |   +-- SettingsPanel.tsx # Slide-out settings panel (includes User Management)
|   |   |   +-- TilingButton.tsx  # Tiling mode toggle button
|   |   |   +-- TilingOverlay.tsx # Layout selection dropdown
|   |   |   +-- TiledTerminalContainer.tsx # Multi-terminal grid renderer
|   |   |   +-- TiledTerminalContainer.css # Tiled terminal grid styles
|   |   |   +-- EmptyState.tsx    # Reusable empty state component
|   |   |   +-- EmptyStateVariants.tsx  # Pre-built empty states
|   |   |   +-- Icon.tsx          # SVG icon wrapper for MDI
|   |   |   +-- ui/              # Base UI components
|   |   |   |   +-- index.ts     # Barrel export
|   |   |   |   +-- Button.tsx, Input.tsx
|   |   |   +-- setup/           # Setup wizard steps (3-step flow)
|   |   |       +-- SetupWizard.tsx, WelcomeStep.tsx
|   |   |       +-- ConfigureStep.tsx, ProgressStep.tsx
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
|   |   |   +-- settings.ts      # Settings type, defaults, localStorage load/save
|   |   |   +-- format.ts        # formatRelativeTime, formatUptime helpers
|   |   |   +-- status-mapper.ts  # mapStartupDetailsToProgress
|   |   +-- styles/
|   |   |   +-- design-tokens.css  # 100+ CSS variables
|   |   |   +-- animations.css     # Keyframes and animation utilities
|   |   |   +-- components.css     # Shared component styles
|   |   |   +-- app.css, layout.css, header.css, status-bar.css
|   |   |   +-- terminal.css, terminal-tabs.css
|   |   |   +-- tiling-button.css, tiling-overlay.css
|   |   |   +-- session-list.css   # Session list styles
|   |   |   +-- init-progress.css  # Init progress modal styles
|   |   |   +-- settings-panel.css # Settings panel styles
|   |   |   +-- empty-state.css, button.css, input.css, icon.css
|   |   |   +-- setup-wizard.css, welcome-step.css
|   |   |   +-- configure-step.css, progress-step.css
|   |   +-- __tests__/            # Frontend unit tests
|   |       +-- setup.ts          # Test setup
|   |       +-- smoke.test.ts     # Smoke tests
|   |       +-- utils/
|   |       |   +-- mocks.ts     # Shared mocks
|   |       +-- components/       # Component tests
|   |       |   +-- Button.test.tsx, Input.test.tsx
|   |       |   +-- Header.test.tsx, StatusBar.test.tsx, SettingsPanel.test.tsx
|   |       |   +-- SessionList.test.tsx, EmptyState.test.tsx, InitProgress.test.tsx
|   |       |   +-- Terminal.test.tsx, TerminalTabs.test.tsx
|   |       |   +-- TilingButton.test.tsx, TilingOverlay.test.tsx
|   |       |   +-- TiledTerminalContainer.test.tsx
|   |       +-- stores/           # Store tests
|   |       |   +-- terminal.test.ts
|   |       |   +-- session.test.ts
|   |       |   +-- session-tiling.test.ts
|   |       |   +-- session-ready-detection.test.ts
|   |       |   +-- setup.test.ts
|   |       +-- lib/              # Lib tests
|   |       |   +-- format.test.ts
|   |       +-- api/              # API tests
|   |           +-- client.test.ts
|   |           +-- contract.test.ts
|   +-- vitest.config.ts      # Vitest config for component tests
|   +-- dist/                 # Built frontend (static assets)
|
+-- Dockerfile                # Container image
+-- entrypoint.sh             # Container startup script
+-- wrangler.toml             # Cloudflare configuration
+-- vitest.config.ts          # Unit test config
+-- vitest.e2e.config.ts      # E2E test config
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

## 10. Container Startup - Polling with Safety Timeouts

**File:** `entrypoint.sh`

The container startup script uses **polling with safety timeouts**. This prefers early exit on success but prevents infinite blocking.

### Why Polling with Safety Timeouts?

**Problems with fixed timeouts only:**
- If npm install takes 5 seconds but timeout is 60s → 55 seconds wasted
- If npm install takes 90 seconds but timeout is 60s → premature failure
- Network conditions vary → fixed timeouts are wrong in both directions

**Polling with safety timeouts approach:**
- Poll until success OR the background process exits OR safety timeout expires
- Exit immediately on success (no waiting)
- Safety timeouts prevent infinite blocking if a process hangs:
  - `SYNC_TIMEOUT=120` (2 min) for initial R2 sync
  - `BISYNC_TIMEOUT=180` (3 min) for bisync baseline
  - `MAX_NPM_WAIT=120` (2 min) for npm install
  - `MAX_CONSENT_WAIT=30` (30 sec) for consent files

### Parallel Startup

The entrypoint runs R2 sync and claude-unleashed auto-update in parallel:

```
Container Start
├── initial_sync_from_r2() &    ← Background process
├── wait for R2 sync            ← Block until data restored
├── establish_bisync_baseline() &   ← Background (non-blocking)
├── configure_claude_autostart()
└── Start terminal server (port 8080)
```

Auto-update is disabled on tab 1 auto-start (`CLAUDE_UNLEASHED_SILENT=1 CLAUDE_UNLEASHED_NO_UPDATE=1` inline env vars) for fast container boot. Users can update manually by running `cu` or `claude-unleashed` in any terminal tab. No consent prompts in either mode (`CLAUDE_UNLEASHED_SKIP_CONSENT=1` set globally in Dockerfile).

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
| Utilities | jq, ripgrep, fd, tree, btop, htop, tmux, yazi, fzf, zoxide, bat |
| Yazi preview dependencies | file, ffmpeg, p7zip, poppler-utils, imagemagick |
| Terminal | ncurses, ncurses-terminfo |

### Global NPM Packages

- `claude-unleashed` - Claude Code CLI wrapper with unleashed mode support (wraps `@anthropic-ai/claude-code`)

### Build Process

```dockerfile
# Install system packages
RUN apk add --no-cache rclone git vim ... \
    && apk add --no-cache yazi --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing \
    && apk add --no-cache lazygit --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community

# Install claude-unleashed
RUN npm install -g github:nikolanovoselec/claude-unleashed

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

## 12. Claude-Unleashed Integration

Claudeflare uses [claude-unleashed](https://github.com/nikolanovoselec/claude-unleashed) to enable `--dangerously-skip-permissions` when running as root inside containers.

### Why Claude-Unleashed?

Standard Claude Code CLI prevents combining `--dangerously-skip-permissions` with running as root (detected via `process.getuid() === 0`). Since Cloudflare Containers run as root, claude-unleashed wraps the official CLI and bypasses these restrictions.

### How It Works

1. Ships with Claude Code 2.1.25 baseline
2. **Two separate updaters, two controls:**
   - **claude-unleashed's updater**: checks npm for latest `@anthropic-ai/claude-code`. Disabled on auto-start via `CLAUDE_UNLEASHED_NO_UPDATE=1` (fast boot). Runs on manual `cu` (updates to latest).
   - **Upstream CLI's internal auto-updater**: background process that checks for native builds. Always disabled via `DISABLE_AUTOUPDATER=1` (set by claude-unleashed) + source patch for `DISABLE_INSTALLATION_CHECKS`. Without this, causes 30s startup delay and "Auto-update failed" errors in containers.
3. The `claude` wrapper in `/usr/local/bin/claude` delegates to `cu` (claude-unleashed)
4. All configuration via Dockerfile ENV vars -- no CLI flags or consent prompts needed

### Container Configuration

**Dockerfile installs claude-unleashed:**
```dockerfile
RUN npm install -g github:nikolanovoselec/claude-unleashed
```

### Environment Variables

**Global (Dockerfile ENV -- always active):**

| Variable | Purpose | Value |
|----------|---------|-------|
| `CLAUDE_UNLEASHED_SKIP_CONSENT` | Skip consent prompt | `1` |
| `IS_SANDBOX` | Sandbox mode | `1` |

**Auto-start only (exported in `.bashrc`, unset after `cu` exits):**

| Variable | Purpose | Value |
|----------|---------|-------|
| `CLAUDE_UNLEASHED_SILENT` | Suppress banners | `1` |
| `CLAUDE_UNLEASHED_NO_UPDATE` | Skip claude-unleashed's updater (fast boot) | `1` |

**Set internally by claude-unleashed (always, before importing CLI):**

| Variable | Purpose | Value |
|----------|---------|-------|
| `DISABLE_INSTALLATION_CHECKS` | Suppress upstream CLI deprecation warnings | `1` |
| `DISABLE_AUTOUPDATER` | Disable upstream CLI background auto-updater | `1` |

### Security Considerations

**Acceptable trade-offs for Claudeflare:**
- Containers are isolated and ephemeral
- Each user has their own container
- Container destruction cleans up all state
- Users explicitly chose to use this service

**What unleashed mode bypasses:**
- File read/write permission prompts
- Shell command execution prompts
- Network access prompts

Global Dockerfile ENV sets `CLAUDE_UNLEASHED_SKIP_CONSENT` and `IS_SANDBOX`. claude-unleashed internally sets `DISABLE_INSTALLATION_CHECKS` and `DISABLE_AUTOUPDATER` before importing the upstream CLI (always active, including manual runs). Auto-start exports `CLAUDE_UNLEASHED_SILENT` and `CLAUDE_UNLEASHED_NO_UPDATE` in `.bashrc`, then unsets them after `cu` exits -- so manual re-runs get full output and auto-update. The `claude` wrapper in `/usr/local/bin/claude` delegates to `cu`.

### Troubleshooting

**claude-unleashed not found:**
```bash
which cu
npm list -g claude-unleashed
```

---

## 13. Test Infrastructure

**Backend:** `vitest.config.ts` uses `@cloudflare/vitest-pool-workers` -- tests execute in a real Workers runtime, not Node.js.

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

**Frontend:** `web-ui/vitest.config.ts` uses jsdom + SolidJS Testing Library.

**E2E:** `vitest.e2e.config.ts` with 30s timeouts. Tests run against the deployed worker.

For full test coverage details, commands, and E2E setup, see [Section 16: Testing](#16-testing).

---

## 14. Development Setup

### Prerequisites

- Node.js 22+
- Docker (for container image builds)
- npm

### Local Development

```bash
# Install dependencies
npm install
cd web-ui && npm install && cd ..

# Run locally (requires Docker)
npm run dev

# Type checking
npm run typecheck

# Run unit tests
npm test

# Run E2E tests (against deployed worker)
npm run test:e2e
```

### Web UI Development

```bash
cd web-ui
npm run dev       # Start dev server
npm run build     # Build for production
npm run typecheck # Type check frontend
npm test          # Run ~542 component/store/API tests
```

### Commands Reference

| Command | Description |
|---------|-------------|
| `npm run typecheck` | Type check backend |
| `npm run deploy` | Deploy to Cloudflare (requires Docker) |
| `npm run deploy:docker` | Build container image and deploy |
| `npm test` | Run backend unit tests (Vitest with Workers pool) |
| `npm run test:e2e` | Run E2E API tests against deployed worker |
| `npm run test:e2e:ui` | Run E2E UI tests with Puppeteer |

---

## 15. CI/CD (GitHub Actions)

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `deploy.yml` | Manual (`workflow_dispatch`) | Full deploy: tests + typecheck + Docker build + wrangler deploy + set CLOUDFLARE_API_TOKEN secret |
| `test.yml` | Pull requests | Tests + typecheck only (no deploy) |
| `e2e.yml` | Manual | E2E tests against a deployed worker |

### GitHub Secrets and Variables

**Secrets** (Settings > Secrets and variables > Actions > Secrets):

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | The Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

**Variables** (Settings > Secrets and variables > Actions > Variables):

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDFLARE_WORKER_NAME` | No | Custom worker name (defaults to `claudeflare`) |
| `ACCOUNT_SUBDOMAIN` | For E2E tests | Your account subdomain (Workers & Pages > Overview) |

### Deploy Workflow Details

The deploy workflow (`deploy.yml`) uses `wrangler-action@v3` with `--name ${{ vars.CLOUDFLARE_WORKER_NAME || 'claudeflare' }}`, so forks can override the worker name. After deploy, it sets `CLOUDFLARE_API_TOKEN` as a worker secret so the setup wizard can auto-detect it. Only `deploy.yml` builds the container image (requires Docker, available on GH runners).

---

## 16. Testing

### Backend Unit Tests

Located in `src/__tests__/`. Uses Vitest with `@cloudflare/vitest-pool-workers` -- tests execute in a real Workers runtime, not Node.js.

```bash
npm test
```

**~317 tests** across 19 test files covering:
- Constants validation (ports, session ID patterns, R2 permission IDs)
- Container helper functions (getContainerId, waitForContainerHealth)
- Type guards (isBucketNameResponse)
- Error types (AppError hierarchy including RateLimitError, CircuitBreakerOpenError)
- Circuit breaker pattern
- JWT verification (RS256 against CF Access JWKS)
- R2 config resolution (env vars with KV fallback)
- CF Access auth helpers
- Rate limiting middleware
- Auth middleware (user allowlist checks in KV)
- Structured logging
- Edge-level redirect (GET / -> 302 /setup when not configured)
- Route tests: setup, setup-shared, session CRUD/lifecycle/batch-status, container lifecycle/status, user management

**Shared mock:** `src/__tests__/helpers/mock-kv.ts` exports `createMockKV()` -- a Map-backed KV mock. All tests use in-memory mocks (no real KV binding).

### Frontend Unit Tests

Located in `web-ui/src/__tests__/`. Uses Vitest with SolidJS Testing Library + jsdom.

```bash
cd web-ui && npm test
```

**~542 tests** across 22 test files covering:
- Base UI components (Button, Input)
- Layout components (Header, StatusBar, SettingsPanel)
- Feature components (SessionList, SessionCard, TerminalTabs, InitProgress, EmptyState)
- Tiling components (TilingButton, TilingOverlay, TiledTerminalContainer)
- Terminal component tests
- Lib tests (format.ts helpers)
- Terminal store -- WebSocket state, compound keys, reconnection
- Session store -- CRUD, tiling, metrics polling, ready detection
- Setup store -- wizard state, validation, persistence
- API client -- request handling, error mapping, retry logic, sessionId validation
- API contract -- Zod schema validation, type safety

**Frontend test setup:** `web-ui/src/__tests__/setup.ts` is auto-loaded. Mocks `localStorage`, `WebSocket` (with `_simulateMessage`/`_simulateError` helpers), and `ResizeObserver`.

### E2E API Tests

Located in `e2e/`. Tests API endpoints against the deployed worker.

```bash
ACCOUNT_SUBDOMAIN=your-subdomain npm run test:e2e

# With a custom worker name
ACCOUNT_SUBDOMAIN=your-subdomain CLOUDFLARE_WORKER_NAME=my-worker npm run test:e2e
```

### E2E UI Tests

Located in `e2e/ui/`. Uses Puppeteer against the deployed worker to test user journeys.

```bash
ACCOUNT_SUBDOMAIN=your-subdomain npm run test:e2e:ui
```

**132 Puppeteer tests** covering: layout, session management, terminal interactions, settings panel, setup wizard, tiling, error handling, rate limiting, and request tracing.

### E2E Requirements

1. `DEV_MODE = "true"` deployed to the worker (bypasses internal auth)
2. **No Cloudflare Access on the workers.dev domain** -- if one-click Access is enabled, E2E requests will be blocked at the edge
3. Re-deploy with `DEV_MODE = "false"` after testing

### E2E Cleanup

Tests include automatic cleanup via `afterAll` hooks:
- `cleanupAllSessions()` deletes all test sessions
- `restoreSetupComplete()` restores the `setup:complete` KV flag

If tests fail before cleanup runs, manually restore:
```bash
npx wrangler kv key put "setup:complete" "true" --namespace-id <your-namespace-id> --remote
```

---

## 17. API Token Permissions

Each permission is actively used -- none are optional.

### Account Permissions

| Permission | Access | Why |
|-----------|--------|-----|
| Account Settings | Read | Discovers account ID and verifies the token during setup |
| Workers Scripts | Edit | Sets worker secrets (R2 credentials) during setup. Used by `wrangler deploy` for CI/CD |
| Workers KV Storage | Edit | Creates the KV namespace (`claudeflare-kv`) during deployment |
| Workers R2 Storage | Edit | Creates per-user R2 buckets on container start, deletes them on user removal |
| Containers | Edit | Full container lifecycle -- start, stop, destroy, health checks |
| Access: Apps and Policies | Edit | Creates the CF Access app and syncs user allowlist policy |

### Zone Permissions

| Permission | Access | Why |
|-----------|--------|-----|
| Zone | Read | Resolves zone ID from root domain during custom domain setup |
| DNS | Edit | Creates proxied CNAME record pointing custom domain to workers.dev |
| Workers Routes | Edit | Creates worker route mapping `{customDomain}/*` to the worker |

Zone permissions are only used during setup when configuring a custom domain. Account permissions are required for core functionality.

---

## 18. Configuration

### Secrets

All secrets are set automatically by the deploy workflow (`CLOUDFLARE_API_TOKEN`) and the setup wizard (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).

No optional manual secrets are required. (`ENCRYPTION_KEY` was previously optional for credential encryption; `crypto.ts` has been removed.)

### Environment Variables (wrangler.toml)

| Variable | Description |
|----------|-------------|
| `DEV_MODE` | Set to `"true"` to bypass Access auth (dev only) |
| `ALLOWED_ORIGINS` | Static CORS origin patterns (defaults to `".workers.dev"`). Additional origins managed dynamically via setup wizard and stored in KV. |

### CORS

CORS origins are managed dynamically. During setup, the wizard automatically adds your custom domain and `.workers.dev` to the allowed origins list (stored in KV). The `ALLOWED_ORIGINS` env var in `wrangler.toml` serves as a static fallback.

`R2_ACCOUNT_ID` and `R2_ENDPOINT` are resolved dynamically at runtime (env vars with KV fallback). For local dev, set them in `.dev.vars`.

---

## 19. Container Specs

| Spec | Value |
|------|-------|
| Instance type | Custom (1 vCPU, 3 GiB RAM, 4 GB disk) |
| Base image | Node.js 22 Alpine |
| Cost | ~$56/container/month while running |

### Included Tools

| Category | Packages |
|----------|----------|
| AI | claude-unleashed (wraps @anthropic-ai/claude-code) |
| Sync | rclone |
| Version Control | git, gh, lazygit |
| Editors | vim, neovim, nano |
| Build | make, gcc, g++, python3, nodejs, npm |
| Utilities | jq, ripgrep, fd, tree, btop, htop, tmux, yazi, fzf, zoxide, bat |

---

## 20. Troubleshooting

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

### R2 Sync Skipped — DO Missing Worker Secrets

**Symptom:** Container starts but shows "sync skipped: R2_ACCESS_KEY_ID not set" (or similar).

**Cause:** The DO's `this.env` may not reliably have Worker secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). This can happen if secrets aren't set or if the DO env doesn't include all Worker bindings.

**Fix (implemented):** The Worker now passes R2 credentials to the DO via the `_internal/setBucketName` request body. The DO uses Worker-provided credentials first, falling back to `this.env` only if not provided. The startup-status endpoint now includes the specific `syncError` for 'skipped' status so you can see which env var is missing.

**Diagnosis:** Check the startup-status response `details.syncError` field — it names the exact missing variable.

### Container Stuck at "Waiting for Services"

**Symptom:** Startup progress stuck at 20%.

**Cause:** Terminal server (port 8080) not starting, usually sync blocking.

**Diagnosis:**
```bash
curl /api/container/sync-log?sessionId=xxx
```

**Common Issues:**
- Missing R2 credentials (check startup-status `details.syncError`)
- Bucket doesn't exist
- Network timeout to R2

### R2 Sync Transfers 0 Files — rclone Filter Order

**Symptom:** Sync log shows `"Using --filter is recommended instead of both --include and --exclude as the order they are parsed in is indeterminate"` and `"There was nothing to transfer"` despite many files listed.

**Cause:** Mixing `--include` and `--exclude` rclone flags makes filter processing order indeterminate. rclone may process all excludes before includes, effectively blocking everything.

**Fix:** Use `--filter` flags instead. `--filter "- pattern"` for exclude, `--filter "+ pattern"` for include. Order is guaranteed with `--filter`.

**Correct pattern:**
```bash
rclone sync "r2:$BUCKET/" "$HOME/" \
    --filter "- .config/rclone/**" \
    --filter "- .cache/rclone/**" \
    --filter "- .npm/**" \
    --filter "- **/node_modules/**" \
    --filter "+ workspace/**/CLAUDE.md" \
    --filter "+ workspace/**/.claude/**" \
    --filter "- workspace/**"
```

**Diagnosis:** Check `/tmp/sync.log` inside the container for the indeterminate order warning.

### Slow Sync With Full Workspace Mode

**Symptom:** Container startup slow with `SYNC_MODE=full` (default).

**Cause:** Full workspace sync downloads all workspace data from R2 on startup. Large repos with many files will slow initial sync.

**Options:**
1. Switch to metadata-only sync: set `SYNC_MODE=metadata` in entrypoint.sh or Dockerfile
2. Manually clean large repos from R2: `rclone delete r2:claudeflare-<user-bucket>/workspace/<repo>/ -v`
3. Clean caches: `rclone delete r2:claudeflare-<user-bucket>/.npm/ -v`

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
  8080  // Target port
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

**Recovery:** Use admin endpoint to kill zombie (requires CF Access admin auth):
```bash
curl -X POST "https://claude.example.com/api/admin/destroy-by-id" \
  -H "Content-Type: application/json" \
  -H "Cookie: CF_Authorization=<your-cf-access-jwt>" \
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

**Symptom:** After running `wrangler delete`, worker redeploys with missing secrets (R2 credentials, etc.).

**Cause:** `wrangler delete` nukes the entire worker including all stored secrets. They are NOT restored on redeployment.

**Fix:** Re-set all secrets after redeployment:
```bash
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
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

## 21. Debugging Guide

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
  "success": true,
  "containerId": "claudeflare-user-example-com-abc12345",
  "state": {
    "status": "running",
    "startTime": 1234567890,
    "stopTime": null
  }
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
  "success": true,
  "containerId": "claudeflare-user-example-com-abc12345",
  "container": {
    "status": "ok",
    "syncStatus": "success",
    "cpu": "12%",
    "mem": "45%",
    "hdd": "2.1G/4.0G"
  }
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
```

**If missing after `wrangler delete`:**
```bash
wrangler secret put CLOUDFLARE_API_TOKEN
# Paste your Cloudflare API token

wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
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

## 22. Cost

### Per-Container Pricing

| Resource | Tier | Specs | Monthly Cost |
|----------|------|-------|--------------|
| Container | Custom | 1 vCPU, 3 GiB RAM, 4 GB disk | ~$56 |

### Scaling Model

- **Cost scales per ACTIVE SESSION** - each browser tab = dedicated container
- **Idle containers hibernate** via DO alarm-based hibernation with `IDLE_TIMEOUT_MS` (30 min). The DO polls `/activity` every 5 minutes and destroys the container when no WebSocket connections AND no PTY output for 30 minutes.
- **Hibernated containers** don't incur CPU costs, only storage

### Example Monthly Costs

| Usage | Containers | Estimated Cost |
|-------|------------|----------------|
| Single session | 1 | ~$56 |
| 3 concurrent sessions | 3 | ~$168 |
| 10 concurrent sessions | 10 | ~$560 |

### R2 Storage

- First 10GB free per month
- $0.015/GB/month after that
- User config typically <100MB per bucket

---

## 23. Lessons Learned

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

21. **Polling with safety timeouts over fixed timeouts** - Never use only fixed timeouts (e.g., `while [ $WAITED -lt 60 ]`) for process synchronization. Instead, poll with `kill -0 $PID` to check if process is still running, exit immediately on success, and use safety timeouts (e.g., `MAX_NPM_WAIT=120`, `MAX_CONSENT_WAIT=30`) to prevent infinite blocking if a process hangs.

22. **Zombie prevention with _destroyed flag** - In Cloudflare Durable Objects, calling ANY method (including `getState()`) wakes up a hibernated DO. When `destroy()` is called, a pre-scheduled alarm may still fire and resurrect the zombie. The fix: (1) set a `_destroyed` flag in DO storage BEFORE calling `super.destroy()`, (2) in `alarm()`, check the flag FIRST using only `ctx.storage.get()` (which doesn't wake the DO), and (3) if destroyed, clear all storage and exit without calling Container methods.

23. **Single port architecture eliminates port conflicts** - All container services (WebSocket, health, metrics) are consolidated on port 8080. Earlier multi-port designs had issues with the early health server holding port 3000 and preventing the full server from starting. Single port eliminates this class of bugs entirely.

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

