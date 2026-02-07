# Claudeflare Container - Multi-session terminal server with rclone sync
# Uses node-pty for PTY management and rclone for R2 storage sync

FROM node:22-alpine

# Install rclone, build tools for node-pty, and development tools
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
    wget \
    openssh-client \
    # Build tools
    make \
    gcc \
    g++ \
    python3 \
    nodejs \
    npm \
    # Utilities
    jq \
    ripgrep \
    fd \
    tree \
    btop \
    htop \
    tmux \
    fzf \
    zoxide \
    # Yazi preview dependencies
    file \
    ffmpeg \
    p7zip \
    poppler-utils \
    imagemagick \
    bat \
    && apk add --no-cache yazi --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing \
    && apk add --no-cache lazygit --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community

# Install claude-unleashed globally (wraps Claude Code with permission bypass)
# Provides 'cu' command with --silent --no-consent for non-interactive use
RUN npm install -g github:nikolanovoselec/claude-unleashed

# Create 'claude' wrapper that uses claude-unleashed transparently
# Users type 'claude' as usual, gets unleashed mode under the hood
RUN echo '#!/bin/bash' > /usr/local/bin/claude && \
    echo 'export IS_SANDBOX=1' >> /usr/local/bin/claude && \
    echo 'export DISABLE_INSTALLATION_CHECKS=1' >> /usr/local/bin/claude && \
    echo 'exec cu --silent --no-consent "$@"' >> /usr/local/bin/claude && \
    chmod +x /usr/local/bin/claude

# Create workspace directory structure
RUN mkdir -p /app/host

# Copy host server files
COPY host/package.json /app/host/
COPY host/server.js /app/host/

# Install host dependencies
WORKDIR /app/host
RUN npm install --production

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

# Force rebuild: consent-fix-restore-1770350000
