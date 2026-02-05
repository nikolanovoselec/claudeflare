import { Hono } from 'hono';
import { getContainer } from '@cloudflare/containers';
import type { Env, Session } from '../types';
import { getSessionKey } from '../lib/kv-keys';
import { authMiddleware, AuthVariables } from '../middleware/auth';
import { getContainerId, checkContainerHealth } from '../lib/container-helpers';
import { getUserFromRequest, getBucketName } from '../lib/access';
import { createLogger } from '../lib/logger';
import { containerSessionsCB } from '../lib/circuit-breakers';
import { WebSocketUpgradeError, NotFoundError } from '../lib/error-types';

const logger = createLogger('terminal');

/**
 * Result of WebSocket routing validation
 */
export interface WebSocketRouteResult {
  /** Whether the request matches a WebSocket terminal route */
  isWebSocketRoute: boolean;
  /** The full session ID including terminal suffix (e.g., "abc123-1") */
  fullSessionId?: string;
  /** The base session ID without terminal suffix */
  baseSessionId?: string;
  /** The terminal ID (1-6) */
  terminalId?: string;
  /** Error response if validation failed */
  errorResponse?: Response;
}

/**
 * Validate and parse a WebSocket terminal route
 * This extracts the routing logic from index.ts to keep it modular
 *
 * @param request - The incoming request
 * @param env - Environment bindings
 * @returns Routing result with validation status
 */
