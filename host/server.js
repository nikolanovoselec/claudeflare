/**
 * Claudeflare Terminal Server
 *
 * WebSocket server that manages multiple PTY sessions.
 * One container serves multiple sessions (terminal tabs).
 *
 * Endpoints:
 * - WS /terminal?session=<id> - Connect to terminal session
 * - GET /health - Health check
 * - GET /sessions - List active sessions
 * - POST /sessions - Create new session
 * - DELETE /sessions/:id - Delete session
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import pty from 'node-pty';
import { parse as parseUrl } from 'url';
import { parse as parseQuery } from 'querystring';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Start time for uptime calculation
const SERVER_START_TIME = Date.now();

// Helper to get sync status from /tmp/sync-status.json
function getSyncStatus() {
  try {
    const data = fs.readFileSync('/tmp/sync-status.json', 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { status: 'pending', error: null, userPath: null };
  }
}

// Cached disk metrics to avoid shelling out on every health check
let cachedDiskMetrics = { value: '...', lastUpdated: 0 };
const DISK_CACHE_TTL = 30000; // 30 seconds

async function getDiskMetrics() {
  if (Date.now() - cachedDiskMetrics.lastUpdated < DISK_CACHE_TTL) {
    return cachedDiskMetrics.value;
  }
  try {
    const { stdout } = await execFileAsync('df', ['-h', '/home/user']);
    const lines = stdout.trim().split('\n');
    if (lines.length >= 2) {
      const fields = lines[1].split(/\s+/);
      cachedDiskMetrics = { value: `${fields[2]}/${fields[1]}`, lastUpdated: Date.now() };
    }
  } catch (e) { /* keep cached value */ }
  return cachedDiskMetrics.value;
}

// Helper to get system metrics (CPU, MEM, HDD)
async function getSystemMetrics() {
  const metrics = { cpu: '...', mem: '...', hdd: '...' };
  try {
    const loadAvg = os.loadavg()[0];
    const cpus = os.cpus().length;
    metrics.cpu = ((loadAvg / cpus) * 100).toFixed(0) + '%';
  } catch (e) { /* ignore */ }
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usedGB = (usedMem / 1024 / 1024 / 1024).toFixed(1);
    const totalGB = (totalMem / 1024 / 1024 / 1024).toFixed(1);
    metrics.mem = usedGB + '/' + totalGB + 'G';
  } catch (e) { /* ignore */ }
  metrics.hdd = await getDiskMetrics();
  return metrics;
}

const PORT = process.env.TERMINAL_PORT || 8080;
// Spawn a login shell so .bashrc runs and auto-starts Claude
// The .bashrc has claude auto-start logic that only works in interactive login shells
const TERMINAL_COMMAND = process.env.TERMINAL_COMMAND || '/bin/bash';
const TERMINAL_ARGS = process.env.TERMINAL_ARGS || '-l';  // Login shell flag
const WORKSPACE_DEFAULT = process.env.WORKSPACE || '/mnt/r2/workspace';

// PTY persistence settings
const PTY_KEEPALIVE_MS = parseInt(process.env.PTY_KEEPALIVE_MS || '1800000', 10); // 30 minutes - matches container sleepAfter
const PTY_CLEANUP_INTERVAL_MS = parseInt(process.env.PTY_CLEANUP_INTERVAL_MS || '60000', 10); // Check every minute

// Determine actual working directory - fall back if WORKSPACE doesn't exist
// This handles the case where R2 mount fails or hasn't completed yet
function getWorkingDirectory() {
  if (fs.existsSync(WORKSPACE_DEFAULT)) {
    return WORKSPACE_DEFAULT;
  }
  // Fall back to HOME or /tmp if workspace doesn't exist
  const fallback = process.env.HOME || '/tmp';
  console.log(`[Terminal Server] WORKSPACE ${WORKSPACE_DEFAULT} not found, falling back to ${fallback}`);
  return fallback;
}

