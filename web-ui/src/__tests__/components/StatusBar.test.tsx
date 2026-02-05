import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';
import StatusBar from '../../components/StatusBar';

describe('StatusBar Component', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Default Rendering', () => {
    it('should render with required elements', () => {
      render(() => <StatusBar isConnected={true} />);

      // Connection status
      const connection = screen.getByTestId('status-bar-connection');
      expect(connection).toBeInTheDocument();

      // Sync time
      const syncTime = screen.getByTestId('status-bar-sync-time');
      expect(syncTime).toBeInTheDocument();
    });
  });

  describe('Connection Status', () => {
    it('should show connected status when connected', () => {
      render(() => <StatusBar isConnected={true} />);
      const connection = screen.getByTestId('status-bar-connection');

      expect(connection).toHaveTextContent(/connected/i);
    });

    it('should show disconnected status when not connected', () => {
      render(() => <StatusBar isConnected={false} />);
      const connection = screen.getByTestId('status-bar-connection');

      expect(connection).toHaveTextContent(/disconnected/i);
    });

    it('should have success indicator when connected', () => {
      render(() => <StatusBar isConnected={true} />);
      const connection = screen.getByTestId('status-bar-connection');

      // Should have success color class or attribute
      expect(connection).toHaveAttribute('data-status', 'connected');
    });

    it('should have error indicator when disconnected', () => {
      render(() => <StatusBar isConnected={false} />);
      const connection = screen.getByTestId('status-bar-connection');

      expect(connection).toHaveAttribute('data-status', 'disconnected');
    });
  });

  describe('Sync Time Display', () => {
    it('should show last sync time when provided', () => {
      const now = new Date();
      render(() => <StatusBar isConnected={true} lastSyncTime={now} />);
      const syncTime = screen.getByTestId('status-bar-sync-time');

      expect(syncTime).toHaveTextContent(/just now|0s|sync/i);
    });

    it('should show "2m ago" for 2 minutes old sync time', () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      render(() => <StatusBar isConnected={true} lastSyncTime={twoMinutesAgo} />);
      const syncTime = screen.getByTestId('status-bar-sync-time');

      expect(syncTime).toHaveTextContent(/2m/i);
    });

    it('should show "never" when no sync time provided', () => {
      render(() => <StatusBar isConnected={true} />);
      const syncTime = screen.getByTestId('status-bar-sync-time');

      expect(syncTime).toHaveTextContent(/never|--/i);
    });
  });

  describe('Icon Rendering', () => {
    it('should render connection icon', () => {
      render(() => <StatusBar isConnected={true} />);
      const connection = screen.getByTestId('status-bar-connection');
      const icon = connection.querySelector('svg');

      expect(icon).toBeInTheDocument();
    });

    it('should render sync icon', () => {
      render(() => <StatusBar isConnected={true} />);
      const syncTime = screen.getByTestId('status-bar-sync-time');
      const icon = syncTime.querySelector('svg');

      expect(icon).toBeInTheDocument();
    });
  });
});
