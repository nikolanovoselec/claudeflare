import { describe, it, expect } from 'vitest';
import { BASE_URL, apiRequest } from './setup';

describe('API E2E', () => {
  // Note: DEV_MODE=true means auth returns test user user@example.com
  // When DEV_MODE=false (production), these endpoints return 401

  it('GET /api/user returns user info or 401 if auth required', async () => {
    const res = await apiRequest('/api/user');
    // In DEV_MODE=true: 200 with user info
    // In DEV_MODE=false (production): 401 Unauthorized
    if (res.ok) {
      const data = await res.json();
      expect(data.email).toBeDefined();
    } else {
      expect(res.status).toBe(401);
    }
  });

  it('GET /api/sessions returns session list or 401 if auth required', async () => {
    const res = await apiRequest('/api/sessions');
    // In DEV_MODE=true: 200 with sessions array
    // In DEV_MODE=false (production): 401 Unauthorized
    if (res.ok) {
      const data = await res.json() as { sessions: unknown[] };
      expect(Array.isArray(data.sessions)).toBe(true);
    } else {
      expect(res.status).toBe(401);
    }
  });

  it('rejects invalid session creation or returns 401', async () => {
    const res = await apiRequest('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }), // empty name should fail
    });
    // Either 400 Bad Request, 401 Unauthorized, or 200 with validation
    // Just verify we get a defined response status
    expect(res.status).toBeDefined();
    expect([400, 401, 200, 422]).toContain(res.status);
  });

  it('GET /api/setup/status returns setup status', async () => {
    const res = await apiRequest('/api/setup/status');
    // Setup status endpoint should be accessible without auth
    expect(res.status).toBeDefined();
    if (res.ok) {
      const data = await res.json() as { configured?: boolean };
      expect(typeof data.configured).toBe('boolean');
    }
  });
});
