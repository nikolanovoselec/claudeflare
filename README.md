# Claudeflare

Run Claude Code in your browser via Cloudflare Containers.

## Why

Running Claude Code typically requires a local terminal setup. Claudeflare removes that barrier -- it gives you a full Claude Code CLI in the browser, backed by isolated containers on Cloudflare's edge. Each session gets its own container with persistent storage, so your credentials, config, and workspace sync automatically across sessions via R2.

## Features

- **Browser-based Claude Code** -- full CLI running in Cloudflare Containers
- **Multiple sessions** -- open several Claude instances in parallel, each in its own container
- **Nested terminals** -- up to 6 tabs per session (Claude + htop + yazi + bash)
- **YOLO mode** -- runs with `--dangerously-skip-permissions` for uninterrupted workflows
- **Persistent storage** -- credentials, config, and workspace sync to R2 across sessions
- **Fast startup** -- per-session containers with config-only sync (~0.2s)
- **Dev tools included** -- git, gh, neovim, ripgrep, tmux, yazi, lazygit, and more

## Deploy

> ![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)
>
> The one-click deploy button doesn't work for this project. Cloudflare's deploy button can't provision Durable Objects, KV namespaces, R2 buckets, or secrets — all of which claudeflare requires. **Use GitHub Actions instead** (below) — it handles the full setup automatically, including bindings and secrets, with automated redeploys on every push.

### Requirements

- Cloudflare account with Workers Paid plan (~$5/month base)
- Claude Max subscription for Claude Code CLI access
- A domain with its DNS zone in Cloudflare

### 1. Create a Cloudflare API Token

Go to [Cloudflare Dashboard > My Profile > API Tokens](https://dash.cloudflare.com/profile/api-tokens) and create a custom token with these permissions:

| Scope | Permission | Access |
|-------|------------|--------|
| Account | Account Settings | Read |
| Account | Workers Scripts | Edit |
| Account | Workers KV Storage | Edit |
| Account | Workers R2 Storage | Edit |
| Account | Containers | Edit |
| Account | Access: Apps and Policies | Edit |
| Zone | Zone | Read |
| Zone | DNS | Edit |
| Zone | Workers Routes | Edit |

### 2. Fork and Configure GitHub

Fork this repo and add the following in Settings > Secrets and variables > Actions:

**Secrets:**
- `CLOUDFLARE_API_TOKEN` -- the API token from step 1
- `CLOUDFLARE_ACCOUNT_ID` -- your Cloudflare account ID (found on any Workers page)

**Variables (optional):**
- `CLOUDFLARE_WORKER_NAME` -- custom worker name (defaults to `claudeflare`)

### 3. Deploy

Go to **Actions > Deploy** and click **Run workflow** on `main`.

### 4. Run the Setup Wizard

Visit your worker URL (`https://<worker-name>.<subdomain>.workers.dev`) and follow the wizard:

1. **Welcome** -- auto-detects your API token
2. **Configure** -- enter your custom domain, allowed emails, and optional CORS origins
3. **Progress** -- automatically creates DNS records, Access policies, R2 credentials, and admin secret

Save the admin secret shown on the success screen -- it is only displayed once.

### Manual Deploy (Alternative)

```bash
git clone https://github.com/your-username/claudeflare.git
cd claudeflare
npm install && cd web-ui && npm install && cd ..
npm run deploy:docker
echo "your-token" | npx wrangler secret put CLOUDFLARE_API_TOKEN
```

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
+---------------------------+
```

## Cost

~$56/container/month (1 vCPU, 3 GiB RAM). Cost scales per active session -- idle containers hibernate after 30 minutes.

## Documentation

See [TECHNICAL.md](./TECHNICAL.md) for architecture details, API reference, development setup, testing, configuration, and troubleshooting.

## License

MIT
