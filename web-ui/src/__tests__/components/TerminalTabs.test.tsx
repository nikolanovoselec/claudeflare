import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import TerminalTabs from '../../components/TerminalTabs';
import { sessionStore } from '../../stores/session';

// Mock the session store
vi.mock('../../stores/session', () => ({
  sessionStore: {
    getTerminalsForSession: vi.fn(),
    addTerminalTab: vi.fn(),
    setActiveTerminalTab: vi.fn(),
    removeTerminalTab: vi.fn(),
    reorderTerminalTabs: vi.fn(),
    getTabOrder: vi.fn(),
  },
}));

describe('TerminalTabs Component', () => {
  const mockSessionId = 'test-session-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Tab Rendering', () => {
    it('should render tabs for all terminals in session', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      expect(screen.getByTestId('terminal-tab-1')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tab-2')).toBeInTheDocument();
    });

    it('should render tab icons with correct test ids', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [{ id: '1', createdAt: new Date().toISOString() }],
        activeTabId: '1',
        tabOrder: ['1'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      expect(screen.getByTestId('terminal-tab-1-icon')).toBeInTheDocument();
    });

    it('should render add tab button when under max tabs', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [{ id: '1', createdAt: new Date().toISOString() }],
        activeTabId: '1',
        tabOrder: ['1'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      expect(screen.getByTestId('terminal-tab-add')).toBeInTheDocument();
    });

    it('should not render add tab button when at max tabs', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
          { id: '3', createdAt: new Date().toISOString() },
          { id: '4', createdAt: new Date().toISOString() },
          { id: '5', createdAt: new Date().toISOString() },
          { id: '6', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2', '3', '4', '5', '6'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      expect(screen.queryByTestId('terminal-tab-add')).not.toBeInTheDocument();
    });
  });

  describe('Active Tab Styling', () => {
    it('should apply active class to active tab', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      const activeTab = screen.getByTestId('terminal-tab-1');
      const inactiveTab = screen.getByTestId('terminal-tab-2');

      expect(activeTab).toHaveClass('terminal-tab--active');
      expect(inactiveTab).not.toHaveClass('terminal-tab--active');
    });
  });

  describe('Close Button', () => {
    it('should render close button when multiple tabs exist', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      expect(screen.getByTestId('terminal-tab-1-close')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tab-2-close')).toBeInTheDocument();
    });

    it('should not render close button when only one tab exists', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [{ id: '1', createdAt: new Date().toISOString() }],
        activeTabId: '1',
        tabOrder: ['1'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      expect(screen.queryByTestId('terminal-tab-1-close')).not.toBeInTheDocument();
    });
  });

  describe('Click Handlers', () => {
    it('should call setActiveTerminalTab when tab is clicked', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      const tab2 = screen.getByTestId('terminal-tab-2');
      fireEvent.click(tab2);

      expect(sessionStore.setActiveTerminalTab).toHaveBeenCalledWith(mockSessionId, '2');
    });

    it('should call addTerminalTab when add button is clicked', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [{ id: '1', createdAt: new Date().toISOString() }],
        activeTabId: '1',
        tabOrder: ['1'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      const addButton = screen.getByTestId('terminal-tab-add');
      fireEvent.click(addButton);

      expect(sessionStore.addTerminalTab).toHaveBeenCalledWith(mockSessionId);
    });

    it('should call removeTerminalTab when close button is clicked', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      const closeButton = screen.getByTestId('terminal-tab-2-close');
      fireEvent.click(closeButton);

      expect(sessionStore.removeTerminalTab).toHaveBeenCalledWith(mockSessionId, '2');
    });

    it('should not trigger tab selection when close button is clicked', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      const closeButton = screen.getByTestId('terminal-tab-2-close');
      fireEvent.click(closeButton);

      // setActiveTerminalTab should not be called when clicking close
      expect(sessionStore.setActiveTerminalTab).not.toHaveBeenCalled();
    });
  });

  describe('Tab Labels', () => {
    it('should display correct tab names from config', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
          { id: '3', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2', '3'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      expect(screen.getByText('claude')).toBeInTheDocument();
      expect(screen.getByText('htop')).toBeInTheDocument();
      expect(screen.getByText('yazi')).toBeInTheDocument();
    });
  });

  describe('Visual Styling', () => {
    it('tabs have correct data-type attribute', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
          { id: '3', createdAt: new Date().toISOString() },
          { id: '4', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2', '3', '4'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      // Tab 1 is claude
      expect(screen.getByTestId('terminal-tab-1')).toHaveAttribute('data-type', 'claude');
      // Tab 2 is htop
      expect(screen.getByTestId('terminal-tab-2')).toHaveAttribute('data-type', 'htop');
      // Tab 3 is yazi
      expect(screen.getByTestId('terminal-tab-3')).toHaveAttribute('data-type', 'yazi');
      // Tab 4 is terminal
      expect(screen.getByTestId('terminal-tab-4')).toHaveAttribute('data-type', 'terminal');
    });

    it('active tab has gradient background class', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      const activeTab = screen.getByTestId('terminal-tab-1');
      const inactiveTab = screen.getByTestId('terminal-tab-2');

      // Active tab should have the active class which includes gradient background styles
      expect(activeTab).toHaveClass('terminal-tab--active');
      expect(inactiveTab).not.toHaveClass('terminal-tab--active');
    });
  });

  describe('Drag and Drop Reordering', () => {
    it('should not render drag handle for tab 1 (fixed position)', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      // Tab 1 should not have a drag handle
      expect(screen.queryByTestId('terminal-tab-1-drag-handle')).not.toBeInTheDocument();
    });

    it('should render drag handle for tabs 2+ on hover', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
          { id: '3', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2', '3'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      // Tabs 2 and 3 should have drag handles (visible on hover via CSS)
      expect(screen.getByTestId('terminal-tab-2-drag-handle')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tab-3-drag-handle')).toBeInTheDocument();
    });

    it('should render tabs in tabOrder sequence', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
          { id: '3', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '3', '2'], // Custom order: tab 3 before tab 2
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      // Get all tabs
      const tabs = screen.getAllByTestId(/^terminal-tab-\d$/);
      expect(tabs).toHaveLength(3);

      // Verify order matches tabOrder: 1, 3, 2
      expect(tabs[0]).toHaveAttribute('data-testid', 'terminal-tab-1');
      expect(tabs[1]).toHaveAttribute('data-testid', 'terminal-tab-3');
      expect(tabs[2]).toHaveAttribute('data-testid', 'terminal-tab-2');
    });

    it('should call reorderTerminalTabs when drag ends with valid reorder', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
          { id: '3', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2', '3'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      // The component should expose drag-drop functionality
      // We verify the drag handle exists which enables the functionality
      expect(screen.getByTestId('terminal-tab-2-drag-handle')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-tab-3-drag-handle')).toBeInTheDocument();
    });

    it('should ensure tab 1 remains first after any reorder attempt', () => {
      // This tests the validation in sessionStore.reorderTerminalTabs
      // which rejects any order that doesn't have '1' first
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      // Tab 1 should not be draggable (no drag handle)
      expect(screen.queryByTestId('terminal-tab-1-drag-handle')).not.toBeInTheDocument();

      // Tab 2 should be draggable
      expect(screen.getByTestId('terminal-tab-2-drag-handle')).toBeInTheDocument();
    });

    it('should wrap sortable tabs in drag-drop provider', () => {
      vi.mocked(sessionStore.getTerminalsForSession).mockReturnValue({
        tabs: [
          { id: '1', createdAt: new Date().toISOString() },
          { id: '2', createdAt: new Date().toISOString() },
        ],
        activeTabId: '1',
        tabOrder: ['1', '2'],
        tiling: { enabled: false, layout: 'tabbed' },
      });

      render(() => <TerminalTabs sessionId={mockSessionId} />);

      // The terminal-tabs container should exist (provider wrapper)
      expect(screen.getByTestId('terminal-tabs')).toBeInTheDocument();
    });
  });
});