export function validateWebSocketRoute(request: Request, env: Env): WebSocketRouteResult {
  const url = new URL(request.url);

  // Check if this matches the WebSocket terminal route pattern
  const wsMatch = url.pathname.match(/^\/api\/terminal\/([^\/]+)\/ws$/);
  const upgradeHeader = request.headers.get('Upgrade');

  // Not a WebSocket terminal route
  if (!wsMatch || (upgradeHeader?.toLowerCase() !== 'websocket' && !url.pathname.endsWith('/ws'))) {
    return { isWebSocketRoute: false };
  }

  const fullSessionId = wsMatch[1];

  // Parse compound sessionId (e.g., "abc123-1" -> baseSession="abc123", terminalId="1")
  const compoundMatch = fullSessionId.match(/^(.+)-([1-6])$/);
  const baseSessionId = compoundMatch ? compoundMatch[1] : fullSessionId;
  const terminalId = compoundMatch ? compoundMatch[2] : '1';

  // Validate sessionId format (8-24 lowercase alphanumeric)
  if (!/^[a-z0-9]{8,24}$/.test(baseSessionId)) {
    return {
      isWebSocketRoute: true,
      errorResponse: new Response(JSON.stringify({ error: 'Invalid session ID format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    };
  }

  return {
    isWebSocketRoute: true,
    fullSessionId,
    baseSessionId,
    terminalId,
  };
}

/**
 * Handle WebSocket upgrade for terminal connections
 * This must be called from index.ts BEFORE Hono because Hono doesn't handle WebSocket upgrades correctly
 *
 * @param request - The incoming request
 * @param env - Environment bindings
 * @param ctx - Execution context
 * @param routeResult - Pre-validated routing result
 * @returns WebSocket upgrade response or error response
 */
export async function handleWebSocketUpgrade(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  routeResult: WebSocketRouteResult
): Promise<Response> {
  const { fullSessionId, baseSessionId, terminalId } = routeResult;

  if (!fullSessionId || !baseSessionId || !terminalId) {
    return new Response(JSON.stringify({ error: 'Invalid routing result' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const browserSessionId = url.searchParams.get('browserSession');

  logger.info('WebSocket upgrade requested', { fullSessionId, browserSessionId });

  try {
    // Authenticate user
    const user = getUserFromRequest(request, env);
    if (!user.authenticated) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const bucketName = getBucketName(user.email);
    const containerId = getContainerId(bucketName, baseSessionId);

    logger.info('User authenticated for WebSocket', { email: user.email, containerId, terminalId });

    // Validate session exists using BASE sessionId
    const sessionKey = `session:${bucketName}:${baseSessionId}`;
    const session = await env.KV.get<Session>(sessionKey, 'json');

    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update last accessed timestamp (don't await)
    ctx.waitUntil((async () => {
      session.lastAccessedAt = new Date().toISOString();
      await env.KV.put(sessionKey, JSON.stringify(session));
    })());

    // Get container using session-specific ID (one container per browser tab)
    const container = getContainer(env.CONTAINER, containerId);

    // Build terminal WebSocket URL
    const terminalUrl = new URL(request.url);
    terminalUrl.pathname = '/terminal';
    terminalUrl.searchParams.set('session', fullSessionId);  // Pass full compound ID to container
    terminalUrl.searchParams.set('name', session.name);
    terminalUrl.searchParams.set('terminalId', terminalId);

    logger.info('Forwarding WebSocket to container', { pathname: terminalUrl.pathname, search: terminalUrl.search });

    // Forward WebSocket request directly to container
    // Using the original request preserves WebSocket upgrade headers
    const response = await container.fetch(new Request(terminalUrl.toString(), request));

    logger.info('Container WebSocket response', { status: response.status });
    return response;
  } catch (error) {
    logger.error('WebSocket upgrade error', error instanceof Error ? error : new Error(String(error)));
    // Don't expose internal error details to client
    return new Response(JSON.stringify({
      error: 'WebSocket connection failed'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Use shared auth middleware
app.use('*', authMiddleware);

/**
 * GET /api/terminal/:sessionId/ws
 * WebSocket upgrade handler for terminal connections
 *
 * This route:
 * 1. Authenticates the user via Cloudflare Access headers
 * 2. Validates that the session exists and belongs to the user
 * 3. Forwards the WebSocket connection directly to the container's terminal server
 *
 * Note: Cloudflare Containers automatically handle WebSocket upgrade when
 * using container.fetch() with a WebSocket request.
 */
app.get('/:sessionId/ws', async (c) => {
  const reqLogger = logger.child({ requestId: c.req.header('X-Request-ID') });
  const bucketName = c.get('bucketName');
  const fullSessionId = c.req.param('sessionId');

  // Parse compound session ID: "baseSessionId-terminalId" or just "baseSessionId"
  // Terminal IDs are 1-4, so we look for pattern ending in -1, -2, -3, or -4
  const compoundMatch = fullSessionId.match(/^(.+)-([1-4])$/);
  const baseSessionId = compoundMatch ? compoundMatch[1] : fullSessionId;
  const terminalId = compoundMatch ? compoundMatch[2] : '1';

  // Verify this is a WebSocket upgrade request
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    throw new WebSocketUpgradeError();
  }

  // Validate that the BASE session exists and belongs to this user
  const sessionKey = getSessionKey(bucketName, baseSessionId);
  const session = await c.env.KV.get<Session>(sessionKey, 'json');

  if (!session) {
    throw new NotFoundError('Session');
  }

  // Update last accessed timestamp (don't await to not block WebSocket)
  c.executionCtx.waitUntil(
    (async () => {
      session.lastAccessedAt = new Date().toISOString();
      await c.env.KV.put(sessionKey, JSON.stringify(session));
    })()
  );

  // Get the container for this session (container is per-session, not per-terminal)
  const containerId = getContainerId(bucketName, baseSessionId);
  const container = getContainer(c.env.CONTAINER, containerId);

  // Construct the WebSocket URL to the container's terminal server
  // Terminal server runs on port 8080 (default) at /terminal path
  // Pass compound session ID so each terminal gets its own PTY
  const terminalUrl = new URL(c.req.url);
  terminalUrl.pathname = '/terminal';
  terminalUrl.searchParams.set('session', fullSessionId);
  terminalUrl.searchParams.set('name', `${session.name} - Terminal ${terminalId}`);

  try {
    // Forward the original request with all WebSocket headers
    // This is exactly how the working claude-cloudflare project does it
    // NO switchPort - terminal server is on default port 8080
    reqLogger.info('Forwarding WebSocket to container', { port: 8080, url: terminalUrl.toString() });

    // Get the raw request and create a new Request with the container URL
    // but preserving all the original headers (especially WebSocket upgrade headers)
    const rawRequest = c.req.raw;
    const containerRequest = new Request(terminalUrl.toString(), {
      method: rawRequest.method,
      headers: rawRequest.headers,
      // Note: WebSocket requests don't have a body, but include this for completeness
      body: rawRequest.body,
      // Preserve the duplex setting for streaming
    });

    // container.fetch() with proper WebSocket headers will handle upgrade
    const response = await container.fetch(containerRequest);

    reqLogger.info('Container response received', { status: response.status });

    return response;
  } catch (error) {
    reqLogger.error('Error connecting to container', error instanceof Error ? error : new Error(String(error)));

    // Check if it's a container not running error
    if (
      error instanceof Error &&
      error.message.includes('Container not running')
    ) {
      return c.json({ error: 'Container not running. Please start the session first.' }, 503);
    }

    return c.json({ error: 'Failed to connect to terminal. Please try again.' }, 500);
  }
});

/**
 * GET /api/terminal/:sessionId/status
 * Get terminal connection status for a session
 */
app.get('/:sessionId/status', async (c) => {
  const reqLogger = logger.child({ requestId: c.req.header('X-Request-ID') });
  const bucketName = c.get('bucketName');
  const sessionId = c.req.param('sessionId');

  // Validate session
  const sessionKey = getSessionKey(bucketName, sessionId);
  const session = await c.env.KV.get<Session>(sessionKey, 'json');

  if (!session) {
    throw new NotFoundError('Session');
  }

  // Check container status
  try {
    const containerId = getContainerId(bucketName, sessionId);
    const container = getContainer(c.env.CONTAINER, containerId);

    // Check terminal server health (runs on default port 8080)
    const healthResult = await checkContainerHealth(container);

    if (!healthResult.healthy) {
      return c.json({
        session,
        containerRunning: true,
        terminalServerReady: false,
      });
    }

    // Check if this session has an active PTY (terminal server on default port)
    const sessionsResponse = await containerSessionsCB.execute(() =>
      container.fetch(
        new Request('http://container/sessions', { method: 'GET' })
      )
    );

    let ptyActive = false;
    if (sessionsResponse.ok) {
      const data = (await sessionsResponse.json()) as {
        sessions: { id: string }[];
      };
      ptyActive = data.sessions.some((s) => s.id === sessionId);
    }

    return c.json({
      session,
      containerRunning: true,
      terminalServerReady: true,
      ptyActive,
      wsUrl: `/api/terminal/${sessionId}/ws`,
    });
  } catch (error) {
    // Container not running
    return c.json({
      session,
      containerRunning: false,
      terminalServerReady: false,
      ptyActive: false,
      wsUrl: `/api/terminal/${sessionId}/ws`,
    });
  }
});

export default app;