// Bug 3 fix: Global activity tracking for smart hibernation
const activityTracker = {
  lastPtyOutputTimestamp: Date.now(),
  lastWsActivityTimestamp: Date.now(),

  // Call this whenever PTY produces output
  recordPtyOutput() {
    this.lastPtyOutputTimestamp = Date.now();
  },

  // Call this whenever WebSocket activity occurs
  recordWsActivity() {
    this.lastWsActivityTimestamp = Date.now();
  },

  // Get activity info for the /activity endpoint
  getActivityInfo(sessionManager) {
    const now = Date.now();
    const totalConnectedClients = Array.from(sessionManager.sessions.values())
      .reduce((sum, session) => sum + session.clients.size, 0);

    return {
      hasActiveConnections: totalConnectedClients > 0,
      connectedClients: totalConnectedClients,
      activeSessions: sessionManager.size,
      lastPtyOutputMs: now - this.lastPtyOutputTimestamp,
      lastWsActivityMs: now - this.lastWsActivityTimestamp,
      lastPtyOutputAt: new Date(this.lastPtyOutputTimestamp).toISOString(),
      lastWsActivityAt: new Date(this.lastWsActivityTimestamp).toISOString(),
    };
  },
};

/**
 * Session represents a PTY terminal instance
 */
class Session {
  constructor(id, name = 'Terminal') {
    this.id = id;
    this.name = name;
    this.ptyProcess = null;
    this.clients = new Set(); // WebSocket clients attached to this session
    this.buffer = ''; // Buffer for reconnection (last 10KB)
    this.bufferMaxSize = 10 * 1024;
    this.createdAt = new Date().toISOString();
    this.lastAccessedAt = this.createdAt;
    this.disconnectedAt = null; // Timestamp when last client disconnected
    this.keepAliveTimeout = null; // Timer for PTY cleanup after disconnect
  }

