# Claudeflare

Run Claude Code in your browser via Cloudflare Containers.

## What is this?

Claudeflare lets you run Anthropic's Claude Code CLI entirely in your browser. Each terminal session gets its own isolated container, while your Claude credentials and configuration are automatically persisted and synced across sessions via Cloudflare R2.

## Features

- **Browser-based Claude Code** - Full Claude Code CLI running in Cloudflare Containers
- **Multiple terminal sessions** - Open several Claude instances in parallel
- **Nested terminals** - Up to 6 terminal tabs per session (Claude + htop + yazi + bash)
- **YOLO mode** - Runs with `--dangerously-skip-permissions` for uninterrupted workflows
- **Connection status indicators** - Real-time WebSocket connection state shown per session
- **Persistent storage** - Credentials, config, workspace, and conversation history sync to R2
- **Login once, use everywhere** - Authenticate in one session, all others pick it up
- **Fast startup** - Per-session containers with config-only sync (~0.2s)
- **Dev tools included** - git, gh, vim, neovim, ripgrep, tmux, yazi, lazygit, and more

## Architecture

```
Browser (multiple tabs)
    |
    | WebSocket (up to 6 per session)
    v
+---------------------------+
|   Cloudflare Worker       |
|   (Hono router)           |
|   + Cloudflare Access     |
+---------------------------+
    |
    | Per-session container
    v
+---------------------------+
|   Container (Alpine)      |
|   - Claude Code (YOLO)    |
|   - Up to 6 PTYs/session  |
|   - rclone bisync         |
+---------------------------+
    |
    | Bidirectional sync (60s)
    v
+---------------------------+
|   R2 Storage              |
|   (per-user bucket)       |
|   ~/.claude/ credentials  |
|   ~/.config/ settings     |
|   ~/workspace/ code       |
+---------------------------+
```

## How It Works

1. **Authentication** - Cloudflare Access protects the worker; users authenticate via SSO
2. **Per-session containers** - Each browser tab gets its own dedicated container
3. **Shared credentials** - All containers sync to the same per-user R2 bucket
4. **Bidirectional sync** - rclone bisync runs every 60s, newest file wins on conflict
5. **Workspace persistence** - Code repos sync to R2 across sessions

## Requirements

- Cloudflare account with Workers Paid plan (~$5/month base)
- Claude Max subscription for Claude Code CLI access
- A domain with its DNS zone in Cloudflare (for the mandatory custom domain)

## Getting Started

### 1. Create a Cloudflare API Token

