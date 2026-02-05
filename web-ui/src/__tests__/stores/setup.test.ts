import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to import fresh each time to reset store state
let setupStore: typeof import('../../stores/setup').setupStore;

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('Setup Store', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset fetch mock
    mockFetch.mockReset();

    // Re-import to get fresh store state
    const module = await import('../../stores/setup');
    setupStore = module.setupStore;
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('initial state', () => {
    it('should start at step 1', () => {
      expect(setupStore.step).toBe(1);
    });

    it('should have empty token', () => {
      expect(setupStore.token).toBe('');
    });

    it('should have token not valid', () => {
      expect(setupStore.tokenValid).toBe(false);
    });

    it('should have no token error', () => {
      expect(setupStore.tokenError).toBeNull();
    });

    it('should not be verifying token', () => {
      expect(setupStore.tokenVerifying).toBe(false);
    });

    it('should have no account info', () => {
      expect(setupStore.accountInfo).toBeNull();
    });

    it('should have custom domain disabled', () => {
      expect(setupStore.useCustomDomain).toBe(false);
    });

    it('should have empty custom domain', () => {
      expect(setupStore.customDomain).toBe('');
    });

    it('should have default access policy', () => {
      expect(setupStore.accessPolicy).toEqual({
        type: 'email',
        emails: [],
        domain: '',
      });
    });

    it('should not be configuring', () => {
      expect(setupStore.configuring).toBe(false);
    });

    it('should have setup not complete', () => {
      expect(setupStore.setupComplete).toBe(false);
    });

    it('should have no accountId', () => {
      expect(setupStore.accountId).toBeNull();
    });
  });

  describe('setToken', () => {
    it('should set token value', () => {
      setupStore.setToken('test-token-123');

      expect(setupStore.token).toBe('test-token-123');
    });

    it('should reset tokenValid to false', () => {
      setupStore.setToken('test-token');

      expect(setupStore.tokenValid).toBe(false);
    });

    it('should clear tokenError', () => {
      setupStore.setToken('test-token');

      expect(setupStore.tokenError).toBeNull();
    });
  });

  describe('verifyToken', () => {
    it('should set tokenVerifying during verification', async () => {
      let resolvePromise: (value: Response) => void;
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      setupStore.setToken('test-token');
      const verifyPromise = setupStore.verifyToken();

      expect(setupStore.tokenVerifying).toBe(true);

      resolvePromise!(
        new Response(JSON.stringify({ valid: true, account: { id: '123', name: 'Test' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await verifyPromise;

      expect(setupStore.tokenVerifying).toBe(false);
    });

    it('should return true and set tokenValid on successful verification', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            valid: true,
            account: { id: 'account-123', name: 'Test Account' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      setupStore.setToken('valid-token');
      const result = await setupStore.verifyToken();

      expect(result).toBe(true);
      expect(setupStore.tokenValid).toBe(true);
      expect(setupStore.accountInfo).toEqual({ id: 'account-123', name: 'Test Account' });
      expect(setupStore.tokenError).toBeNull();
    });

    it('should return false and set error on invalid token', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            valid: false,
            error: 'Invalid token',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      setupStore.setToken('invalid-token');
      const result = await setupStore.verifyToken();

      expect(result).toBe(false);
      expect(setupStore.tokenValid).toBe(false);
      expect(setupStore.tokenError).toBe('Invalid token');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      setupStore.setToken('test-token');
      const result = await setupStore.verifyToken();

      expect(result).toBe(false);
      expect(setupStore.tokenError).toBe('Verification failed');
    });

    it('should call correct API endpoint', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      setupStore.setToken('test-token');
      await setupStore.verifyToken();

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/setup/verify-token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'test-token' }),
        })
      );
    });
  });

  describe('step navigation', () => {
    it('should go to next step', () => {
      setupStore.nextStep();

      expect(setupStore.step).toBe(2);
    });

    it('should go to previous step', () => {
      setupStore.nextStep();
      setupStore.nextStep();
      setupStore.prevStep();

      expect(setupStore.step).toBe(2);
    });

    it('should not go below step 1', () => {
      setupStore.prevStep();

      expect(setupStore.step).toBe(1);
    });

    it('should go to specific step', () => {
      setupStore.goToStep(3);

      expect(setupStore.step).toBe(3);
    });
  });

  describe('access policy management', () => {
    it('should set access policy type', () => {
      setupStore.setAccessPolicy({ type: 'domain' });

      expect(setupStore.accessPolicy.type).toBe('domain');
    });

    it('should set access policy domain', () => {
      setupStore.setAccessPolicy({ domain: 'example.com' });

      expect(setupStore.accessPolicy.domain).toBe('example.com');
    });

    it('should add email to policy', () => {
      setupStore.addEmail('test@example.com');

      expect(setupStore.accessPolicy.emails).toContain('test@example.com');
    });

    it('should not add duplicate email', () => {
      setupStore.addEmail('test@example.com');
      setupStore.addEmail('test@example.com');

      expect(setupStore.accessPolicy.emails.length).toBe(1);
    });

    it('should not add empty email', () => {
      setupStore.addEmail('');

      expect(setupStore.accessPolicy.emails.length).toBe(0);
    });

    it('should remove email by index', () => {
      setupStore.addEmail('first@example.com');
      setupStore.addEmail('second@example.com');

      setupStore.removeEmail(0);

      expect(setupStore.accessPolicy.emails).not.toContain('first@example.com');
      expect(setupStore.accessPolicy.emails).toContain('second@example.com');
    });
  });

  describe('custom domain', () => {
    it('should set useCustomDomain', () => {
      setupStore.setUseCustomDomain(true);

      expect(setupStore.useCustomDomain).toBe(true);
    });

    it('should clear customDomainError when toggling', () => {
      setupStore.setUseCustomDomain(true);

      expect(setupStore.customDomainError).toBeNull();
    });

    it('should set custom domain', () => {
      setupStore.setCustomDomain('my-app.example.com');

      expect(setupStore.customDomain).toBe('my-app.example.com');
    });

    it('should clear customDomainError when setting domain', () => {
      setupStore.setCustomDomain('new-domain.com');

      expect(setupStore.customDomainError).toBeNull();
    });
  });

  describe('configure', () => {
    it('should set configuring during configuration', async () => {
      let resolvePromise: (value: Response) => void;
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const configurePromise = setupStore.configure();

      expect(setupStore.configuring).toBe(true);

      resolvePromise!(
        new Response(JSON.stringify({ success: true, steps: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await configurePromise;

      expect(setupStore.configuring).toBe(false);
    });

    it('should return true and set setupComplete on success', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            steps: [{ step: 'Create R2', status: 'success' }],
            workersDevUrl: 'https://app.workers.dev',
            adminSecret: 'secret-123',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      setupStore.setToken('valid-token');
      const result = await setupStore.configure();

      expect(result).toBe(true);
      expect(setupStore.setupComplete).toBe(true);
      expect(setupStore.workersDevUrl).toBe('https://app.workers.dev');
      expect(setupStore.adminSecret).toBe('secret-123');
    });

    it('should return false and set error on failure', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: 'Configuration failed',
            steps: [{ step: 'Create R2', status: 'failed', error: 'R2 error' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      const result = await setupStore.configure();

      expect(result).toBe(false);
      expect(setupStore.configureError).toBe('Configuration failed');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await setupStore.configure();

      expect(result).toBe(false);
      expect(setupStore.configureError).toBe('Configuration request failed');
    });

    it('should include custom domain in request when enabled', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true, steps: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      setupStore.setToken('test-token');
      setupStore.setUseCustomDomain(true);
      setupStore.setCustomDomain('my-domain.com');
      setupStore.setAccessPolicy({ type: 'email', emails: ['test@example.com'] });

      await setupStore.configure();

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.customDomain).toBe('my-domain.com');
      expect(body.accessPolicy).toBeDefined();
    });

    it('should not include custom domain when disabled', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true, steps: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      setupStore.setToken('test-token');
      setupStore.setUseCustomDomain(false);
      setupStore.setCustomDomain('my-domain.com');

      await setupStore.configure();

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.customDomain).toBeUndefined();
      expect(body.accessPolicy).toBeUndefined();
    });

    it('should store configure steps', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            steps: [
              { step: 'Create R2', status: 'success' },
              { step: 'Set secrets', status: 'success' },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      await setupStore.configure();

      expect(setupStore.configureSteps.length).toBe(2);
      expect(setupStore.configureSteps[0].step).toBe('Create R2');
    });

    it('should set customDomainUrl when provided', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            steps: [],
            workersDevUrl: 'https://app.workers.dev',
            customDomainUrl: 'https://my-app.example.com',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      await setupStore.configure();

      expect(setupStore.customDomainUrl).toBe('https://my-app.example.com');
    });

    it('should store accountId from configure response', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            steps: [],
            workersDevUrl: 'https://app.workers.dev',
            adminSecret: 'secret-123',
            accountId: 'acc-456',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      setupStore.setToken('valid-token');
      await setupStore.configure();

      expect(setupStore.accountId).toBe('acc-456');
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', async () => {
      // First, modify some state
      setupStore.setToken('test-token');
      setupStore.nextStep();
      setupStore.setUseCustomDomain(true);
      setupStore.setCustomDomain('test.com');
      setupStore.addEmail('test@example.com');

      // Mock successful verification
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ valid: true, account: { id: '123', name: 'Test' } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
      await setupStore.verifyToken();

      // Now reset
      setupStore.reset();

      // Verify all state is reset
      expect(setupStore.step).toBe(1);
      expect(setupStore.token).toBe('');
      expect(setupStore.tokenValid).toBe(false);
      expect(setupStore.tokenError).toBeNull();
      expect(setupStore.tokenVerifying).toBe(false);
      expect(setupStore.accountInfo).toBeNull();
      expect(setupStore.useCustomDomain).toBe(false);
      expect(setupStore.customDomain).toBe('');
      expect(setupStore.customDomainError).toBeNull();
      expect(setupStore.accessPolicy).toEqual({
        type: 'email',
        emails: [],
        domain: '',
      });
      expect(setupStore.configuring).toBe(false);
      expect(setupStore.configureSteps).toEqual([]);
      expect(setupStore.configureError).toBeNull();
      expect(setupStore.setupComplete).toBe(false);
      expect(setupStore.workersDevUrl).toBeNull();
      expect(setupStore.customDomainUrl).toBeNull();
      expect(setupStore.adminSecret).toBeNull();
      expect(setupStore.accountId).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should set tokenError when API returns invalid response', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ valid: false }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      setupStore.setToken('test-token');
      await setupStore.verifyToken();

      expect(setupStore.tokenError).toBe('Invalid token');
    });

    it('should use custom error message from API', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ valid: false, error: 'Custom error message' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      setupStore.setToken('test-token');
      await setupStore.verifyToken();

      expect(setupStore.tokenError).toBe('Custom error message');
    });
  });
});
