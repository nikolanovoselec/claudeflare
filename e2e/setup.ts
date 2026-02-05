// E2E Test Setup
// Uses workers.dev URL with DEV_MODE=true (no auth required for testing)
export const BASE_URL = process.env.E2E_BASE_URL || 'https://claudeflare.your-subdomain.workers.dev';

// Helper to make API requests
export async function apiRequest(path: string, options?: RequestInit) {
  const url = `${BASE_URL}${path}`;
  return fetch(url, options);
}
