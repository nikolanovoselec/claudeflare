# Claudeflare Container - Multi-session terminal server with rclone sync
# Uses node-pty for PTY management and rclone for R2 storage sync

# ---- Stage 1: Builder (compile native addons) ----
FROM node:22-alpine AS builder

RUN apk add --no-cache make gcc g++ python3

COPY host/package.json /app/host/
WORKDIR /app/host
RUN npm install --production

# ---- Stage 2: Runtime ----
FROM node:22-alpine

# Suppress npm update nag; configure claude-unleashed for non-interactive container use
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV CLAUDE_UNLEASHED_SKIP_CONSENT=1
ENV DISABLE_INSTALLATION_CHECKS=1
ENV IS_SANDBOX=1

# Install runtime packages (no build tools needed - native addons pre-compiled)
RUN apk add --no-cache \
    # System essentials
    rclone \
    ca-certificates \
    bash \
    # Version control
    git \
    github-cli \
    # Editors
    vim \
    nano \
    neovim \
    ncurses \
    ncurses-terminfo-base \
    ncurses-terminfo \
    # Network tools
    curl \
    openssh-client \
    # Utilities
    jq \
    ripgrep \
    fd \
    tree \
    htop \
    tmux \
    fzf \
    zoxide \
    # Yazi preview dependencies
    file \
    p7zip \
    bat \
    && apk add --no-cache yazi --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing \
    && apk add --no-cache lazygit --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community

# Install claude-unleashed globally (wraps Claude Code with permission bypass)
# Ships with Claude Code 2.1.25 baseline; auto-update disabled for fast startup
# Users can update manually by running `cu` or `claude-unleashed` in any terminal tab
RUN npm install -g github:nikolanovoselec/claude-unleashed

# Create 'claude' wrapper that uses claude-unleashed transparently
# Users type 'claude' as usual, gets unleashed mode under the hood
# Global env: CLAUDE_UNLEASHED_SKIP_CONSENT. Auto-start adds SILENT + NO_UPDATE.
RUN printf '#!/bin/bash\nexec cu "$@"\n' > /usr/local/bin/claude && \
    chmod +x /usr/local/bin/claude

# Create workspace directory structure
RUN mkdir -p /app/host

# Copy pre-compiled host server from builder stage
COPY --from=builder /app/host/node_modules /app/host/node_modules
COPY host/package.json /app/host/
COPY host/server.js /app/host/

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && echo "Build timestamp $(date)" > /build-timestamp.txt

# Reset working directory
WORKDIR /

# Expose port 8080: Terminal server (handles WebSocket + health/metrics)
EXPOSE 8080

# Graceful shutdown
STOPSIGNAL SIGINT

# Run as root to allow fuse mount
ENTRYPOINT ["/entrypoint.sh"]