  /**
   * Start the PTY process
   */
  start(cols = 80, rows = 24) {
    if (this.ptyProcess) {
      return; // Already started
    }

    // Parse command (support both "cmd arg1 arg2" format and separate TERMINAL_ARGS)
    const [cmd, ...cmdArgs] = TERMINAL_COMMAND.split(' ');
    // Combine with TERMINAL_ARGS if set (for login shell -l flag)
    const extraArgs = TERMINAL_ARGS ? TERMINAL_ARGS.split(' ').filter(a => a) : [];
    const args = [...cmdArgs, ...extraArgs];

    console.log(`[Session ${this.id}] Spawning: ${cmd} ${args.join(' ')}`);

    // Get working directory at spawn time (may change if R2 mounts later)
    const cwd = getWorkingDirectory();

    // Extract terminal ID from compound session ID (e.g., "abc123-2" -> "2")
    const terminalId = this.id.includes('-') ? this.id.split('-').pop() : '1';

    this.ptyProcess = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        HOME: process.env.HOME || '/root',
        TERMINAL_ID: terminalId,
      },
    });

    this.ptyProcess.onData((data) => {
      // Bug 3 fix: Record PTY activity for smart hibernation
      activityTracker.recordPtyOutput();

      // Add to buffer for reconnection
      this.buffer += data;
      if (this.buffer.length > this.bufferMaxSize) {
        this.buffer = this.buffer.slice(-this.bufferMaxSize);
      }

      // Broadcast to all connected clients - send RAW data (xterm expects raw bytes)
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);  // Raw terminal data, NOT JSON wrapped
        }
      }
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`[Session ${this.id}] PTY exited: code=${exitCode}, signal=${signal}`);
      // Notify clients with exit message as terminal output
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(`\r\n[Process exited with code ${exitCode}]\r\n`);
        }
      }
      this.ptyProcess = null;
    });

    console.log(`[Session ${this.id}] PTY started: pid=${this.ptyProcess.pid}`);
  }

  /**
   * Attach a WebSocket client to this session
   */
  attach(ws) {
    this.clients.add(ws);
    this.lastAccessedAt = new Date().toISOString();

    // Cancel any pending keepalive timeout since we have a client again
    if (this.keepAliveTimeout) {
      clearTimeout(this.keepAliveTimeout);
      this.keepAliveTimeout = null;
      console.log(`[Session ${this.id}] Reconnected, cancelled keepalive timeout`);
    }
    this.disconnectedAt = null;

    // Start PTY if not already running
    if (!this.ptyProcess) {
      this.start();
    }

    // Send buffered output for reconnection - raw data
    if (this.buffer) {
      ws.send(this.buffer);
    }

    console.log(`[Session ${this.id}] Client attached. Total clients: ${this.clients.size}`);
  }

  /**
   * Detach a WebSocket client from this session
   * @param {SessionManager} sessionManager - Reference to session manager for cleanup
   */
  detach(ws, sessionManager = null) {
    this.clients.delete(ws);
    console.log(`[Session ${this.id}] Client detached. Total clients: ${this.clients.size}`);

    // If no more clients and PTY is still running, start keepalive timer
    if (this.clients.size === 0 && this.ptyProcess) {
      this.disconnectedAt = new Date().toISOString();
      console.log(`[Session ${this.id}] No clients remaining, PTY will be kept alive for ${PTY_KEEPALIVE_MS / 1000}s`);

      // Set timeout to kill PTY if no reconnection
      this.keepAliveTimeout = setTimeout(() => {
        if (this.clients.size === 0 && this.ptyProcess) {
          console.log(`[Session ${this.id}] Keepalive timeout expired, killing PTY`);
          this.kill();
          // Optionally remove from session manager
          if (sessionManager) {
            sessionManager.sessions.delete(this.id);
            console.log(`[SessionManager] Removed orphaned session: ${this.id}`);
          }
        }
      }, PTY_KEEPALIVE_MS);
    }
  }

  /**
   * Write data to the PTY
   */
  write(data) {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  /**
   * Resize the PTY
   */
  resize(cols, rows) {
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
      console.log(`[Session ${this.id}] Resized to ${cols}x${rows}`);
    }
  }

  /**
   * Kill the PTY process
   */
  kill() {
    // Clear any keepalive timeout
    if (this.keepAliveTimeout) {
      clearTimeout(this.keepAliveTimeout);
      this.keepAliveTimeout = null;
    }

    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    // Close all clients
    for (const client of this.clients) {
      client.close(1000, 'Session terminated');
    }
    this.clients.clear();
    this.disconnectedAt = null;
    console.log(`[Session ${this.id}] Killed`);
  }

  /**
   * Check if session is alive (has PTY or clients)
   */
  isAlive() {
    return this.ptyProcess !== null || this.clients.size > 0;
  }

  /**
   * Check if PTY process is still running
   */
  isPtyAlive() {
    return this.ptyProcess !== null;
  }

  /**
   * Get session info
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      pid: this.ptyProcess?.pid || null,
      clients: this.clients.size,
      createdAt: this.createdAt,
      lastAccessedAt: this.lastAccessedAt,
      disconnectedAt: this.disconnectedAt,
      ptyAlive: this.isPtyAlive(),
    };
  }
}

/**
 * SessionManager handles all PTY sessions
 */
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = null;
  }

  /**
   * Start periodic cleanup of dead sessions
   */
  startCleanup() {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanupDeadSessions();
    }, PTY_CLEANUP_INTERVAL_MS);

    console.log(`[SessionManager] Started cleanup interval (every ${PTY_CLEANUP_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up sessions that have no clients and no PTY
   */
  cleanupDeadSessions() {
    const toDelete = [];
    for (const [id, session] of this.sessions) {
      // Remove sessions that have no PTY and no clients
      if (!session.isPtyAlive() && session.clients.size === 0) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.sessions.delete(id);
      console.log(`[SessionManager] Cleaned up dead session: ${id}`);
    }

    if (toDelete.length > 0) {
      console.log(`[SessionManager] Cleaned up ${toDelete.length} dead sessions. Active: ${this.sessions.size}`);
    }
  }

  /**
   * Get or create a session
   */
  getOrCreate(id, name) {
    let session = this.sessions.get(id);

    if (session) {
      // Session exists - check if PTY is still alive
      if (session.isPtyAlive()) {
        console.log(`[SessionManager] Reattaching to existing session: ${id} (PTY pid=${session.ptyProcess?.pid})`);
      } else {
        console.log(`[SessionManager] Session ${id} exists but PTY is dead, will restart on attach`);
      }
    } else {
      // Create new session
      session = new Session(id, name);
      this.sessions.set(id, session);
      console.log(`[SessionManager] Created new session: ${id}`);
    }

    return session;
  }

  /**
   * Get a session by ID
   */
  get(id) {
    return this.sessions.get(id);
  }

  /**
   * Delete a session
   */
  delete(id) {
    const session = this.sessions.get(id);
    if (session) {
      session.kill();
      this.sessions.delete(id);
      console.log(`[SessionManager] Deleted session: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * List all sessions
   */
  list() {
    return Array.from(this.sessions.values()).map((s) => s.toJSON());
  }

  /**
   * Get session count
   */
  get size() {
    return this.sessions.size;
  }
}

