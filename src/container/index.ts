import { Container } from '@cloudflare/containers';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { TERMINAL_SERVER_PORT, IDLE_TIMEOUT_MS } from '../lib/constants';
import { getR2Config } from '../lib/r2-config';

/**
 * Bug 3 fix: Smart hibernation configuration
 */
const ACTIVITY_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Storage key to mark a DO as destroyed - prevents zombie resurrection
 */
const DESTROYED_FLAG_KEY = '_destroyed';

/**
 * container - Container Durable Object for user workspaces
 *
 * Each user gets one container that persists their workspace via s3fs mount to R2.
 * The container runs a terminal server that handles multiple PTY sessions.
 */
// Class name must be lowercase 'container' to match wrangler.toml class_name
// and existing DO migrations. Renaming would require a destructive migration
// that risks losing all existing Durable Objects. See wrangler.toml migrations.
export class container extends Container<Env> {
  // Port where the container's HTTP server listens
  // Terminal server handles all endpoints: WebSocket, health check, metrics
  defaultPort = 8080;

  // Bug 3 fix: Extend sleepAfter to 24h - our activity polling handles hibernation
  sleepAfter = '24h';

  // Environment variables - dynamically generated via getter
  private _bucketName: string | null = null;
  private _r2AccountId: string | null = null;
  private _r2Endpoint: string | null = null;

  // Bug 3 fix: Activity polling timer
  private _activityPollAlarm: boolean = false;

  constructor(ctx: DurableObjectState<Env>, env: Env) {
    super(ctx, env);
    // Load bucket name from storage on startup and update envVars
    this.ctx.blockConcurrencyWhile(async () => {
      // Check if this DO was already destroyed - if so, self-destruct immediately
      const wasDestroyed = await this.ctx.storage.get<boolean>(DESTROYED_FLAG_KEY);
      if (wasDestroyed) {
        console.log(`[container] ZOMBIE DETECTED in constructor - clearing storage`);
        await this.ctx.storage.deleteAll();
        return; // Don't initialize anything else
      }

      this._bucketName = await this.ctx.storage.get<string>('bucketName') || null;

      // Resolve R2 config via shared helper (env vars first, KV fallback)
      try {
        const r2Config = await getR2Config(this.env);
        this._r2AccountId = r2Config.accountId;
        this._r2Endpoint = r2Config.endpoint;
      } catch {
        // R2 not configured yet — will use empty values in updateEnvVars
      }

      // If no bucket name stored, this is an orphan/zombie DO - self-destruct
      if (!this._bucketName) {
        console.log(`[container] ORPHAN DO detected (no bucketName) - clearing storage`);
        await this.ctx.storage.deleteAll();
        return; // Don't initialize anything else
      }

      console.log(`[container] Loaded bucket name from storage: ${this._bucketName}`);
      this.updateEnvVars();
    });
  }

  /**
   * Set the bucket name for this container (called by worker on first access)
   */
  async setBucketName(name: string): Promise<void> {
    this._bucketName = name;
    await this.ctx.storage.put('bucketName', name);
    this.updateEnvVars();
    console.log(`[container] Stored bucket name: ${name}`);
  }

  /**
   * Get the bucket name
   */
  getBucketName(): string | null {
    return this._bucketName;
  }

  /**
   * Update envVars with current bucket name
   * Called after setBucketName to ensure envVars has correct value
   */
  private updateEnvVars(): void {
    const bucketName = this._bucketName || 'unknown-bucket';
    const accessKeyId = this.env.R2_ACCESS_KEY_ID || '';
    const secretAccessKey = this.env.R2_SECRET_ACCESS_KEY || '';
    const accountId = this._r2AccountId || this.env.R2_ACCOUNT_ID || '';
    const endpoint = this._r2Endpoint || this.env.R2_ENDPOINT || '';

    // Debug logging for env var status
    console.log(`[container] updateEnvVars called:`);
    console.log(`  R2_BUCKET_NAME: ${bucketName}`);
    console.log(`  R2_ACCESS_KEY_ID: ${accessKeyId ? accessKeyId.substring(0, 4) + '...' : 'NOT SET'}`);
    console.log(`  R2_SECRET_ACCESS_KEY: ${secretAccessKey ? 'SET (hidden)' : 'NOT SET'}`);
    console.log(`  R2_ACCOUNT_ID: ${accountId || 'NOT SET'}`);
    console.log(`  R2_ENDPOINT: ${endpoint || 'NOT SET'}`);

    this.envVars = {
      // R2 credentials - using AWS naming convention for s3fs compatibility
      AWS_ACCESS_KEY_ID: accessKeyId,
      AWS_SECRET_ACCESS_KEY: secretAccessKey,
      // R2 configuration
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
      R2_ACCOUNT_ID: accountId,
      R2_BUCKET_NAME: bucketName,  // User's personal bucket
      R2_ENDPOINT: endpoint,
      // Terminal server port
      TERMINAL_PORT: String(TERMINAL_SERVER_PORT),
    };
  }

