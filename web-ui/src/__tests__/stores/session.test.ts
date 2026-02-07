import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock terminal store before importing session store
vi.mock('../../stores/terminal', () => ({
  terminalStore: {
    dispose: vi.fn(),
    disposeSession: vi.fn(),
    triggerLayoutResize: vi.fn(),
  },
}));

// Mock constants
vi.mock('../../lib/constants', () => ({
  METRICS_POLL_INTERVAL_MS: 1000,
  MAX_TERMINALS_PER_SESSION: 6,
}));

// Mock API client
vi.mock('../../api/client', () => ({
  getSessions: vi.fn().mockResolvedValue([]),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSessionStatus: vi.fn(),
  getBatchSessionStatus: vi.fn().mockResolvedValue({}),
  getStartupStatus: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
}));

// Import after mocks
import { sessionStore } from '../../stores/session';
import * as api from '../../api/client';

// Get typed mocks
const mockGetSessions = vi.mocked(api.getSessions);
const mockCreateSession = vi.mocked(api.createSession);
const mockDeleteSession = vi.mocked(api.deleteSession);
const mockGetBatchSessionStatus = vi.mocked(api.getBatchSessionStatus);
const mockGetStartupStatus = vi.mocked(api.getStartupStatus);
const mockStopSession = vi.mocked(api.stopSession);

