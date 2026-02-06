import { Hono } from 'hono';
import type { Env } from './types';
import userRoutes from './routes/user';
import containerRoutes from './routes/container/index';
import sessionRoutes from './routes/session/index';
import terminalRoutes, { validateWebSocketRoute, handleWebSocketUpgrade } from './routes/terminal';
import credentialsRoutes from './routes/credentials';
import usersRoutes from './routes/users';
import setupRoutes from './routes/setup';
import adminRoutes from './routes/admin';
import { DEFAULT_ALLOWED_ORIGINS, REQUEST_ID_LENGTH, CORS_MAX_AGE_SECONDS } from './lib/constants';
import { AppError } from './lib/error-types';
import { getCachedKvOrigins, setCachedKvOrigins, resetCorsOriginsCache } from './lib/cors-cache';

/**
 * Load allowed origin patterns from KV (setup:custom_domain + setup:allowed_origins).
 * Results are cached in memory per isolate.
 */
async function getKvOrigins(env: Env): Promise<string[]> {
  const cached = getCachedKvOrigins();
  if (cached !== null) {
    return cached;
  }

  const origins: string[] = [];

  try {
    // Read custom domain
    const customDomain = await env.KV.get('setup:custom_domain');
    if (customDomain) {
      origins.push(customDomain);
    }

    // Read allowed origins list
    const originsJson = await env.KV.get('setup:allowed_origins');
    if (originsJson) {
      const parsed = JSON.parse(originsJson) as string[];
      if (Array.isArray(parsed)) {
        for (const o of parsed) {
          if (!origins.includes(o)) {
            origins.push(o);
          }
        }
      }
    }
  } catch {
    // On error, return empty (will fall back to env/defaults)
  }

  setCachedKvOrigins(origins);
  return origins;
}

/**
 * Check if the request origin is allowed based on environment configuration and KV-stored origins.
 * Combines origins from:
 *   1. env.ALLOWED_ORIGINS (wrangler.toml static config)
 *   2. KV: setup:custom_domain and setup:allowed_origins (dynamic, set by setup wizard)
 * Falls back to DEFAULT_ALLOWED_ORIGINS if env.ALLOWED_ORIGINS is not set.
 */
async function isAllowedOrigin(origin: string, env: Env): Promise<boolean> {
  const staticPatterns = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : DEFAULT_ALLOWED_ORIGINS;

  if (staticPatterns.some(pattern => origin.endsWith(pattern))) {
    return true;
  }

  // Check KV-stored origins (cached)
  const kvOrigins = await getKvOrigins(env);
  return kvOrigins.some(pattern => origin.endsWith(pattern));
}

// Type for app context with request ID
type AppVariables = {
  requestId: string;
};

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ============================================================================
// Request Tracing Middleware
// ============================================================================
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID().slice(0, REQUEST_ID_LENGTH);
  c.header('X-Request-ID', requestId);
  c.set('requestId', requestId);

  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  console.log(`[${requestId}] ${c.req.method} ${c.req.path} - ${c.res.status} (${duration}ms)`);
});

// CORS middleware - restrict to trusted origins (configurable via ALLOWED_ORIGINS env var)
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');

  // Determine allowed origin for this request
  let allowedOrigin: string | null = null;
  if (!origin) {
    // Allow requests with no origin (same-origin, curl, etc.)
    allowedOrigin = '*';
  } else if (await isAllowedOrigin(origin, c.env)) {
    // Check against configurable allowed patterns
    allowedOrigin = origin;
  } else if (c.env.DEV_MODE === 'true') {
    // Allow localhost only in development mode
    try {
      const originUrl = new URL(origin);
      if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
        allowedOrigin = origin;
      }
    } catch {
      // Invalid origin URL, skip
    }
  }

  // Handle preflight OPTIONS requests
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin || '',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': CORS_MAX_AGE_SECONDS.toString(),
      },
    });
  }

  // Continue to next handler
  await next();

  // Set CORS headers on response
  if (allowedOrigin) {
    c.res.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    c.res.headers.set('Access-Control-Allow-Credentials', 'true');
  }
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Static assets are served by Cloudflare Workers Assets at /
// Frontend SPA handles all non-API routes via its own routing

// Setup routes (public - no auth required)
app.route('/api/setup', setupRoutes);

// Admin routes (requires ADMIN_SECRET)
app.route('/api/admin', adminRoutes);

// API routes
app.route('/api/user', userRoutes);
app.route('/api/container', containerRoutes);
app.route('/api/sessions', sessionRoutes);
app.route('/api/terminal', terminalRoutes);
app.route('/api/credentials', credentialsRoutes);
app.route('/api/users', usersRoutes);

// 404 fallback - only for API routes
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Cache setup status per isolate (avoids KV read on every request)
let setupComplete: boolean | null = null;

/**
 * Reset the in-memory setup cache. Call this when setup completes
 * so the next request re-checks KV.
 */
export function resetSetupCache() {
  setupComplete = null;
  resetCorsOriginsCache();
}

// ============================================================================
// Global Error Handler
// ============================================================================
// Convention: Routes should throw AppError subclasses for error handling.
// Exception: Routes with domain-specific error response shapes (e.g., startup-status)
// may catch and return directly when the shape differs from AppError.toJSON().
app.onError((err, c) => {
  const requestId = c.get('requestId') || 'unknown';

  if (err instanceof AppError) {
    console.error(`[${requestId}] AppError:`, {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode
    });
    return c.json(err.toJSON(), err.statusCode as 400 | 401 | 404 | 500);
  }

  console.error(`[${requestId}] Unexpected error:`, err);
  return c.json({ error: 'An unexpected error occurred' }, 500);
});

/**
 * Custom fetch handler that intercepts WebSocket requests BEFORE Hono
 * This is required because Hono doesn't handle WebSocket upgrade correctly
 * See: https://github.com/cloudflare/workerd/issues/2319
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Intercept WebSocket terminal requests BEFORE Hono
    // WebSocket upgrade must be handled before Hono routes
    const wsRouteResult = validateWebSocketRoute(request, env);

    if (wsRouteResult.isWebSocketRoute) {
      // Return early error if validation failed
      if (wsRouteResult.errorResponse) {
        return wsRouteResult.errorResponse;
      }

      // Handle WebSocket upgrade
      return handleWebSocketUpgrade(request, env, ctx, wsRouteResult);
    }

    // Only route API and health requests through Hono
    // Non-API routes fall through to static assets (SPA)
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      return app.fetch(request, env, ctx);
    }

    // Setup redirect: if setup is not complete, redirect non-setup pages to /setup
    const path = url.pathname;
    if (path !== '/setup' && !path.startsWith('/setup/')) {
      // Check setup status (with in-memory cache)
      if (setupComplete === null) {
        const status = await env.KV.get('setup:complete');
        setupComplete = status === 'true';
      }
      if (!setupComplete) {
        return new Response(null, {
          status: 302,
          headers: { Location: '/setup' },
        });
      }
    }

    // For all other routes, serve from static assets
    // With not_found_handling = "single-page-application", missing routes get index.html
    return env.ASSETS.fetch(request);
  }
};

// Export Durable Objects
// Export container class for Durable Objects
export { container } from './container';
