import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function errorResponse(c: Context, status: ContentfulStatusCode, message: string) {
  return c.json({ error: message }, status);
}