describe('Session Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.useFakeTimers();

    // Default mock implementations
    mockGetSessions.mockResolvedValue([]);
    mockGetBatchSessionStatus.mockResolvedValue({});
    mockGetStartupStatus.mockRejectedValue(new Error('Not found'));
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStore.stopAllMetricsPolling();
  });

  describe('loadSessions', () => {
    it('should load sessions from API', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          name: 'Test Session 1',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
        {
          id: 'session-2',
          name: 'Test Session 2',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ];
      mockGetSessions.mockResolvedValue(mockSessions);

      await sessionStore.loadSessions();

      expect(sessionStore.sessions.length).toBe(2);
      expect(sessionStore.sessions[0].id).toBe('session-1');
      expect(sessionStore.sessions[1].id).toBe('session-2');
    });

    it('should set loading state during fetch', async () => {
      let resolvePromise: (value: any) => void;
      mockGetSessions.mockReturnValue(
        new Promise((resolve) => {
          resolvePromise = resolve;
        })
      );

      const loadPromise = sessionStore.loadSessions();
      expect(sessionStore.loading).toBe(true);

      resolvePromise!([]);
      await loadPromise;

      expect(sessionStore.loading).toBe(false);
    });

    it('should set error on API failure', async () => {
      mockGetSessions.mockRejectedValue(new Error('Network error'));

      await sessionStore.loadSessions();

      expect(sessionStore.error).toBe('Network error');
    });

    it('should use batch status endpoint', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ];
      mockGetSessions.mockResolvedValue(mockSessions);
      mockGetBatchSessionStatus.mockResolvedValue({
        'session-1': { status: 'running', ptyActive: true },
      });
      mockGetStartupStatus.mockResolvedValue({
        stage: 'ready',
        progress: 100,
        message: 'Ready',
        details: {
          container: 'container-1',
          bucketName: 'test-bucket',
          path: '/workspace',
        },
      });

      await sessionStore.loadSessions();

      expect(mockGetBatchSessionStatus).toHaveBeenCalled();
    });

    it('should initialize terminals for running sessions', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          name: 'Running Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ];
      mockGetSessions.mockResolvedValue(mockSessions);
      mockGetBatchSessionStatus.mockResolvedValue({
        'session-1': { status: 'running', ptyActive: true },
      });
      mockGetStartupStatus.mockResolvedValue({
        stage: 'ready',
        progress: 100,
        message: 'Ready',
        details: {
          container: 'container-1',
          bucketName: 'test-bucket',
          path: '/workspace',
        },
      });

      await sessionStore.loadSessions();

      const terminals = sessionStore.getTerminalsForSession('session-1');
      expect(terminals).not.toBeNull();
      expect(terminals!.tabs.length).toBeGreaterThan(0);
    });

    it('should mark session as initializing if container still starting', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          name: 'Starting Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ];
      mockGetSessions.mockResolvedValue(mockSessions);
      mockGetBatchSessionStatus.mockResolvedValue({
        'session-1': { status: 'running', ptyActive: false },
      });
      mockGetStartupStatus.mockResolvedValue({
        stage: 'syncing',
        progress: 50,
        message: 'Syncing files...',
        details: {
          container: 'container-1',
          bucketName: 'test-bucket',
          path: '/workspace',
        },
      });

      await sessionStore.loadSessions();

      expect(sessionStore.isSessionInitializing('session-1')).toBe(true);
    });

    it('should discard stale results from concurrent loadSessions calls', async () => {
      let resolveFirst: (value: any) => void;
      let resolveSecond: (value: any) => void;
      mockGetSessions
        .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
        .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
      mockGetBatchSessionStatus.mockResolvedValue({});

      const firstCall = sessionStore.loadSessions();
      const secondCall = sessionStore.loadSessions();

      // Both calls proceed (generation counter allows concurrent calls)
      expect(mockGetSessions).toHaveBeenCalledTimes(2);

      // Resolve second call first (newer generation wins)
      resolveSecond!([{ id: 'session-new', name: 'New', createdAt: 'now', lastAccessedAt: 'now' }]);
      await secondCall;

      // Resolve first call later (stale generation, results discarded)
      resolveFirst!([{ id: 'session-old', name: 'Old', createdAt: 'then', lastAccessedAt: 'then' }]);
      await firstCall;

      // Only the newer generation's sessions should be in state
      expect(sessionStore.sessions.some(s => s.id === 'session-new')).toBe(true);
      expect(sessionStore.sessions.some(s => s.id === 'session-old')).toBe(false);
    });
  });

  describe('createSession', () => {
    it('should create session and add to state', async () => {
      const newSession = {
        id: 'new-session',
        name: 'New Session',
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      };
      mockCreateSession.mockResolvedValue(newSession);

      const result = await sessionStore.createSession('New Session');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('new-session');
      expect(sessionStore.sessions.some((s) => s.id === 'new-session')).toBe(true);
    });

    it('should set session status to stopped initially', async () => {
      const newSession = {
        id: 'new-session',
        name: 'New Session',
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      };
      mockCreateSession.mockResolvedValue(newSession);

      await sessionStore.createSession('New Session');

      const session = sessionStore.sessions.find((s) => s.id === 'new-session');
      expect(session?.status).toBe('stopped');
    });

    it('should return null on API failure', async () => {
      mockCreateSession.mockRejectedValue(new Error('Create failed'));

      const result = await sessionStore.createSession('New Session');

      expect(result).toBeNull();
      expect(sessionStore.error).toBe('Create failed');
    });
  });

  describe('deleteSession', () => {
    beforeEach(async () => {
      mockGetSessions.mockResolvedValue([
        {
          id: 'session-1',
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ]);
      await sessionStore.loadSessions();
    });

    it('should delete session from state', async () => {
      mockDeleteSession.mockResolvedValue(undefined);

      await sessionStore.deleteSession('session-1');

      expect(sessionStore.sessions.some((s) => s.id === 'session-1')).toBe(false);
    });

    it('should clear active session if deleted', async () => {
      mockDeleteSession.mockResolvedValue(undefined);
      sessionStore.setActiveSession('session-1');

      await sessionStore.deleteSession('session-1');

      expect(sessionStore.activeSessionId).toBeNull();
    });

    it('should clean up terminal state', async () => {
      mockDeleteSession.mockResolvedValue(undefined);
      sessionStore.initializeTerminalsForSession('session-1');

      await sessionStore.deleteSession('session-1');

      expect(sessionStore.getTerminalsForSession('session-1')).toBeNull();
    });
  });

  describe('stopSession', () => {
    beforeEach(async () => {
      mockGetSessions.mockResolvedValue([
        {
          id: 'session-1',
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ]);
      mockGetBatchSessionStatus.mockResolvedValue({ 'session-1': { status: 'running', ptyActive: true } });
      mockGetStartupStatus.mockResolvedValue({
        stage: 'ready',
        progress: 100,
        message: 'Ready',
        details: {
          container: 'container-1',
          bucketName: 'test-bucket',
          path: '/workspace',
        },
      });
      await sessionStore.loadSessions();
    });

    it('should stop session and update status', async () => {
      mockStopSession.mockResolvedValue(undefined);

      await sessionStore.stopSession('session-1');

      const session = sessionStore.sessions.find((s) => s.id === 'session-1');
      expect(session?.status).toBe('stopped');
    });

    it('should preserve terminal state (dispose without cleanup)', async () => {
      mockStopSession.mockResolvedValue(undefined);

      await sessionStore.stopSession('session-1');

      // stopSession disposes WebSockets/xterm but preserves tab structure
      // so tiling layout survives restart. Only deleteSession wipes terminal state.
      expect(sessionStore.getTerminalsForSession('session-1')).not.toBeNull();
    });

    it('should clear initialization state if in progress', async () => {
      mockStopSession.mockResolvedValue(undefined);
      // Simulate session being in initializing state
      sessionStore.initializeTerminalsForSession('session-1');

      await sessionStore.stopSession('session-1');

      expect(sessionStore.isSessionInitializing('session-1')).toBe(false);
    });
  });

  describe('setActiveSession', () => {
    beforeEach(async () => {
      mockGetSessions.mockResolvedValue([
        {
          id: 'session-1',
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ]);
      await sessionStore.loadSessions();
    });

    it('should set active session ID', () => {
      sessionStore.setActiveSession('session-1');

      expect(sessionStore.activeSessionId).toBe('session-1');
    });

    it('should update lastAccessedAt', () => {
      const before = sessionStore.sessions[0].lastAccessedAt;

      // Advance time slightly
      vi.advanceTimersByTime(1000);

      sessionStore.setActiveSession('session-1');

      const after = sessionStore.sessions[0].lastAccessedAt;
      expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
    });

    it('should allow setting to null', () => {
      sessionStore.setActiveSession('session-1');
      sessionStore.setActiveSession(null);

      expect(sessionStore.activeSessionId).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error state', async () => {
      mockGetSessions.mockRejectedValue(new Error('Test error'));
      await sessionStore.loadSessions();
      expect(sessionStore.error).not.toBeNull();

      sessionStore.clearError();

      expect(sessionStore.error).toBeNull();
    });
  });

  describe('getActiveSession', () => {
    beforeEach(async () => {
      // Clear active session first
      sessionStore.setActiveSession(null);

      mockGetSessions.mockResolvedValue([
        {
          id: 'session-1',
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ]);
      await sessionStore.loadSessions();
    });

    it('should return active session', () => {
      sessionStore.setActiveSession('session-1');

      const active = sessionStore.getActiveSession();

      expect(active?.id).toBe('session-1');
    });

    it('should return undefined when no active session', () => {
      // Ensure active session is cleared
      sessionStore.setActiveSession(null);

      const active = sessionStore.getActiveSession();

      expect(active).toBeUndefined();
    });
  });

  describe('isSessionInitializing', () => {
    it('should return false for non-initializing session', () => {
      expect(sessionStore.isSessionInitializing('session-1')).toBe(false);
    });
  });

  describe('getInitProgressForSession', () => {
    it('should return null for non-initializing session', () => {
      expect(sessionStore.getInitProgressForSession('session-1')).toBeNull();
    });
  });

  describe('dismissInitProgressForSession', () => {
    it('should clear initialization state for session', async () => {
      mockGetSessions.mockResolvedValue([
        {
          id: 'session-1',
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ]);
      mockGetBatchSessionStatus.mockResolvedValue({ 'session-1': { status: 'running', ptyActive: true } });
      mockGetStartupStatus.mockResolvedValue({
        stage: 'syncing',
        progress: 50,
        message: 'Syncing...',
        details: {
          container: 'container-1',
          bucketName: 'test-bucket',
          path: '/workspace',
        },
      });
      await sessionStore.loadSessions();

      expect(sessionStore.isSessionInitializing('session-1')).toBe(true);

      sessionStore.dismissInitProgressForSession('session-1');

      expect(sessionStore.isSessionInitializing('session-1')).toBe(false);
    });
  });

  describe('metrics polling', () => {
    beforeEach(async () => {
      mockGetSessions.mockResolvedValue([
        {
          id: 'session-1',
          name: 'Test Session',
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
        },
      ]);
      mockGetBatchSessionStatus.mockResolvedValue({ 'session-1': { status: 'running', ptyActive: true } });
      mockGetStartupStatus.mockResolvedValue({
        stage: 'ready',
        progress: 100,
        message: 'Ready',
        details: {
          container: 'container-1',
          bucketName: 'test-bucket',
          path: '/workspace',
          cpu: '5%',
          mem: '256MB',
          hdd: '1GB',
          syncStatus: 'success',
        },
      });
    });

    it('should start polling for running sessions', async () => {
      // Clear previous mock calls
      mockGetStartupStatus.mockClear();

      await sessionStore.loadSessions();

      // Get the count after loadSessions (includes initial status check and metrics fetch)
      const callsAfterLoad = mockGetStartupStatus.mock.calls.length;

      // Advance time for polling interval
      await vi.advanceTimersByTimeAsync(1000);

      // Should have polled at least once more
      expect(mockGetStartupStatus.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    });

    it('should stop polling when session stops', async () => {
      await sessionStore.loadSessions();
      const initialCallCount = mockGetStartupStatus.mock.calls.length;

      sessionStore.stopMetricsPolling('session-1');

      await vi.advanceTimersByTimeAsync(2000);

      // Call count should not increase significantly
      expect(mockGetStartupStatus.mock.calls.length).toBeLessThanOrEqual(initialCallCount + 1);
    });

    it('should store metrics in state', async () => {
      await sessionStore.loadSessions();

      const metrics = sessionStore.getMetricsForSession('session-1');

      expect(metrics).not.toBeNull();
      expect(metrics!.cpu).toBe('5%');
      expect(metrics!.mem).toBe('256MB');
    });

    it('should not start duplicate polling for same session', async () => {
      await sessionStore.loadSessions();

      // Clear mock to count only new calls
      mockGetStartupStatus.mockClear();

      // Advance one polling interval - should get exactly 1 poll
      await vi.advanceTimersByTimeAsync(1000);
      const callCount = mockGetStartupStatus.mock.calls.length;

      // Should be 1 poll, not 2 (no duplicate interval)
      expect(callCount).toBe(1);
    });

    it('stopAllMetricsPolling should stop all active polling intervals', async () => {
      await sessionStore.loadSessions();
      mockGetStartupStatus.mockClear();

      sessionStore.stopAllMetricsPolling();

      await vi.advanceTimersByTimeAsync(5000);

      // No new polls should have happened
      expect(mockGetStartupStatus.mock.calls.length).toBe(0);
    });

    it('stopMetricsPolling is idempotent (no error on double-stop)', async () => {
      await sessionStore.loadSessions();

      // Stop twice - should not throw
      sessionStore.stopMetricsPolling('session-1');
      sessionStore.stopMetricsPolling('session-1');
    });
  });

  describe('localStorage persistence', () => {
    it('should persist terminal state to localStorage', () => {
      // Use a unique session ID to avoid conflicts
      const uniqueSessionId = `session-persist-${Date.now()}`;
      sessionStore.initializeTerminalsForSession(uniqueSessionId);

      const stored = localStorage.getItem('claudeflare:terminalsPerSession');
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed[uniqueSessionId]).toBeDefined();

      // Cleanup
      sessionStore.cleanupTerminalsForSession(uniqueSessionId);
    });

    it('should restore terminal state from localStorage on store initialization', () => {
      // Use a unique session ID
      const uniqueSessionId = `session-restore-${Date.now()}`;

      // Pre-populate localStorage
      const mockState = {
        [uniqueSessionId]: {
          tabs: [{ id: '1', createdAt: new Date().toISOString() }],
          activeTabId: '1',
          tabOrder: ['1'],
          tiling: { enabled: false, layout: 'tabbed' },
        },
      };
      localStorage.setItem('claudeflare:terminalsPerSession', JSON.stringify(mockState));

      // Re-initialize the session
      sessionStore.initializeTerminalsForSession(uniqueSessionId);

      const terminals = sessionStore.getTerminalsForSession(uniqueSessionId);
      expect(terminals).not.toBeNull();

      // Cleanup
      sessionStore.cleanupTerminalsForSession(uniqueSessionId);
    });
  });
});
