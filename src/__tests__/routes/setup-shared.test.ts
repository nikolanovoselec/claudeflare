import { describe, it, expect } from 'vitest';
import { getWorkerNameFromHostname, detectCloudflareAuthError } from '../../routes/setup/shared';

describe('getWorkerNameFromHostname()', () => {
  it('extracts first segment from workers.dev hostname', () => {
    const result = getWorkerNameFromHostname('https://claudeflare.nikola-novoselec.workers.dev/api/setup');
    expect(result).toBe('claudeflare');
  });

  it('extracts first segment from different workers.dev subdomain', () => {
    const result = getWorkerNameFromHostname('https://my-app.test-account.workers.dev');
    expect(result).toBe('my-app');
  });

  it('returns claudeflare for custom domain', () => {
    const result = getWorkerNameFromHostname('https://claude.example.com/api/setup');
    expect(result).toBe('claudeflare');
  });

  it('returns claudeflare for localhost', () => {
    const result = getWorkerNameFromHostname('http://localhost:8787');
    expect(result).toBe('claudeflare');
  });

  it('handles workers.dev with no path', () => {
    const result = getWorkerNameFromHostname('https://test-worker.someone.workers.dev');
    expect(result).toBe('test-worker');
  });
});

describe('detectCloudflareAuthError()', () => {
  it('detects 401 status as auth error', () => {
    const result = detectCloudflareAuthError(401, [{ code: 1000, message: 'Unauthorized' }]);
    expect(result).toContain('Authentication/permission error');
    expect(result).toContain('HTTP 401');
  });

  it('detects 403 status as auth error', () => {
    const result = detectCloudflareAuthError(403, [{ code: 1000, message: 'Forbidden' }]);
    expect(result).toContain('HTTP 403');
  });

  it('detects error code 9103 as auth error', () => {
    const result = detectCloudflareAuthError(200, [{ code: 9103, message: 'Authentication error' }]);
    expect(result).not.toBeNull();
  });

  it('detects error code 10000 as auth error', () => {
    const result = detectCloudflareAuthError(200, [{ code: 10000, message: 'Error' }]);
    expect(result).not.toBeNull();
  });

  it('detects permission message as auth error', () => {
    const result = detectCloudflareAuthError(200, [{ message: 'Insufficient permission' }]);
    expect(result).not.toBeNull();
  });

  it('returns null for non-auth errors', () => {
    const result = detectCloudflareAuthError(200, [{ code: 5000, message: 'Server error' }]);
    expect(result).toBeNull();
  });

  it('returns null for empty errors array', () => {
    const result = detectCloudflareAuthError(200, []);
    expect(result).toBeNull();
  });
});