// Initialize session manager
const sessionManager = new SessionManager();

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const { pathname } = parseUrl(req.url);
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check with full metrics (consolidates separate health server)
  if (pathname === '/health' && method === 'GET') {
    const syncInfo = getSyncStatus();
    const sysMetrics = await getSystemMetrics();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        sessions: sessionManager.size,
        uptime: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
        syncStatus: syncInfo.status,
        syncError: syncInfo.error,
        userPath: syncInfo.userPath,
        cpu: sysMetrics.cpu,
        mem: sysMetrics.mem,
        hdd: sysMetrics.hdd,
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  // Bug 3 fix: Activity endpoint for smart hibernation
  if (pathname === '/activity' && method === 'GET') {
    const activityInfo = activityTracker.getActivityInfo(sessionManager);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(activityInfo));
    return;
  }

  // List sessions
  if (pathname === '/sessions' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: sessionManager.list() }));
    return;
  }

  // Create session
  if (pathname === '/sessions' && method === 'POST') {
    const MAX_BODY_SIZE = 64 * 1024; // 64KB
    let body = '';
    let bodySize = 0;
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (bodySize > MAX_BODY_SIZE) return;
      try {
        const { id, name } = JSON.parse(body || '{}');
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session ID required' }));
          return;
        }

        const session = sessionManager.getOrCreate(id, name || 'Terminal');
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ session: session.toJSON() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Delete session
  const deleteMatch = pathname.match(/^\/sessions\/([^\/]+)$/);
  if (deleteMatch && method === 'DELETE') {
    const id = deleteMatch[1];
    const deleted = sessionManager.delete(id);
    if (deleted) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: true, id }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  // 404 for unknown paths
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/terminal', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const { query } = parseUrl(req.url, true);
  const sessionId = query.session;

  if (!sessionId) {
    ws.close(1008, 'Session ID required');
    return;
  }

  // Get or create session
  const session = sessionManager.getOrCreate(sessionId, query.name || 'Terminal');

  // Attach client to session
  session.attach(ws);

  // Handle incoming messages
  // RAW data goes directly to PTY, JSON only for control messages (resize, ping)
  ws.on('message', (message) => {
    // Bug 3 fix: Record WebSocket activity for smart hibernation
    activityTracker.recordWsActivity();

    const str = message.toString();

    // Try to parse as JSON for known control messages only
    // Use specific prefixes to avoid intercepting terminal input that starts with '{'
    if (str.startsWith('{"type":"resize"') || str.startsWith('{"type":"ping"') || str.startsWith('{"type":"data"')) {
      try {
        const msg = JSON.parse(str);

        switch (msg.type) {
          case 'resize':
            // Resize PTY
            if (msg.cols && msg.rows) {
              session.resize(msg.cols, msg.rows);
            }
            return;

          case 'ping':
            // Respond to ping - still use JSON for pong
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            return;

          case 'data':
            // Legacy JSON-wrapped data - unwrap and write
            session.write(msg.data);
            return;
        }
      } catch (e) {
        // Not valid JSON - treat as raw terminal input
      }
    }

    // Raw terminal input - write directly to PTY
    session.write(str);
  });

  // Handle client disconnect
  ws.on('close', () => {
    session.detach(ws, sessionManager);
  });

  // Handle errors
  ws.on('error', (err) => {
    console.error(`[Session ${sessionId}] WebSocket error:`, err);
    session.detach(ws, sessionManager);
  });

  // Connection ready - no JSON message, just start sending PTY data
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Terminal Server] Listening on port ${PORT}`);
  console.log(`[Terminal Server] Configured workspace: ${WORKSPACE_DEFAULT}`);
  console.log(`[Terminal Server] Initial working directory: ${getWorkingDirectory()}`);
  console.log(`[Terminal Server] PTY keepalive timeout: ${PTY_KEEPALIVE_MS / 1000}s`);

  // Start periodic cleanup of dead sessions
  sessionManager.startCleanup();
});

// Handle shutdown
process.on('SIGTERM', () => {
  console.log('[Terminal Server] Received SIGTERM, shutting down...');
  sessionManager.stopCleanup();
  wss.close();
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Terminal Server] Received SIGINT, shutting down...');
  sessionManager.stopCleanup();
  wss.close();
  server.close();
  process.exit(0);
});
