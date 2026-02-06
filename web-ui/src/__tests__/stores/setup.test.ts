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

    it('should have tokenDetected as false', () => {
      expect(setupStore.tokenDetected).toBe(false);
    });

    it('should have tokenDetecting as false', () => {
      expect(setupStore.tokenDetecting).toBe(false);
    });

    it('should have no token detect error', () => {
      expect(setupStore.tokenDetectError).toBeNull();
    });

    it('should have no account info', () => {
      expect(setupStore.accountInfo).toBeNull();
    });

    it('should have empty custom domain', () => {
      expect(setupStore.customDomain).toBe('');
    });

    it('should have no custom domain error', () => {
      expect(setupStore.customDomainError).toBeNull();
    });

    it('should have empty allowedUsers', () => {
      expect(setupStore.allowedUsers).toEqual([]);
    });

    it('should have empty allowedOrigins', () => {
      expect(setupStore.allowedOrigins).toEqual([]);
    });

    it('should not be configuring', () => {
      expect(setupStore.configuring).toBe(false);
    });

    it('should have empty configureSteps', () => {
      expect(setupStore.configureSteps).toEqual([]);
    });

    it('should have no configure error', () => {
      expect(setupStore.configureError).toBeNull();
    });

    it('should have setup not complete', () => {
      expect(setupStore.setupComplete).toBe(false);
    });

    it('should have no customDomainUrl', () => {
      expect(setupStore.customDomainUrl).toBeNull();
    });

    it('should have no adminSecret', () => {
      expect(setupStore.adminSecret).toBeNull();
    });

    it('should have no accountId', () => {
      expect(setupStore.accountId).toBeNull();
    });
  });

  describe('detectToken', () => {
    it('should call GET /api/setup/detect-token', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ detected: true, valid: true, account: { id: '123', name: 'Test' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.detectToken();

      expect(mockFetch).toHaveBeenCalledWith('/api/setup/detect-token');
    });

    it('should set tokenDetecting during detection', async () => {
      let resolvePromise: (value: Response) => void;
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const detectPromise = setupStore.detectToken();

      expect(setupStore.tokenDetecting).toBe(true);

      resolvePromise!(
        new Response(
          JSON.stringify({ detected: true, valid: true, account: { id: '123', name: 'Test' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await detectPromise;

      expect(setupStore.tokenDetecting).toBe(false);
    });

    it('should set tokenDetected and accountInfo on success', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            detected: true,
            valid: true,
            account: { id: 'account-123', name: 'Test Account' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.detectToken();

      expect(setupStore.tokenDetected).toBe(true);
      expect(setupStore.accountInfo).toEqual({ id: 'account-123', name: 'Test Account' });
      expect(setupStore.tokenDetectError).toBeNull();
    });

    it('should set error when token not detected', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ detected: false, error: 'No token found in environment' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.detectToken();

      expect(setupStore.tokenDetected).toBe(false);
      expect(setupStore.tokenDetectError).toBe('No token found in environment');
    });

    it('should set error when token detected but invalid', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ detected: true, valid: false, error: 'Token lacks required permissions' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.detectToken();

      expect(setupStore.tokenDetected).toBe(false);
      expect(setupStore.tokenDetectError).toBe('Token lacks required permissions');
    });

    it('should use default error message when API returns no error string', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ detected: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.detectToken();

      expect(setupStore.tokenDetectError).toBe('Token not detected');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await setupStore.detectToken();

      expect(setupStore.tokenDetected).toBe(false);
      expect(setupStore.tokenDetectError).toBe('Failed to detect token');
    });

    it('should clear previous error on new detection attempt', async () => {
      // First call fails
      mockFetch.mockRejectedValue(new Error('Network error'));
      await setupStore.detectToken();
      expect(setupStore.tokenDetectError).toBe('Failed to detect token');

      // Second call succeeds
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ detected: true, valid: true, account: { id: '123', name: 'Test' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
      await setupStore.detectToken();

      expect(setupStore.tokenDetectError).toBeNull();
      expect(setupStore.tokenDetected).toBe(true);
    });
  });

  describe('allowedUsers management', () => {
    it('should add an allowed user', () => {
      setupStore.addAllowedUser('user@example.com');

      expect(setupStore.allowedUsers).toContain('user@example.com');
    });

    it('should add multiple allowed users', () => {
      setupStore.addAllowedUser('user1@example.com');
      setupStore.addAllowedUser('user2@example.com');

      expect(setupStore.allowedUsers).toEqual(['user1@example.com', 'user2@example.com']);
    });

    it('should not add duplicate user', () => {
      setupStore.addAllowedUser('user@example.com');
      setupStore.addAllowedUser('user@example.com');

      expect(setupStore.allowedUsers.length).toBe(1);
    });

    it('should not add empty string', () => {
      setupStore.addAllowedUser('');

      expect(setupStore.allowedUsers.length).toBe(0);
    });

    it('should remove an allowed user', () => {
      setupStore.addAllowedUser('user1@example.com');
      setupStore.addAllowedUser('user2@example.com');

      setupStore.removeAllowedUser('user1@example.com');

      expect(setupStore.allowedUsers).not.toContain('user1@example.com');
      expect(setupStore.allowedUsers).toContain('user2@example.com');
    });

    it('should handle removing non-existent user gracefully', () => {
      setupStore.addAllowedUser('user@example.com');
      setupStore.removeAllowedUser('nonexistent@example.com');

      expect(setupStore.allowedUsers).toEqual(['user@example.com']);
    });
  });

  describe('allowedOrigins management', () => {
    it('should set allowed origins', () => {
      setupStore.setAllowedOrigins(['https://example.com', 'https://app.example.com']);

      expect(setupStore.allowedOrigins).toEqual(['https://example.com', 'https://app.example.com']);
    });

    it('should replace existing origins', () => {
      setupStore.setAllowedOrigins(['https://old.com']);
      setupStore.setAllowedOrigins(['https://new.com']);

      expect(setupStore.allowedOrigins).toEqual(['https://new.com']);
    });

    it('should allow setting empty array', () => {
      setupStore.setAllowedOrigins(['https://example.com']);
      setupStore.setAllowedOrigins([]);

      expect(setupStore.allowedOrigins).toEqual([]);
    });
  });

  describe('custom domain', () => {
    it('should set custom domain', () => {
      setupStore.setCustomDomain('my-app.example.com');

      expect(setupStore.customDomain).toBe('my-app.example.com');
    });

    it('should clear customDomainError when setting domain', () => {
      setupStore.setCustomDomain('new-domain.com');

      expect(setupStore.customDomainError).toBeNull();
    });
  });

  describe('step navigation', () => {
    it('should go to next step', () => {
      setupStore.nextStep();

      expect(setupStore.step).toBe(2);
    });

    it('should go to step 3 (max)', () => {
      setupStore.nextStep(); // 1 -> 2
      setupStore.nextStep(); // 2 -> 3

      expect(setupStore.step).toBe(3);
    });

    it('should not go beyond step 3', () => {
      setupStore.nextStep(); // 1 -> 2
      setupStore.nextStep(); // 2 -> 3
      setupStore.nextStep(); // 3 -> still 3

      expect(setupStore.step).toBe(3);
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

    it('should clamp goToStep to valid range', () => {
      setupStore.goToStep(5);

      expect(setupStore.step).toBe(3);
    });

    it('should clamp goToStep minimum to 1', () => {
      setupStore.goToStep(0);

      expect(setupStore.step).toBe(1);
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

    it('should send customDomain, allowedUsers, and allowedOrigins in request body', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true, steps: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      setupStore.setCustomDomain('my-app.example.com');
      setupStore.addAllowedUser('user@example.com');
      setupStore.setAllowedOrigins(['https://example.com']);

      await setupStore.configure();

      const [url, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(url).toBe('/api/setup/configure');
      expect(body.customDomain).toBe('my-app.example.com');
      expect(body.allowedUsers).toEqual(['user@example.com']);
      expect(body.allowedOrigins).toEqual(['https://example.com']);
    });

    it('should not include allowedOrigins when empty', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true, steps: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      setupStore.setCustomDomain('my-app.example.com');
      setupStore.addAllowedUser('user@example.com');

      await setupStore.configure();

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.allowedOrigins).toBeUndefined();
    });

    it('should not include token in request body', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true, steps: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await setupStore.configure();

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.token).toBeUndefined();
    });

    it('should return true and set setupComplete on success', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            steps: [{ step: 'Create R2', status: 'success' }],
            customDomainUrl: 'https://my-app.example.com',
            adminSecret: 'secret-123',
            accountId: 'acc-456',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const result = await setupStore.configure();

      expect(result).toBe(true);
      expect(setupStore.setupComplete).toBe(true);
      expect(setupStore.customDomainUrl).toBe('https://my-app.example.com');
      expect(setupStore.adminSecret).toBe('secret-123');
      expect(setupStore.accountId).toBe('acc-456');
    });

    it('should return false and set error on failure', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: 'Configuration failed',
            steps: [{ step: 'Create R2', status: 'failed', error: 'R2 error' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
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
          { status: 200, headers: { 'Content-Type': 'application/json' } }
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
            customDomainUrl: 'https://my-app.example.com',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
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
            adminSecret: 'secret-123',
            accountId: 'acc-456',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.configure();

      expect(setupStore.accountId).toBe('acc-456');
    });

    it('should clear configureSteps and error before starting', async () => {
      // First configure call fails
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: 'First failure',
            steps: [{ step: 'Step 1', status: 'failed' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
      await setupStore.configure();
      expect(setupStore.configureError).toBe('First failure');

      // Second configure call - should start fresh
      let resolvePromise: (value: Response) => void;
      mockFetch.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const configurePromise = setupStore.configure();

      // During the request, old error and steps should be cleared
      expect(setupStore.configureError).toBeNull();
      expect(setupStore.configureSteps).toEqual([]);

      resolvePromise!(
        new Response(JSON.stringify({ success: true, steps: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await configurePromise;
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', async () => {
      // Modify state
      setupStore.nextStep();
      setupStore.setCustomDomain('test.com');
      setupStore.addAllowedUser('user@example.com');
      setupStore.setAllowedOrigins(['https://example.com']);

      // Mock successful detect
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ detected: true, valid: true, account: { id: '123', name: 'Test' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
      await setupStore.detectToken();

      // Now reset
      setupStore.reset();

      // Verify all state is reset
      expect(setupStore.step).toBe(1);
      expect(setupStore.tokenDetected).toBe(false);
      expect(setupStore.tokenDetecting).toBe(false);
      expect(setupStore.tokenDetectError).toBeNull();
      expect(setupStore.accountInfo).toBeNull();
      expect(setupStore.customDomain).toBe('');
      expect(setupStore.customDomainError).toBeNull();
      expect(setupStore.allowedUsers).toEqual([]);
      expect(setupStore.allowedOrigins).toEqual([]);
      expect(setupStore.configuring).toBe(false);
      expect(setupStore.configureSteps).toEqual([]);
      expect(setupStore.configureError).toBeNull();
      expect(setupStore.setupComplete).toBe(false);
      expect(setupStore.customDomainUrl).toBeNull();
      expect(setupStore.adminSecret).toBeNull();
      expect(setupStore.accountId).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should set tokenDetectError when API returns no detected/valid flags', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ detected: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.detectToken();

      expect(setupStore.tokenDetectError).toBe('Token not detected');
    });

    it('should use custom error message from detect API', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ detected: false, error: 'Custom error message' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.detectToken();

      expect(setupStore.tokenDetectError).toBe('Custom error message');
    });

    it('should use default error for configure failure without message', async () => {
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ success: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await setupStore.configure();

      expect(setupStore.configureError).toBe('Configuration failed');
    });
  });
});