Go to [Cloudflare Dashboard > My Profile > API Tokens](https://dash.cloudflare.com/profile/api-tokens) and create a custom token with these permissions:

**Account permissions:**

| Permission | Access |
|------------|--------|
| Account Settings | Read |
| Workers Scripts | Edit |
| Workers KV Storage | Edit |
| Workers R2 Storage | Edit |
| Containers | Edit |
| Access: Apps and Policies | Edit |

**Zone permissions:**

| Permission | Access |
|------------|--------|
| Zone | Read |
| DNS | Edit |
| Workers Routes | Edit |

Set **Account Resources** to your target account and **Zone Resources** to the zone where your custom domain lives (or "All zones" if unsure).

All permissions are required — the setup wizard creates DNS records, Access policies, R2 buckets, and worker secrets automatically.

### 2. Configure GitHub

Fork this repo, then add the following:

**Secrets** (Settings > Secrets and variables > Actions > Secrets):

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | The API token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (found on any Workers page in the dashboard sidebar) |

**Variables** (Settings > Secrets and variables > Actions > Variables):

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDFLARE_WORKER_NAME` | No | Custom worker name (defaults to `claudeflare`) |
| `ACCOUNT_SUBDOMAIN` | For E2E tests | Your account subdomain (Workers & Pages > Overview) |

### 3. Deploy

Go to **Actions > Deploy** and click **Run workflow** on the `main` branch.

The workflow builds the frontend, runs tests, builds the Docker container image, deploys to Cloudflare, and sets the API token as a worker secret.

### 4. Run the Setup Wizard

After deployment, find your worker URL in the GitHub Actions log or in the Cloudflare dashboard under **Workers & Pages**. The URL follows the pattern:

```
https://<worker-name>.<account-subdomain>.workers.dev
```

Visit the URL and you'll be redirected to the setup wizard:

1. **Welcome** — automatically detects your API token from the worker environment. No manual token entry needed.
2. **Configure** — enter your custom domain (e.g., `claude.example.com`), allowed user emails, and optional CORS origins.
3. **Progress** — the wizard automatically:
   - Creates a DNS CNAME record for your custom domain
   - Adds a worker route
   - Creates a Cloudflare Access application with your user allowlist
   - Derives and stores R2 credentials
   - Generates an admin secret

**Save the admin secret** shown on the success screen — it's only displayed once and is needed for admin operations.

The wizard uses upsert patterns for DNS and Access, so you can safely re-run it without deleting existing resources.

### Manual Deploy (Alternative)

If you prefer not to use GitHub Actions:

```bash
git clone https://github.com/your-username/claudeflare.git
cd claudeflare
npm install && cd web-ui && npm install && cd ..

# Requires Docker for container image build
npm run deploy:docker
```

Then set the API token as a worker secret:
```bash
echo "your-token" | npx wrangler secret put CLOUDFLARE_API_TOKEN
```

### CI/CD (GitHub Actions)

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `deploy.yml` | Manual | Full deploy: tests + typecheck + Docker build + wrangler deploy + set CLOUDFLARE_API_TOKEN secret |
| `test.yml` | Pull requests | Tests + typecheck only (no deploy) |
| `e2e.yml` | Manual | E2E tests against a deployed worker |

## Configuration

All secrets are set automatically by the deploy workflow (`CLOUDFLARE_API_TOKEN`) and the setup wizard (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `ADMIN_SECRET`). See [Getting Started](#getting-started) for the full setup flow.

The only optional manual secret is `ENCRYPTION_KEY` (AES-256 key for encrypting credentials at rest).

### Environment Variables (wrangler.toml)

| Variable | Description |
|----------|-------------|
| `DEV_MODE` | Set to `"true"` to bypass Access auth (dev only) |
| `ALLOWED_ORIGINS` | Static CORS origin patterns (defaults to `".workers.dev"`). Additional origins are managed dynamically via the setup wizard and stored in KV. |

### CORS

CORS origins are managed dynamically. During setup, the wizard automatically adds your custom domain and `.workers.dev` to the allowed origins list (stored in KV). Any additional origins you provide in the Configure step are included too.

The `ALLOWED_ORIGINS` env var in `wrangler.toml` serves as a static fallback — you shouldn't need to edit it.

> **Note:** `R2_ACCOUNT_ID` and `R2_ENDPOINT` are resolved dynamically at runtime (env vars with KV fallback).
> For local dev, set them in `.dev.vars`.

## Development

```bash
# Run locally (requires Docker)
npm run dev

# Type checking
npm run typecheck

# Run unit tests
npm test

# Run E2E tests (against deployed worker)
npm run test:e2e
```

## Testing

### Backend Unit Tests

Located in `src/__tests__/`. Uses Vitest with Cloudflare Workers pool.

```bash
npm test
```

Tests cover:
- Constants validation (ports, session ID patterns)
- Container helper functions
- Type guards for runtime validation
- Error types (AppError hierarchy)
- Circuit breaker pattern
- Exponential backoff logic
- Auth middleware (user allowlist checks)
- Edge-level redirect (GET / -> 302 /setup)
- Setup, session, and user management route handlers

### Frontend Unit Tests

Located in `web-ui/src/__tests__/`. Uses Vitest with SolidJS Testing Library.

```bash
cd web-ui && npm test
```

Tests cover:
- UI components (Button, Input, SessionCard, etc.)
- Store logic (terminal, session, setup)
- API client and contract validation

### E2E UI Tests

Located in `e2e/ui/`. Uses Puppeteer against the deployed worker to test user journeys: layout, session management, terminal interactions, settings panel, and setup wizard.

```bash
ACCOUNT_SUBDOMAIN=your-subdomain npm run test:e2e:ui
```

### E2E API Tests

Located in `e2e/`. Tests API endpoints against the deployed worker.

```bash
# Set your account subdomain (found in CF dashboard > Workers & Pages > Overview)
ACCOUNT_SUBDOMAIN=your-subdomain npm run test:e2e

# With a custom worker name
ACCOUNT_SUBDOMAIN=your-subdomain CLOUDFLARE_WORKER_NAME=my-worker npm run test:e2e
```

> **Important:** E2E tests require:
> 1. `DEV_MODE = "true"` deployed to the worker (bypasses internal auth)
> 2. **No Cloudflare Access on the workers.dev domain** -- if you enabled one-click Access on workers.dev, E2E requests will be blocked at the edge before reaching the worker. Disable it or use a test-specific URL.
> 3. Re-deploy with `DEV_MODE = "false"` after testing

## Container Specs

- **Instance type:** Custom (1 vCPU, 3 GiB RAM, 4 GB disk)
- **Base image:** Node.js 22 Alpine
- **Included tools:** git, gh, vim, neovim, ripgrep, fd, tmux, btop, lazygit, yazi
- **Cost:** ~$56/container/month while running

## API Endpoints

**Session Management**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions` | Create session (rate limited) |
| `GET` | `/api/sessions/:id` | Get a specific session |
| `PATCH` | `/api/sessions/:id` | Update session (e.g., rename) |
| `DELETE` | `/api/sessions/:id` | Delete session and destroy its container |
| `POST` | `/api/sessions/:id/touch` | Update lastAccessedAt timestamp |
| `GET` | `/api/sessions/:id/start` | Start session container |
| `POST` | `/api/sessions/:id/stop` | Stop session (kills PTY, container sleeps naturally) |
| `GET` | `/api/sessions/:id/status` | Get session and container status |

**Container Lifecycle**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/container/start` | Start a container (non-blocking) |
| `POST` | `/api/container/explicit-start` | Explicitly start container (blocking) |
| `POST` | `/api/container/destroy` | Destroy a container (SIGKILL) |
| `GET` | `/api/container/startup-status` | Poll startup progress |
| `GET` | `/api/container/health` | Health check |
| `GET` | `/api/container/state` | Get container state (DEV_MODE) |
| `GET` | `/api/container/debug` | Debug info (DEV_MODE) |
| `GET` | `/api/container/sync-log` | Get rclone sync log (DEV_MODE) |
| `GET` | `/api/container/mount-test` | Test mount (DEV_MODE) |

**Terminal**

| Method | Path | Description |
|--------|------|-------------|
| `WS` | `/api/terminal/:sessionId-:terminalId/ws` | Terminal WebSocket (compound ID) |
| `GET` | `/api/terminal/:sessionId/status` | Terminal connection status |

**User Management**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/user` | Get authenticated user info |
| `GET` | `/api/users` | List allowed users |
| `POST` | `/api/users` | Add allowed user |
| `DELETE` | `/api/users/:email` | Remove allowed user |

**Setup (No Auth Required)**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/setup/status` | Check setup status (`{ configured, tokenDetected }`) |
| `GET` | `/api/setup/detect-token` | Auto-detect token from env |
| `POST` | `/api/setup/configure` | Run configuration (`{ customDomain, allowedUsers, allowedOrigins? }`) |
| `POST` | `/api/setup/reset` | Reset setup state (requires ADMIN_SECRET) |
| `POST` | `/api/setup/reset-for-tests` | Reset for E2E tests (DEV_MODE) |
| `POST` | `/api/setup/restore-for-tests` | Restore after E2E tests (DEV_MODE) |

**Admin**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/destroy-by-id` | Kill zombie container by raw DO ID (requires ADMIN_SECRET) |

**Credentials (DEV_MODE)**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/credentials` | Check credential status |
| `POST` | `/api/credentials` | Upload credentials |
| `DELETE` | `/api/credentials` | Remove credentials |

**Health**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Worker health check |
| `GET` | `/api/health` | API health check (with timestamp) |

## Project Structure

```
src/
  index.ts                    # Hono router entry point
  types.ts                    # TypeScript types (Env, AccessUser, Session, etc.)
  routes/
    container/                # Container lifecycle API
      index.ts                # Route aggregator
      lifecycle.ts            # Start, destroy, stop endpoints
      status.ts               # Health, state, startup-status, sync-log
      debug.ts                # Debug endpoints (DEV_MODE gated)
      shared.ts               # Shared types and container circuit breaker
    session/                  # Session API
      index.ts                # Route aggregator with shared auth middleware
      crud.ts                 # GET/POST/PATCH/DELETE session endpoints
      lifecycle.ts            # Start/stop/status session endpoints
    admin.ts                  # Admin-only endpoints (destroy-by-id)
    terminal.ts               # Terminal WebSocket proxy
    setup.ts                  # Setup wizard API routes
    credentials.ts            # Credential management (DEV_MODE gated)
    user.ts                   # User info endpoint
    users.ts                  # User management API (GET/POST/DELETE)
  middleware/
    auth.ts                   # Auth middleware (checks user allowlist in KV)
    rate-limit.ts             # Per-user rate limiting middleware
  lib/
    access.ts                 # CF Access auth helpers (getUserFromRequest, getBucketName)
    access-policy.ts          # Shared user/Access operations helper
    backoff.ts                # Exponential backoff with jitter
    circuit-breaker.ts        # Circuit breaker pattern
    circuit-breakers.ts       # Pre-configured circuit breaker instances
    constants.ts              # Centralized config values (ports, patterns, timeouts)
    container-helpers.ts      # Container init helpers (getContainerContext, getContainerId)
    cors-cache.ts             # In-memory CORS origins cache
    crypto.ts                 # AES-GCM encryption utilities
    error-types.ts            # Centralized error classes (AppError hierarchy)
    errors.ts                 # Standardized error/success response helpers
    kv-keys.ts                # KV key utilities (getSessionKey, generateSessionId)
    logger.ts                 # Structured JSON logging
    r2-admin.ts               # R2 bucket management via Cloudflare API
    r2-config.ts              # Dynamic R2 endpoint resolution (env + KV fallback)
    type-guards.ts            # Runtime type validation
  container/
    index.ts                  # ClaudeflareContainer Durable Object class
  __tests__/                  # 14 test files covering lib, middleware, routes
    index.test.ts             # Edge-level redirect tests
    lib/
      backoff.test.ts
      circuit-breaker.test.ts
      constants.test.ts
      container-helpers.test.ts
      crypto.test.ts
      error-types.test.ts
      logger.test.ts
      r2-config.test.ts
      type-guards.test.ts
    middleware/
      auth.test.ts
      rate-limit.test.ts
    routes/
      session.test.ts
      setup.test.ts
      users.test.ts

web-ui/
  src/
    index.tsx                 # SolidJS entry point
    App.tsx                   # Root component
    types.ts                  # Frontend types
    components/
      Layout.tsx              # Main layout (Header + AppSidebar + TerminalArea)
      Header.tsx              # App header with logo and settings
      StatusBar.tsx           # Connection status, sync time, shortcuts
      AppSidebar.tsx          # Sidebar wrapper
      TerminalArea.tsx        # Terminal section wrapper
      SessionList.tsx         # Session list with search
      SessionCard.tsx         # Individual session card
      Terminal.tsx            # xterm.js wrapper
      TerminalTabs.tsx        # Tab bar with icons and animations
      InitProgress.tsx        # Session init progress modal
      SettingsPanel.tsx       # Slide-out settings panel (includes User Management)
      TilingButton.tsx        # Tiling mode toggle button
      TilingOverlay.tsx       # Layout selection dropdown
      TiledTerminalContainer.tsx  # Multi-terminal grid renderer
      TiledTerminalContainer.css  # Tiling grid styles
      EmptyState.tsx          # Reusable empty state component
      EmptyStateVariants.tsx  # Pre-built empty states
      Icon.tsx                # SVG icon wrapper for MDI
      ui/                     # Base UI components
        index.ts              # Barrel export
        Button.tsx
        IconButton.tsx
        Input.tsx
        Badge.tsx
        Card.tsx
        Skeleton.tsx
        Tooltip.tsx
      setup/                  # Setup wizard (3-step flow)
        SetupWizard.tsx
        WelcomeStep.tsx       # Auto-detects token on mount
        ConfigureStep.tsx     # Custom domain + email tags + allowed origins
        ProgressStep.tsx
    stores/
      terminal.ts             # WebSocket state, compound keys
      session.ts              # Session CRUD, tiling, metrics polling
      setup.ts                # Setup wizard state
    api/
      client.ts               # API client with Zod validation
    lib/
      constants.ts            # Frontend constants (polling intervals, timeouts)
      schemas.ts              # Zod validation schemas for API responses
      terminal-config.ts      # TERMINAL_TAB_CONFIG (tab names, icons)
    styles/
      design-tokens.css       # CSS variables (colors, spacing, typography)
      animations.css          # Keyframes and animation utilities
      components.css          # Shared component styles
      session-list.css        # SessionList/SessionCard styles
      init-progress.css       # InitProgress modal styles
      settings-panel.css      # SettingsPanel styles
    index.css                 # Global styles (imports design tokens)
    __tests__/                # ~25 test files covering components, stores, API
      setup.ts                # Test setup (jsdom, mocks)
      smoke.test.ts
      utils/
        render.tsx            # SolidJS test render helper
        mocks.ts              # Shared mocks
      components/
        Badge.test.tsx
        Button.test.tsx
        EmptyState.test.tsx
        Header.test.tsx
        IconButton.test.tsx
        InitProgress.test.tsx
        Input.test.tsx
        SessionList.test.tsx
        SettingsPanel.test.tsx
        StatusBar.test.tsx
        Terminal.test.tsx
        TerminalTabs.test.tsx
        TiledTerminalContainer.test.tsx
        TilingButton.test.tsx
        TilingOverlay.test.tsx
      stores/
        terminal.test.ts
        session.test.ts
        setup.test.ts
        session-tiling.test.ts
        session-ready-detection.test.ts
      api/
        client.test.ts
        contract.test.ts
  vitest.config.ts            # Frontend test config (jsdom + SolidJS)

e2e/
  config.ts                   # Shared config (BASE_URL construction)
  setup.ts                    # E2E test setup (apiRequest helper)
  api.test.ts                 # E2E API tests
  helpers/
    test-utils.ts             # Cleanup helpers (cleanupAllSessions, restoreSetupComplete)
  ui/
    setup.ts                  # Puppeteer helpers (launchBrowser, navigateTo)
    helpers.ts                # UI test utilities (waitForSelector, click)
    layout.test.ts
    session-management.test.ts
    session-card-enhancements.test.ts
    terminal-interaction.test.ts
    settings-panel.test.ts
    setup-wizard.test.ts
    tiling.test.ts
    full-journey.test.ts
    error-handling.test.ts
    request-tracing.test.ts
    rate-limiting.test.ts

host/
  server.js                   # PTY terminal server (node-pty + WebSocket, runs in container)
  package.json                # Terminal server dependencies

Dockerfile                    # Container image definition
entrypoint.sh                 # Container startup script
wrangler.toml                 # Cloudflare configuration
vitest.config.ts              # Backend unit test config (Workers pool)
vitest.e2e.config.ts          # E2E test config
```

## Documentation

| Document | Description |
|----------|-------------|
| [TECHNICAL.md](./TECHNICAL.md) | Architecture, data flow, sync strategy, troubleshooting |

## License

MIT