  /**
   * Override fetch to handle internal bucket name setting
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle internal bucket name setting endpoint
    if (url.pathname === '/_internal/setBucketName' && request.method === 'POST') {
      try {
        const { bucketName } = await request.json() as { bucketName: string };
        if (bucketName) {
          await this.setBucketName(bucketName);
          return new Response(JSON.stringify({ success: true, bucketName }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'Missing bucketName' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Handle internal bucket name getting endpoint
    if (url.pathname === '/_internal/getBucketName' && request.method === 'GET') {
      return new Response(JSON.stringify({ bucketName: this._bucketName }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle internal envVars debug endpoint (shows masked values) - DEV_MODE only
    if (url.pathname === '/_internal/debugEnvVars' && request.method === 'GET') {
      if (this.env.DEV_MODE !== 'true') {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const debugInfo = {
        bucketName: this._bucketName,
        resolvedR2Config: {
          accountId: this._r2AccountId || 'NOT SET',
          endpoint: this._r2Endpoint || 'NOT SET',
          source: this._r2AccountId
            ? (this.env.R2_ACCOUNT_ID ? 'env' : 'kv')
            : 'none',
        },
        envVars: {
          R2_BUCKET_NAME: this.envVars?.R2_BUCKET_NAME || 'NOT SET',
          R2_ENDPOINT: this.envVars?.R2_ENDPOINT || 'NOT SET',
          R2_ACCOUNT_ID: this.envVars?.R2_ACCOUNT_ID || 'NOT SET',
          R2_ACCESS_KEY_ID: this.envVars?.R2_ACCESS_KEY_ID ? this.envVars.R2_ACCESS_KEY_ID.substring(0, 4) + '...' : 'NOT SET',
          R2_SECRET_ACCESS_KEY: this.envVars?.R2_SECRET_ACCESS_KEY ? 'SET (hidden)' : 'NOT SET',
          TERMINAL_PORT: this.envVars?.TERMINAL_PORT || 'NOT SET',
        },
        workerEnv: {
          R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID ? this.env.R2_ACCESS_KEY_ID.substring(0, 4) + '...' : 'NOT SET',
          R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY ? 'SET (hidden)' : 'NOT SET',
          R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID || 'NOT SET',
          R2_ENDPOINT: this.env.R2_ENDPOINT || 'NOT SET',
        },
      };
      return new Response(JSON.stringify(debugInfo, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Pass all other requests to the parent Container class
    return super.fetch(request);
  }

  /**
   * Called when the container starts successfully
   */
  override onStart(): void {
    console.log('[container] Container started successfully');

    // Bug 3 fix: Start activity polling
    this.scheduleActivityPoll();
  }

  /**
   * Bug 3 fix: Schedule the next activity poll using DO alarm
   */
  private async scheduleActivityPoll(): Promise<void> {
    if (this._activityPollAlarm) return; // Already scheduled

    try {
      const nextPollTime = Date.now() + ACTIVITY_POLL_INTERVAL_MS;
      await this.ctx.storage.setAlarm(nextPollTime);
      this._activityPollAlarm = true;
      console.log(`[container] Activity poll scheduled for ${new Date(nextPollTime).toISOString()}`);
    } catch (e) {
      console.error('[container] Failed to schedule activity poll:', e);
    }
  }

  /**
   * Check if DO was explicitly destroyed - prevents zombie resurrection.
   * Uses only DO storage (not Container methods) to avoid waking up hibernated DO.
   * @returns true if DO should be cleaned up and alarm handler should exit
   */
  private async checkDestroyedState(): Promise<boolean> {
    const wasDestroyed = await this.ctx.storage.get<boolean>(DESTROYED_FLAG_KEY);
    if (wasDestroyed) {
      console.log(`[container] ZOMBIE PREVENTED: DO was destroyed, clearing alarm and storage`);
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return true;
    }
    return false;
  }

  /**
   * Check if DO is an orphan (no bucket name) - these are zombies from old code.
   * @returns true if DO should be cleaned up and alarm handler should exit
   */
  private async checkOrphanState(): Promise<boolean> {
    if (!this._bucketName) {
      console.log(`[container] ZOMBIE DETECTED: no bucketName stored, doId=${this.ctx.id.toString()}`);
      try {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
      } catch (e) {
        console.error('[container] Failed to cleanup zombie:', e);
      }
      return true;
    }
    return false;
  }

  /**
   * Check if container is stopped and clean it up if so.
   * @returns true if container was stopped and cleaned up
   */
  private async checkContainerStopped(): Promise<boolean> {
    try {
      const state = await this.getState();
      if (state.status === 'stopped' || state.status === 'stopped_with_code') {
        console.log(`[container] Container is ${state.status}, DESTROYING to prevent zombie resurrection`);
        await this.cleanupAndDestroy();
        return true;
      }
      return false;
    } catch (e) {
      console.log('[container] Could not get state in alarm, DESTROYING as zombie:', e);
      await this.cleanupAndDestroy();
      return true;
    }
  }

