#!/bin/bash
# Build: 2026-02-04.8 - Single port (8080) for all services
BUILD_VERSION="2026-02-04.8"
# Claudeflare Container Entrypoint - rclone bisync version
# Health metrics now consolidated into terminal server on port 8080

echo "[entrypoint] ============================================"
echo "[entrypoint] BUILD VERSION: $BUILD_VERSION"
echo "[entrypoint] ============================================"
echo "[entrypoint] Starting claudeflare container..."
echo "[entrypoint] Bash version: $BASH_VERSION"
echo "[entrypoint] Date: $(date)"
echo "[entrypoint] PWD: $(pwd)"

# Initialize PID placeholders
TERMINAL_PID=0
SYNC_DAEMON_PID=0

echo "[entrypoint] pwd: $(pwd)"
echo "[entrypoint] HOME: $HOME"
echo "[entrypoint] node version: $(node --version)"

# Check R2 environment variables (configured/missing status only)
echo "[entrypoint] === R2 ENV STATUS ===" | tee /tmp/sync.log
echo "R2_BUCKET_NAME: ${R2_BUCKET_NAME:+configured}" | tee -a /tmp/sync.log
echo "R2_ENDPOINT: ${R2_ENDPOINT:+configured}" | tee -a /tmp/sync.log
echo "R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID:+configured}" | tee -a /tmp/sync.log
echo "R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY:+configured}" | tee -a /tmp/sync.log
echo "R2_ACCOUNT_ID: ${R2_ACCOUNT_ID:+configured}" | tee -a /tmp/sync.log
echo "[entrypoint] === END R2 ENV STATUS ===" | tee -a /tmp/sync.log

# Set TERM for proper terminal handling
TERM=xterm-256color
export TERM

# User directories (local disk)
USER_HOME="/home/user"
USER_WORKSPACE="$USER_HOME/workspace"
USER_CLAUDE_DIR="$USER_HOME/.claude"
USER_CLAUDE_JSON="$USER_HOME/.claude.json"

# Create user home directory structure
mkdir -p "$USER_HOME" "$USER_WORKSPACE" "$USER_CLAUDE_DIR"
export HOME="$USER_HOME"

# Track sync status
SYNC_STATUS="pending"
SYNC_ERROR=""
SYNC_DAEMON_PID=""

# ============================================================================
# rclone configuration
# ============================================================================
create_rclone_config() {
    echo "[entrypoint] Creating rclone config..."

    # Check required variables
    if [ -z "$R2_ACCESS_KEY_ID" ]; then
        SYNC_ERROR="R2_ACCESS_KEY_ID not set"
        SYNC_STATUS="skipped"
        echo "[entrypoint] WARNING: $SYNC_ERROR"
        return 1
    fi

    if [ -z "$R2_SECRET_ACCESS_KEY" ]; then
        SYNC_ERROR="R2_SECRET_ACCESS_KEY not set"
        SYNC_STATUS="skipped"
        echo "[entrypoint] WARNING: $SYNC_ERROR"
        return 1
    fi

    if [ -z "$R2_BUCKET_NAME" ]; then
        SYNC_ERROR="R2_BUCKET_NAME not set"
        SYNC_STATUS="skipped"
        echo "[entrypoint] WARNING: $SYNC_ERROR"
        return 1
    fi

    if [ -z "$R2_ENDPOINT" ]; then
        SYNC_ERROR="R2_ENDPOINT not set"
        SYNC_STATUS="skipped"
        echo "[entrypoint] WARNING: $SYNC_ERROR"
        return 1
    fi

    echo "[entrypoint] R2 credentials: configured"

    # Create rclone config directory
    mkdir -p "$USER_HOME/.config/rclone"

    # Write rclone config
    cat > "$USER_HOME/.config/rclone/rclone.conf" << EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = $R2_ACCESS_KEY_ID
secret_access_key = $R2_SECRET_ACCESS_KEY
endpoint = $R2_ENDPOINT
acl = private
no_check_bucket = true
EOF

    chmod 600 "$USER_HOME/.config/rclone/rclone.conf"
    echo "[entrypoint] rclone config created"
    return 0
}

# ============================================================================
# Sync functions - rclone bisync with newest-wins
# ============================================================================

# Initialize sync log
init_sync_log() {
    echo "=== Sync Log Started: $(date '+%Y-%m-%d %H:%M:%S') ===" > /tmp/sync.log
}

# Rclone config path (set after create_rclone_config)
RCLONE_CONFIG="$USER_HOME/.config/rclone/rclone.conf"

