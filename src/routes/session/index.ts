/**
 * Session routes aggregator
 * Combines CRUD and lifecycle routes into a single Hono app
 */
import { Hono } from 'hono';
import type { Env } from '../../types';
import { authMiddleware, AuthVariables } from '../../middleware/auth';
import crudRoutes from './crud';
import lifecycleRoutes from './lifecycle';

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Apply shared auth middleware to all session routes
app.use('*', authMiddleware);

// Mount CRUD routes (/, /:id, /:id/touch)
app.route('/', crudRoutes);

// Mount lifecycle routes (/:id/start, /:id/stop, /:id/status)
app.route('/', lifecycleRoutes);

export default app;
