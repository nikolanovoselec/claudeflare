import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import SessionList from '../../components/SessionList';
import type { SessionWithStatus } from '../../types';

// Mock the stores
vi.mock('../../stores/session', () => ({
  sessionStore: {
    getTerminalsForSession: vi.fn(() => ({ tabs: [{ id: '1' }, { id: '2' }] })),
    getInitProgressForSession: vi.fn(() => ({ progress: 50 })),
    getMetricsForSession: vi.fn(() => ({
      bucketName: 'claudeflare-test',
      syncStatus: 'success',
      cpu: '15%',
      mem: '1.2/3.0G',
      hdd: '2.1G/10G',
    })),
  },
}));

vi.mock('../../stores/terminal', () => ({
  terminalStore: {
    getConnectionState: vi.fn(() => 'connected'),
  },
}));

// Helper to create mock sessions
function createMockSession(
  overrides: Partial<SessionWithStatus> = {}
): SessionWithStatus {
  const id = overrides.id || 'session-1';
  return {
    id,
    name: overrides.name || 'Test Session',
    createdAt: overrides.createdAt || new Date().toISOString(),
    lastAccessedAt: overrides.lastAccessedAt || new Date().toISOString(),
    status: overrides.status || 'stopped',
    ...overrides,
  };
}

describe('SessionList Component', () => {
  const defaultProps = {
    sessions: [] as SessionWithStatus[],
    activeSessionId: null,
    onSelectSession: vi.fn(),
    onStartSession: vi.fn(),
    onStopSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onCreateSession: vi.fn(),
    onReconnect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Empty State', () => {
    it('should show empty list when no sessions (empty state shown in main area instead)', () => {
      render(() => <SessionList {...defaultProps} />);

      // Session list should be empty - no sidebar empty state
      // The "Welcome to Claudeflare" empty state is shown in the main area, not here
      expect(screen.queryByTestId('session-list-empty')).not.toBeInTheDocument();
      expect(screen.queryByTestId('empty-state-no-sessions')).not.toBeInTheDocument();
    });

    it('should show search empty message when search has no results', () => {
      const sessions = [createMockSession({ id: '1', name: 'Test Session' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      // Type in search
      const searchInput = screen.getByPlaceholderText('Search sessions...');
      fireEvent.input(searchInput, { target: { value: 'nonexistent' } });

      expect(screen.getByTestId('empty-state-no-results')).toBeInTheDocument();
      expect(screen.getByText('No Results')).toBeInTheDocument();
    });
  });

  describe('Search Functionality', () => {
    it('should filter sessions by name', () => {
      const sessions = [
        createMockSession({ id: '1', name: 'Development' }),
        createMockSession({ id: '2', name: 'Production' }),
        createMockSession({ id: '3', name: 'Staging' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      // All sessions visible initially
      expect(screen.getByTestId('session-card-1')).toBeInTheDocument();
      expect(screen.getByTestId('session-card-2')).toBeInTheDocument();
      expect(screen.getByTestId('session-card-3')).toBeInTheDocument();

      // Type in search
      const searchInput = screen.getByPlaceholderText('Search sessions...');
      fireEvent.input(searchInput, { target: { value: 'dev' } });

      // Only Development visible
      expect(screen.getByTestId('session-card-1')).toBeInTheDocument();
      expect(screen.queryByTestId('session-card-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('session-card-3')).not.toBeInTheDocument();
    });

    it('should be case insensitive', () => {
      const sessions = [
        createMockSession({ id: '1', name: 'Development' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const searchInput = screen.getByPlaceholderText('Search sessions...');
      fireEvent.input(searchInput, { target: { value: 'DEVELOPMENT' } });

      expect(screen.getByTestId('session-card-1')).toBeInTheDocument();
    });
  });

  describe('Session Cards', () => {
    it('should display session name', () => {
      const sessions = [
        createMockSession({ id: '1', name: 'My Session' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      expect(screen.getByText('My Session')).toBeInTheDocument();
    });

    it('should display CPU metric for running sessions', () => {
      const sessions = [
        createMockSession({ id: '1', status: 'running' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const cpuElement = screen.getByTestId('session-card-1-metric-cpu');
      expect(cpuElement).toBeInTheDocument();
    });

    it('should display MEM metric for running sessions', () => {
      const sessions = [
        createMockSession({ id: '1', status: 'running' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const memElement = screen.getByTestId('session-card-1-metric-mem');
      expect(memElement).toBeInTheDocument();
    });

    it('should display HDD metric for running sessions', () => {
      const sessions = [
        createMockSession({ id: '1', status: 'running' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const hddElement = screen.getByTestId('session-card-1-metric-hdd');
      expect(hddElement).toBeInTheDocument();
    });

    it('should not display metrics for stopped sessions', () => {
      const sessions = [
        createMockSession({ id: '1', status: 'stopped' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      expect(screen.queryByTestId('session-card-1-metric-cpu')).not.toBeInTheDocument();
    });

    it('should display progress bar for initializing sessions', () => {
      const sessions = [
        createMockSession({ id: '1', status: 'initializing' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      expect(screen.getByTestId('session-card-1-progress')).toBeInTheDocument();
    });

    it('should not display progress bar for non-initializing sessions', () => {
      const sessions = [
        createMockSession({ id: '1', status: 'running' }),
      ];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      expect(screen.queryByTestId('session-card-1-progress')).not.toBeInTheDocument();
    });
  });

  describe('Session Actions', () => {
    it('should call onSelectSession when clicking a card', () => {
      const sessions = [createMockSession({ id: '1' })];
      const onSelectSession = vi.fn();
      render(() => (
        <SessionList {...defaultProps} sessions={sessions} onSelectSession={onSelectSession} />
      ));

      // Click on the inner session-card element (not the wrapper)
      const cardWrapper = screen.getByTestId('session-card-1');
      const innerCard = cardWrapper.querySelector('.session-card') as HTMLElement;
      fireEvent.click(innerCard);

      expect(onSelectSession).toHaveBeenCalledWith('1');
    });

    it('should show delete button for stopped sessions (start via card click)', () => {
      const sessions = [createMockSession({ id: '1', status: 'stopped' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      // Hover to reveal actions
      const card = screen.getByTestId('session-card-1');
      fireEvent.mouseOver(card);

      // Stopped sessions show Delete button in overlay (start is triggered by card click)
      const deleteButton = screen.getByTitle('Delete session');
      expect(deleteButton).toBeInTheDocument();
    });

    it('should show stop button for running sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const card = screen.getByTestId('session-card-1');
      fireEvent.mouseOver(card);

      const stopButton = screen.getByTitle('Stop session');
      expect(stopButton).toBeInTheDocument();
    });

    it('should show delete button for non-initializing sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'stopped' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const card = screen.getByTestId('session-card-1');
      fireEvent.mouseOver(card);

      const deleteButton = screen.getByTitle('Delete session');
      expect(deleteButton).toBeInTheDocument();
    });
  });

  describe('Button Visibility During Startup', () => {
    it('should show delete button for initializing sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'initializing' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const card = screen.getByTestId('session-card-1');
      fireEvent.mouseOver(card);

      // Critical fix: Users must be able to delete stuck sessions during initialization
      expect(screen.getByTitle('Delete session')).toBeInTheDocument();
    });

    it('should show stop button for initializing sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'initializing' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const card = screen.getByTestId('session-card-1');
      fireEvent.mouseOver(card);

      // Allow stopping sessions during initialization
      expect(screen.getByTitle('Stop session')).toBeInTheDocument();
    });

    it('should show delete button for all session statuses', () => {
      const statuses: Array<'stopped' | 'running' | 'initializing' | 'error'> = ['stopped', 'running', 'initializing', 'error'];
      statuses.forEach(status => {
        cleanup();
        const sessions = [createMockSession({ id: '1', status })];
        render(() => <SessionList {...defaultProps} sessions={sessions} />);
        const card = screen.getByTestId('session-card-1');
        fireEvent.mouseOver(card);
        expect(screen.getByTitle('Delete session')).toBeInTheDocument();
      });
    });
  });

  describe('Create Session', () => {
    it('should show create button initially', () => {
      render(() => <SessionList {...defaultProps} />);

      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    it('should show input when create button is clicked', () => {
      render(() => <SessionList {...defaultProps} />);

      fireEvent.click(screen.getByText('New Session'));

      expect(screen.getByPlaceholderText('Session name...')).toBeInTheDocument();
    });

    it('should call onCreateSession when input is submitted', () => {
      const onCreateSession = vi.fn();
      render(() => <SessionList {...defaultProps} onCreateSession={onCreateSession} />);

      fireEvent.click(screen.getByText('New Session'));

      const input = screen.getByPlaceholderText('Session name...');
      fireEvent.input(input, { target: { value: 'New Test Session' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCreateSession).toHaveBeenCalledWith('New Test Session');
    });

    it('should hide input when Escape is pressed', () => {
      render(() => <SessionList {...defaultProps} />);

      fireEvent.click(screen.getByText('New Session'));
      const input = screen.getByPlaceholderText('Session name...');

      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByPlaceholderText('Session name...')).not.toBeInTheDocument();
    });
  });

  describe('Active Session', () => {
    it('should highlight active session', () => {
      const sessions = [
        createMockSession({ id: '1', name: 'Session 1' }),
        createMockSession({ id: '2', name: 'Session 2' }),
      ];
      render(() => (
        <SessionList {...defaultProps} sessions={sessions} activeSessionId="1" />
      ));

      // Active session has session-card--active class
      const card1 = screen.getByTestId('session-card-1').querySelector('.session-card--active');
      const card2 = screen.getByTestId('session-card-2').querySelector('.session-card:not(.session-card--active)');

      expect(card1).toBeInTheDocument();
      expect(card2).toBeInTheDocument();
    });
  });

  describe('Visual Enhancements', () => {
    it('session card has gradient background', () => {
      const sessions = [createMockSession({ id: '1', name: 'Test Session' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const card = screen.getByTestId('session-card-1').querySelector('.session-card');
      expect(card).toBeInTheDocument();
      // The card should have the session-card-gradient class for gradient styling
      expect(card).toHaveClass('session-card-gradient');
    });

    it('live badge has shimmer animation class', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const badge = screen.getByTestId('session-card-1').querySelector('.session-status-badge');
      expect(badge).toBeInTheDocument();
      // Live badge should have shimmer class for animated effect
      expect(badge).toHaveClass('session-badge-shimmer');
    });

    it('metrics section shows CPU for running sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const cpuElement = screen.getByTestId('session-card-1-metric-cpu');
      expect(cpuElement).toBeInTheDocument();
      expect(cpuElement.querySelector('.metric-label')?.textContent).toBe('CPU');
    });

    it('metrics section shows MEM for running sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const memElement = screen.getByTestId('session-card-1-metric-mem');
      expect(memElement).toBeInTheDocument();
      expect(memElement.querySelector('.metric-label')?.textContent).toBe('MEM');
    });

    it('live badge includes status dot', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const badge = screen.getByTestId('session-card-1').querySelector('.session-status-badge');
      expect(badge).toBeInTheDocument();
      // Badge should contain a status dot span
      const dot = badge?.querySelector('.session-status-dot');
      expect(dot).toBeInTheDocument();
    });

    it('active running session has glow effect class', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => (
        <SessionList {...defaultProps} sessions={sessions} activeSessionId="1" />
      ));

      const card = screen.getByTestId('session-card-1').querySelector('.session-card--active');
      expect(card).toBeInTheDocument();
      // Active running card should have the glow class
      expect(card).toHaveClass('session-card-glow');
    });
  });

  describe('LIVE Badge Positioning', () => {
    it('should position badge at right edge of header', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const header = screen.getByTestId('session-card-1').querySelector('.session-card-header');
      expect(header).toBeInTheDocument();

      // Header uses flexbox with justify-content: space-between (via CSS class)
      // Badge should be the second element in header (after session-name)
      const badge = header?.querySelector('.session-status-badge');
      expect(badge).toBeInTheDocument();

      // Verify header has the correct class that applies flex layout
      expect(header).toHaveClass('session-card-header');

      // Verify DOM structure: session-name first, badge second
      const children = header?.children;
      expect(children?.[0]).toHaveClass('session-name');
      expect(children?.[1]).toHaveClass('session-status-badge');
    });

    it('should have consistent right padding matching left text padding', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const card = screen.getByTestId('session-card-1').querySelector('.session-card');
      expect(card).toBeInTheDocument();

      // Card has session-card class which applies 12px padding via external CSS
      expect(card).toHaveClass('session-card');
    });
  });

  describe('Slide-in Action Buttons', () => {
    it('should render actions in overlay container outside card', () => {
      const sessions = [createMockSession({ id: '1', status: 'stopped' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const wrapper = screen.getByTestId('session-card-1');
      expect(wrapper).toHaveClass('session-card-wrapper');

      // The wrapper should contain the session-card
      const card = wrapper.querySelector('.session-card');
      expect(card).toBeInTheDocument();

      // Actions overlay should be sibling of session-card inside wrapper
      const actionsOverlay = wrapper.querySelector('.session-card-actions-overlay');
      expect(actionsOverlay).toBeInTheDocument();

      // Verify it's a sibling (not inside card)
      expect(card?.contains(actionsOverlay)).toBe(false);
    });

    it('should hide actions off-screen by default (translateX 100%)', () => {
      const sessions = [createMockSession({ id: '1', status: 'stopped' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const actionsOverlay = screen.getByTestId('session-card-1').querySelector('.session-card-actions-overlay');
      expect(actionsOverlay).toBeInTheDocument();

      // Actions overlay exists and contains buttons that are hidden by CSS transform/opacity
      // The overlay slides in from right side when card is hovered
      const buttons = actionsOverlay?.querySelectorAll('button');
      expect(buttons?.length).toBeGreaterThan(0);
    });

    it('should slide actions into view on card hover', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const wrapper = screen.getByTestId('session-card-1');
      const actionsOverlay = wrapper.querySelector('.session-card-actions-overlay');
      expect(actionsOverlay).toBeInTheDocument();

      // Hover over the wrapper to trigger slide-in
      fireEvent.mouseOver(wrapper);

      // Stop button should be visible for running sessions
      const stopButton = screen.getByTitle('Stop session');
      expect(stopButton).toBeInTheDocument();
    });

    it('should stack buttons vertically', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const actionsOverlay = screen.getByTestId('session-card-1').querySelector('.session-card-actions-overlay');
      expect(actionsOverlay).toBeInTheDocument();

      // Actions overlay contains multiple buttons stacked
      const buttons = actionsOverlay?.querySelectorAll('button');
      // Running session should have Stop + Delete buttons
      expect(buttons?.length).toBe(2);
    });

    it('should center buttons on card height', () => {
      const sessions = [createMockSession({ id: '1', status: 'stopped' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      // Session card wrapper contains both card and actions overlay
      const wrapper = screen.getByTestId('session-card-1');
      expect(wrapper).toHaveClass('session-card-wrapper');

      // Both card and overlay should be vertically aligned
      const card = wrapper.querySelector('.session-card');
      const actionsOverlay = wrapper.querySelector('.session-card-actions-overlay');
      expect(card).toBeInTheDocument();
      expect(actionsOverlay).toBeInTheDocument();
    });
  });

  describe('Developer Metrics Section', () => {
    it('should render metrics section for running sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      // Metrics section should be present for running sessions
      const metricsSection = screen.getByTestId('session-metrics');
      expect(metricsSection).toBeInTheDocument();
    });

    it('should NOT render metrics for stopped sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'stopped' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      // CPU metric should not be displayed for stopped sessions
      expect(screen.queryByTestId('session-card-1-metric-cpu')).not.toBeInTheDocument();
    });

    it('should display CPU metric', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const cpuElement = screen.getByTestId('session-card-1-metric-cpu');
      expect(cpuElement).toBeInTheDocument();
      expect(cpuElement.querySelector('.metric-label')?.textContent).toBe('CPU');
    });

    it('should display MEM metric', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const memElement = screen.getByTestId('session-card-1-metric-mem');
      expect(memElement).toBeInTheDocument();
      expect(memElement.querySelector('.metric-label')?.textContent).toBe('MEM');
    });

    it('should display HDD metric', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const hddElement = screen.getByTestId('session-card-1-metric-hdd');
      expect(hddElement).toBeInTheDocument();
      expect(hddElement.querySelector('.metric-label')?.textContent).toBe('HDD');
    });

    it('should display R2 bucket name', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const bucketElement = screen.getByTestId('session-card-1-metric-bucket');
      expect(bucketElement).toBeInTheDocument();
      expect(bucketElement.querySelector('.metric-label')?.textContent).toBe('R2 Bucket');
      // Mock returns claudeflare-test
      expect(bucketElement.querySelector('.metric-value')?.textContent).toBe('claudeflare-test');
    });

    it('should render bucket on its own row for full width', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const bucketMetric = screen.getByTestId('session-card-1-metric-bucket');
      const bucketRow = bucketMetric.closest('.session-card-metrics-row');

      // Bucket should be the only metric in its row
      const metricsInRow = bucketRow?.querySelectorAll('.session-card-metric');
      expect(metricsInRow?.length).toBe(1);
    });

    it('should have full-width class on bucket metric', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const bucketMetric = screen.getByTestId('session-card-1-metric-bucket');
      expect(bucketMetric).toHaveClass('session-card-metric--full');
    });

    it('should display sync status', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const syncElement = screen.getByTestId('session-card-1-metric-sync');
      expect(syncElement).toBeInTheDocument();
      expect(syncElement.querySelector('.metric-label')?.textContent).toBe('Sync');
      // Should have status dot
      const statusDot = syncElement.querySelector('.status-dot');
      expect(statusDot).toBeInTheDocument();
    });

    it('should style metrics like DETAILS panel (dark boxes)', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const metricsSection = screen.getByTestId('session-metrics');
      expect(metricsSection).toBeInTheDocument();

      // Metrics section should contain metric values with the right class
      const metricValues = metricsSection.querySelectorAll('.metric-value');
      expect(metricValues.length).toBeGreaterThan(0);
    });

    it('should display terminal count for running sessions', () => {
      const sessions = [createMockSession({ id: '1', status: 'running' })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const terminalsElement = screen.getByTestId('session-card-1-metric-terminals');
      expect(terminalsElement).toBeInTheDocument();
      expect(terminalsElement.querySelector('.metric-label')?.textContent).toBe('Terminals');
      // Mock returns 2 tabs
      expect(terminalsElement.querySelector('.metric-value')?.textContent).toBe('2/6');
    });

    it('should display uptime for running sessions', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const sessions = [createMockSession({ id: '1', status: 'running', createdAt: twoHoursAgo })];
      render(() => <SessionList {...defaultProps} sessions={sessions} />);

      const uptimeElement = screen.getByTestId('session-card-1-metric-uptime');
      expect(uptimeElement).toBeInTheDocument();
      expect(uptimeElement.querySelector('.metric-label')?.textContent).toBe('Age');
      // Should display "2h" for 2 hours
      expect(uptimeElement.querySelector('.metric-value')?.textContent).toMatch(/2h/);
    });
  });

});