# Step 1: One-way sync FROM R2 TO local (restore user data)
# This ensures existing credentials, plugins, etc. are restored BEFORE anything else runs
# Excludes workspace folder - workspace is ephemeral per-session
# IMPORTANT: Uses timeout to prevent infinite hangs on network issues
initial_sync_from_r2() {
    local SYNC_TIMEOUT=120  # 2 minutes max for initial sync
    echo "[entrypoint] Step 1: One-way sync R2 → local (max ${SYNC_TIMEOUT}s)..." | tee -a /tmp/sync.log

    timeout $SYNC_TIMEOUT rclone sync "r2:$R2_BUCKET_NAME/" "$USER_HOME/" \
        --config "$RCLONE_CONFIG" \
        --exclude ".config/rclone/**" \
        --exclude ".cache/rclone/**" \
        --exclude ".npm/**" \
        --exclude "**/node_modules/**" \
        --exclude "workspace/**" \
        --fast-list \
        --size-only \
        --multi-thread-streams 4 \
        --transfers 32 \
        --checkers 32 \
        --contimeout 10s \
        --timeout 30s \
        -v 2>&1 | tee -a /tmp/sync.log

    SYNC_RESULT=$?
    if [ $SYNC_RESULT -eq 0 ]; then
        echo "[entrypoint] Step 1 complete: User data restored from R2"
        return 0
    elif [ $SYNC_RESULT -eq 124 ]; then
        SYNC_ERROR="rclone sync timed out after ${SYNC_TIMEOUT}s"
        echo "[entrypoint] WARNING: $SYNC_ERROR (continuing anyway)"
        return 0  # Don't block startup
    else
        SYNC_ERROR="rclone sync R2→local failed with code $SYNC_RESULT"
        echo "[entrypoint] WARNING: $SYNC_ERROR"
        return 1
    fi
}

# Step 2: Establish bisync baseline (after data is restored)
# IMPORTANT: Uses timeout to prevent infinite hangs
establish_bisync_baseline() {
    local BISYNC_TIMEOUT=180  # 3 minutes max for baseline
    echo "[entrypoint] Step 2: Establishing bisync baseline (max ${BISYNC_TIMEOUT}s)..." | tee -a /tmp/sync.log

    timeout $BISYNC_TIMEOUT rclone bisync "$USER_HOME/" "r2:$R2_BUCKET_NAME/" \
        --config "$RCLONE_CONFIG" \
        --exclude ".config/rclone/**" \
        --exclude ".cache/rclone/**" \
        --exclude ".npm/**" \
        --exclude "**/node_modules/**" \
        --exclude "workspace/**" \
        --resync \
        --fast-list \
        --conflict-resolve newer \
        --resilient \
        --recover \
        --contimeout 10s \
        --timeout 30s \
        --transfers 32 --checkers 32 -v 2>&1 | tee -a /tmp/sync.log

    SYNC_RESULT=$?
    if [ $SYNC_RESULT -eq 0 ]; then
        echo "[entrypoint] Step 2 complete: Bisync baseline established"
        touch /tmp/.bisync-initialized
        SYNC_STATUS="success"
        return 0
    elif [ $SYNC_RESULT -eq 124 ]; then
        echo "[entrypoint] WARNING: Bisync baseline timed out after ${BISYNC_TIMEOUT}s"
        SYNC_STATUS="timeout"
        return 0  # Don't fail, just skip daemon
    else
        SYNC_ERROR="rclone bisync --resync failed with code $SYNC_RESULT"
        SYNC_STATUS="failed"
        echo "[entrypoint] ERROR: $SYNC_ERROR"
        return 1
    fi
}

# Regular bisync (after baseline is established)
# Syncs config, credentials - excludes caches and workspace
bisync_with_r2() {
    echo "[sync] Running bidirectional sync..." | tee -a /tmp/sync.log

    # Write output to temp file so we can capture exit code AND log it
    SYNC_OUTPUT=$(mktemp)

    # First try normal bisync
    rclone bisync "$USER_HOME/" "r2:$R2_BUCKET_NAME/" \
        --config "$RCLONE_CONFIG" \
        --exclude ".config/rclone/**" \
        --exclude ".cache/rclone/**" \
        --exclude ".npm/**" \
        --exclude "**/node_modules/**" \
        --exclude "workspace/**" \
        --fast-list \
        --conflict-resolve newer \
        --resilient \
        --recover \
        --transfers 32 --checkers 32 -v 2>&1 > "$SYNC_OUTPUT"
    RESULT=$?
    cat "$SYNC_OUTPUT" >> /tmp/sync.log
    cat "$SYNC_OUTPUT"

    # If bisync failed (especially due to empty listing), try with --resync
    if [ $RESULT -ne 0 ]; then
        echo "[sync] Normal bisync failed (exit $RESULT), attempting --resync..." | tee -a /tmp/sync.log
        rclone bisync "$USER_HOME/" "r2:$R2_BUCKET_NAME/" \
            --config "$RCLONE_CONFIG" \
            --exclude ".config/rclone/**" \
            --exclude ".cache/rclone/**" \
            --exclude ".npm/**" \
            --exclude "**/node_modules/**" \
            --exclude "workspace/**" \
            --conflict-resolve newer \
            --resync \
            --resilient \
            --recover \
            --transfers 32 --checkers 32 -v 2>&1 > "$SYNC_OUTPUT"
        RESULT=$?
        cat "$SYNC_OUTPUT" >> /tmp/sync.log
        cat "$SYNC_OUTPUT"
    fi

    rm -f "$SYNC_OUTPUT"
    return $RESULT
}