  /**
   * Handle idle container by checking activity and destroying if idle too long.
   * @returns true if container was destroyed due to being idle
   */
  private async handleIdleContainer(): Promise<boolean> {
    const activityInfo = await this.getActivityInfo();

    if (!activityInfo) {
      console.log(`[container] Could not get activity info, DESTROYING as zombie`);
      await this.cleanupAndDestroy();
      return true;
    }

    const { hasActiveConnections, lastPtyOutputMs, lastWsActivityMs } = activityInfo;
    const longestIdleMs = Math.min(lastPtyOutputMs, lastWsActivityMs);

    console.log(`[container] Activity check: connections=${hasActiveConnections}, ptyIdle=${lastPtyOutputMs}ms, wsIdle=${lastWsActivityMs}ms`);

    // Container can sleep when: no connections AND idle for IDLE_TIMEOUT_MS
    if (!hasActiveConnections && longestIdleMs > IDLE_TIMEOUT_MS) {
      console.log(`[container] Container idle for ${longestIdleMs}ms with no connections, DESTROYING`);
      await this.cleanupAndDestroy();
      return true;
    }

    return false;
  }

  /**
   * Helper to mark DO as destroyed and clean up all storage.
   * Used by alarm handler to aggressively prevent zombie resurrection.
   */
  private async cleanupAndDestroy(): Promise<void> {
    await this.ctx.storage.put(DESTROYED_FLAG_KEY, true);
    await this.ctx.storage.deleteAlarm();
    await this.destroy();
  }

  /**
   * Bug 3 fix: Handle DO alarm for activity polling
   *
   * CRITICAL ZOMBIE FIX: The alarm() method must check for destroyed state FIRST
   * before calling ANY Container base class methods like getState().
   *
   * Why? When destroy() is called, it sets the _destroyed flag and deletes the alarm.
   * However, if an alarm was already scheduled to fire, it will still trigger.
   * When alarm() fires and calls getState() on a destroyed container, it can
   * resurrect the DO, creating a zombie loop.
   *
   * The fix: Check storage for _destroyed flag FIRST. This uses only DO storage,
   * not Container methods, so it won't resurrect the container.
   */
  async alarm(): Promise<void> {
    this._activityPollAlarm = false;
    console.log('[container] Activity poll alarm triggered');

    // Step 1: Check if DO was explicitly destroyed (uses only storage, not Container methods)
    if (await this.checkDestroyedState()) {
      return;
    }

    // Step 2: Check if this is an orphan/zombie DO (no bucket name)
    if (await this.checkOrphanState()) {
      return;
    }

    // Step 3: Check if container is stopped
    if (await this.checkContainerStopped()) {
      return;
    }

    // Step 4: Handle activity polling and idle detection
    try {
      if (await this.handleIdleContainer()) {
        return;
      }

      // Schedule next poll
      await this.scheduleActivityPoll();
    } catch (e) {
      console.error('[container] Error in activity poll:', e);
      // On error, destroy the container to prevent zombie
      try {
        await this.cleanupAndDestroy();
      } catch (destroyErr) {
        console.error('[container] Failed to destroy zombie:', destroyErr);
      }
    }
  }

  /**
   * Bug 3 fix: Get activity info from the terminal server
   */
  private async getActivityInfo(): Promise<{
    hasActiveConnections: boolean;
    lastPtyOutputMs: number;
    lastWsActivityMs: number;
  } | null> {
    try {
      const response = await this.fetch(
        new Request(this.getTerminalActivityUrl(), { method: 'GET' })
      );

      if (response.ok) {
        const data = await response.json() as {
          hasActiveConnections: boolean;
          lastPtyOutputMs: number;
          lastWsActivityMs: number;
        };
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Bug 3 fix: Get the internal URL for the terminal server's activity endpoint
   */
  getTerminalActivityUrl(): string {
    return `http://container:${TERMINAL_SERVER_PORT}/activity`;
  }

  /**
   * Override destroy to clear the activity poll alarm and mark as destroyed
   *
   * CRITICAL ZOMBIE FIX: We set a _destroyed flag in storage BEFORE calling super.destroy().
   * This flag is checked by alarm() BEFORE any Container methods are called.
   * This prevents the zombie resurrection bug where:
   * 1. destroy() is called
   * 2. An already-scheduled alarm fires
   * 3. alarm() calls getState() which resurrects the DO
   *
   * By setting the flag first, alarm() can detect the destroyed state without
   * calling any Container methods that would resurrect it.
   */
  override async destroy(): Promise<void> {
    console.log('[container] NUKING container - clearing ALL storage');
    try {
      // Clear the alarm first
      await this.ctx.storage.deleteAlarm();
      this._activityPollAlarm = false;

      // NUKE: Delete ALL storage to make DO empty
      // Cloudflare garbage collects empty DOs
      await this.ctx.storage.deleteAll();
      console.log('[container] Storage cleared - DO will be garbage collected');
    } catch (e) {
      console.error('[container] Failed to nuke storage:', e);
    }
    return super.destroy();
  }

  /**
   * Called when the container stops
   */
  override onStop(): void {
    console.log('[container] Container stopped');
  }

  /**
   * Called when the container encounters an error
   */
  override onError(error: unknown): void {
    console.error('[container] Container error:', error);
  }

}
