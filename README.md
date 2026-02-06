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

- **Cloudflare Account** with Workers Paid plan (~$5/month base)
- **Claude Max subscription** for Claude Code CLI access

### API Token Permissions

The Cloudflare API token (set via GitHub Actions secret) requires these permissions:

- Account > Workers Scripts > Edit
- Account > Workers R2 Storage > Edit
- Account > Workers KV Storage > Edit
- Account > Containers > Edit
- Account > Access: Apps and Policies > Edit
- Zone > Zone > Read
- Zone > DNS > Edit
- Zone > Workers Routes > Edit

All permissions are required because custom domain configuration is mandatory.

## Deployment

### One-Click Deploy

> ![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)
>
> This button is intentionally not a link. Cloudflare Containers are a new feature
> and one-click deploy doesn't support container image builds yet. I expect support
> will be added in the future. For now, use GitHub Actions below — it takes 2 minutes.

### GitHub Actions (Recommended)

Deployment is handled via GitHub Actions. Fork the repo, configure secrets, and push to main.

### Manual Deploy

```bash
# Clone the repo
git clone https://github.com/your-username/claudeflare.git
cd claudeflare

# Install dependencies
npm install
cd web-ui && npm install && cd ..

# Full deploy (builds container image + Worker + assets)
# Requires Docker for container image build
npm run deploy:docker
```

After deployment, visit your worker URL to complete the setup wizard.

### CI/CD (GitHub Actions)

The repo includes GitHub Actions workflows:

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `deploy.yml` | Push to main, manual | Full deploy: tests + typecheck + Docker build + wrangler deploy + set CLOUDFLARE_API_TOKEN secret |
| `test.yml` | Pull requests | Tests + typecheck only (no deploy) |
| `e2e.yml` | Manual | E2E tests against a deployed worker |

**Required GitHub Secrets:**

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers Scripts Edit + R2 Edit permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

**Optional GitHub Variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDFLARE_WORKER_NAME` | No | Custom worker name for forks (defaults to `claudeflare`) |
| `ACCOUNT_SUBDOMAIN` | For E2E | Your Cloudflare account subdomain (Workers & Pages → Overview) |

### Setup Wizard

After deployment, the setup wizard guides you through initial configuration (3 steps):

1. **Welcome** - Auto-detects the Cloudflare API token from the worker environment (`CLOUDFLARE_API_TOKEN`, set by GitHub Actions)
2. **Configure** - Enter your custom domain (required), allowed user emails, and optional allowed origins
3. **Progress** - The wizard automatically:
   - Creates a DNS CNAME record pointing to your workers.dev URL
   - Adds a worker route for the custom domain
   - Creates a Cloudflare Access application with user allowlist
   - Derives and stores R2 credentials and admin secret

The token is never entered manually -- it is read from `c.env.CLOUDFLARE_API_TOKEN` which is set as a worker secret by the GitHub Actions deploy workflow.

The setup uses an upsert pattern, so you can re-run it without manually deleting existing DNS records or Access apps.

## Configuration

### Wrangler Secrets

| Secret | Set By | Description |
|--------|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions (`deploy.yml`) | API token for R2 bucket creation |
| `R2_ACCESS_KEY_ID` | Setup wizard | Derived from API token ID |
| `R2_SECRET_ACCESS_KEY` | Setup wizard | SHA-256 hash of API token |
| `ADMIN_SECRET` | Setup wizard | Generated randomly for admin endpoints |
| `ENCRYPTION_KEY` | Manual (optional) | AES-256 key for encrypting credentials at rest |

### Environment Variables (wrangler.toml)

| Variable | Description |
|----------|-------------|
| `DEV_MODE` | Set to "true" to bypass Access auth (dev only) |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated patterns, e.g., ".workers.dev,.example.com") |

> **Note:** `R2_ACCOUNT_ID`, `R2_ENDPOINT`, and `SERVICE_TOKEN_EMAIL` are no longer in wrangler.toml.
> R2 config is resolved dynamically (env → KV fallback). For local dev, use `.dev.vars`.

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

### E2E Tests

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

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/container/start` | Start a container |
| `POST` | `/api/container/destroy` | Destroy a container |
| `GET` | `/api/container/state` | Get container state |
| `GET` | `/api/container/health` | Health check |
| `GET` | `/api/container/startup-status` | Poll startup progress |
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions` | Create session |
| `DELETE` | `/api/sessions/:id` | Delete session |
| `GET` | `/api/user` | Get authenticated user |
| `GET` | `/api/users` | List allowed users |
| `POST` | `/api/users` | Add allowed user |
| `DELETE` | `/api/users/:email` | Remove allowed user |
| `GET` | `/api/setup/status` | Check setup status (`{ configured, tokenDetected }`) |
| `GET` | `/api/setup/detect-token` | Auto-detect token from env |
| `POST` | `/api/setup/configure` | Run configuration (`{ customDomain, allowedUsers, allowedOrigins? }`) |
| `WS` | `/api/terminal/:sessionId-:terminalId/ws` | Terminal WebSocket (compound ID) |

## Project Structure

```
src/
  index.ts              # Hono router entry point
  types.ts              # TypeScript types
  routes/               # API route handlers
    container/          # Container lifecycle (start, stop, health)
    session/            # Session CRUD and lifecycle
    admin.ts            # Admin-only endpoints
    users.ts            # User management API (GET/POST/DELETE)
  middleware/           # Shared middleware
    auth.ts             # Authentication middleware (checks user allowlist in KV)
    rate-limit.ts       # Rate limiting middleware
  lib/                  # Utility modules
    constants.ts        # Centralized config values
    container-helpers.ts # Container initialization helpers
    errors.ts           # Standardized error responses
    error-types.ts      # Centralized error classes (AppError, etc.)
    type-guards.ts      # Runtime type validation
    access.ts           # Auth helpers
    access-policy.ts    # Shared user/Access operations helper
    r2-admin.ts         # R2 bucket management
    kv-keys.ts          # KV key utilities
    circuit-breaker.ts  # Circuit breaker for resilience
    logger.ts           # Structured JSON logging
    backoff.ts          # Exponential backoff with jitter
    crypto.ts           # AES-GCM encryption utilities
  container/            # Container Durable Object
  __tests__/            # Unit tests (lib + middleware + routes)
    index.test.ts       # Edge-level redirect tests
    middleware/
      auth.test.ts      # Auth middleware tests
    routes/
      users.test.ts     # User management route tests

e2e/
  setup.ts              # E2E test setup
  api.test.ts           # E2E API tests

host/
  server.js             # PTY terminal server (runs in container)

web-ui/
  src/                  # SolidJS frontend with xterm.js
    components/         # Terminal, SessionCard, Layout, AppSidebar, TerminalArea
      setup/            # Setup wizard steps
        SetupWizard.tsx
        WelcomeStep.tsx     # Auto-detects token on mount
        ConfigureStep.tsx   # Custom domain + email tags + allowed origins
        ProgressStep.tsx
    stores/             # Session, terminal, setup state management
    api/                # API client
    lib/                # Frontend constants, Zod schemas, terminal config

Dockerfile              # Container image definition
entrypoint.sh           # Container startup script
wrangler.toml           # Cloudflare configuration
vitest.config.ts        # Unit test config
vitest.e2e.config.ts    # E2E test config
```

## Documentation

| Document | Description |
|----------|-------------|
| [TECHNICAL.md](./TECHNICAL.md) | Architecture, data flow, sync strategy, troubleshooting |

## License

MIT