# ============================================================================
# Background sync daemon - bisync every 60 seconds
# ============================================================================
start_sync_daemon() {
    echo "[entrypoint] Starting background bisync daemon (every 60s)..."

    while true; do
        sleep 60
        echo "[sync-daemon] $(date '+%Y-%m-%d %H:%M:%S') Running periodic bisync..." | tee -a /tmp/sync.log

        # Use bisync for true bidirectional sync with newest-wins
        bisync_with_r2
        SYNC_RESULT=$?

        if [ $SYNC_RESULT -eq 0 ]; then
            echo "[sync-daemon] $(date '+%Y-%m-%d %H:%M:%S') Bisync completed successfully" | tee -a /tmp/sync.log
        else
            echo "[sync-daemon] $(date '+%Y-%m-%d %H:%M:%S') Bisync failed with exit code $SYNC_RESULT (will retry in 60s)" | tee -a /tmp/sync.log
        fi
    done &

    SYNC_DAEMON_PID=$!
    echo "[entrypoint] Bisync daemon started with PID $SYNC_DAEMON_PID"
}

# ============================================================================
# Shutdown handler - final bisync on SIGTERM
# ============================================================================
shutdown_handler() {
    echo "[entrypoint] Received shutdown signal, performing final bisync..."

    # Kill sync daemon
    if [ -n "$SYNC_DAEMON_PID" ]; then
        kill $SYNC_DAEMON_PID 2>/dev/null
    fi

    # Perform final bisync to R2 (only if baseline was established)
    echo "[entrypoint] Final bisync to R2..."
    if [ -f /tmp/.bisync-initialized ]; then
        bisync_with_r2
        if [ $? -eq 0 ]; then
            echo "[entrypoint] Final bisync completed successfully"
        else
            echo "[entrypoint] Final bisync failed!"
        fi
    else
        echo "[entrypoint] Skipping final bisync - baseline never established"
    fi

    # Kill child processes
    if [ -n "$TERMINAL_PID" ]; then
        kill $TERMINAL_PID 2>/dev/null
    fi

    echo "[entrypoint] Shutdown complete"
    exit 0
}

# Set up shutdown trap
trap shutdown_handler SIGTERM SIGINT

# ============================================================================
# Helper function to update sync status file (read by health server)
# ============================================================================
update_sync_status() {
    # Args: status, error (raw string or "null")
    local error_val="$2"
    if [ "$error_val" = "null" ]; then
        jq -n --arg status "$1" --arg userPath "$USER_HOME" \
            '{status: $status, error: null, userPath: $userPath}' > /tmp/sync-status.json
    else
        jq -n --arg status "$1" --arg error "$error_val" --arg userPath "$USER_HOME" \
            '{status: $status, error: $error, userPath: $userPath}' > /tmp/sync-status.json
    fi
}

# ============================================================================
# Configure Claude auto-start in .bashrc
# ============================================================================
configure_claude_autostart() {
    BASHRC_FILE="$USER_HOME/.bashrc"
    BASH_PROFILE="$USER_HOME/.bash_profile"
    AUTOSTART_MARKER="# claude-autostart"

    # Ensure .bash_profile sources .bashrc (for login shells)
    if [ ! -f "$BASH_PROFILE" ] || ! grep -q "source.*bashrc\|\..*bashrc" "$BASH_PROFILE" 2>/dev/null; then
        echo "[entrypoint] Creating .bash_profile to source .bashrc..."
        cat > "$BASH_PROFILE" << 'PROFILE_EOF'
# .bash_profile - source .bashrc for login shells
if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi
PROFILE_EOF
        echo "[entrypoint] .bash_profile created"
    fi

    # Check if already configured
    if grep -q "$AUTOSTART_MARKER" "$BASHRC_FILE" 2>/dev/null; then
        echo "[entrypoint] Claude auto-start already configured in .bashrc"
        echo "already_configured" > /tmp/claude-autostart-status.txt
        return 0
    fi

    echo "[entrypoint] Adding Claude auto-start to .bashrc..."

    # Create .bashrc if it doesn't exist
    touch "$BASHRC_FILE"

    # Add auto-start configuration
    cat >> "$BASHRC_FILE" << 'BASHRC_EOF'

# terminal-autostart
# Start different apps based on terminal tab ID:
# Tab 1: Claude Code (unleashed mode)
# Tab 2: htop (system monitor)
# Tab 3: yazi (file manager)
# Tab 4-6: Plain bash terminal in workspace
if [ -t 1 ] && [ -z "$TERMINAL_APP_STARTED" ]; then
    export TERMINAL_APP_STARTED=1
    export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

    cd "$HOME/workspace" 2>/dev/null || cd "$HOME"

    case "${TERMINAL_ID:-1}" in
        1)
            # Tab 1: Claude Code (via claude-unleashed)
            # Env vars set in Dockerfile: CLAUDE_UNLEASHED_SILENT, CLAUDE_UNLEASHED_SKIP_CONSENT,
            # DISABLE_INSTALLATION_CHECKS, IS_SANDBOX. Auto-updates to latest on first run.
            cu
            # If claude exits, drop to bash (don't use exec so PTY survives)
            ;;
        2)
            # Tab 2: htop (system monitor)
            # Run in loop so it restarts after exit (e.g., pressing 'q')
            while true; do
                htop
                echo "htop exited. Press Enter to restart, or Ctrl+C for bash..."
                read -t 3 || true
            done
            ;;
        3)
            # Tab 3: yazi (file manager)
            # Run in loop so it restarts after exit (e.g., pressing 'q')
            while true; do
                yazi
                echo "yazi exited. Press Enter to restart, or Ctrl+C for bash..."
                read -t 3 || true
            done
            ;;
        *)
            # Tabs 4-6: Plain bash terminal
            # Just continue to normal bash prompt
            ;;
    esac
fi
BASHRC_EOF

    echo "configured" > /tmp/claude-autostart-status.txt
    echo "[entrypoint] Claude auto-start configured (unleashed mode)"
    return 0
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

# Create rclone config
create_rclone_config
RCLONE_CONFIG_RESULT=$?

# Initialize sync log
init_sync_log

# ============================================================================
# R2 SYNC STARTUP
# ============================================================================
# Note: claude-unleashed (cu --silent --no-consent) handles consent automatically,
# no pre-seeding needed.

if [ $RCLONE_CONFIG_RESULT -eq 0 ]; then
    # Step 1: One-way sync FROM R2 to restore user data (credentials, plugins, etc.)
    update_sync_status "syncing" "null"
    initial_sync_from_r2 &
    SYNC_PID=$!
    echo "[entrypoint] R2 sync started in background (PID $SYNC_PID)"

    # Wait for R2 sync to complete (needed before bisync baseline)
    wait $SYNC_PID
    STEP1_RESULT=$?

    if [ $STEP1_RESULT -eq 0 ]; then
        # Ensure workspace directory exists after sync
        mkdir -p "$USER_WORKSPACE"
        update_sync_status "success" "null"

        # Step 2: Establish bisync baseline IN BACKGROUND (don't block startup)
        (
            echo "[entrypoint] Establishing bisync baseline in background..."
            establish_bisync_baseline
            if [ $? -eq 0 ]; then
                echo "[entrypoint] Bisync baseline established, starting daemon..."
                start_sync_daemon
            else
                echo "[entrypoint] Bisync baseline failed, daemon not started"
            fi
        ) &
        BISYNC_INIT_PID=$!
        echo "[entrypoint] Bisync init running in background (PID $BISYNC_INIT_PID)"
    else
        update_sync_status "failed" "$SYNC_ERROR"
        # Continue anyway - servers should still start
    fi
else
    update_sync_status "skipped" "$SYNC_ERROR"
fi

# Configure Claude auto-start
configure_claude_autostart

# ============================================================================
# Start servers AFTER initial sync completes
# ============================================================================

echo "[entrypoint] Starting terminal server on port 8080..."
cd /app/host && HOME="$USER_HOME" TERMINAL_PORT=8080 node server.js &
TERMINAL_PID=$!
echo "$TERMINAL_PID" > /tmp/terminal.pid
echo "[entrypoint] Terminal server started with PID $TERMINAL_PID"

sleep 0.5

if kill -0 $TERMINAL_PID 2>/dev/null; then
    echo "[entrypoint] Terminal server is running"
else
    echo "[entrypoint] WARNING: Terminal server failed to start!"
fi

# Terminal server now handles all endpoints (health metrics consolidated)
echo "[entrypoint] Startup complete. Servers running:"
echo "[entrypoint]   - Terminal server (port 8080): PID $TERMINAL_PID"
if [ -n "$SYNC_DAEMON_PID" ]; then
    echo "[entrypoint]   - Sync daemon: PID $SYNC_DAEMON_PID"
fi

# Keep container alive by waiting for terminal server
wait $TERMINAL_PID
# Rebuild: 1769966841
# Rebuild: 1770224125
# Rebuild: 1770229325
