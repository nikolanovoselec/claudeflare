import { Component, Show, createMemo } from 'solid-js';
import {
  mdiLan,
  mdiLanDisconnect,
  mdiSync,
} from '@mdi/js';
import Icon from './Icon';

export interface StatusBarProps {
  isConnected: boolean;
  lastSyncTime?: Date;
}

/**
 * Format relative time from a date
 */
function formatRelativeTime(date: Date | undefined): string {
  if (!date) return '--';

  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return 'over a day ago';
}

/**
 * StatusBar component - bottom bar with connection status and sync info
 *
 * Layout:
 * +------------------------------------------------------------------+
 * | [Lan] Connected  |  [Sync] Last sync: 2m ago  |
 * +------------------------------------------------------------------+
 */
const StatusBar: Component<StatusBarProps> = (props) => {
  const relativeTime = createMemo(() => formatRelativeTime(props.lastSyncTime));

  return (
    <footer class="status-bar">
      {/* Connection status */}
      <div
        class="status-bar-item"
        data-testid="status-bar-connection"
        data-status={props.isConnected ? 'connected' : 'disconnected'}
      >
        <Icon
          path={props.isConnected ? mdiLan : mdiLanDisconnect}
          size={14}
          class={`status-bar-icon ${props.isConnected ? 'status-bar-icon--success' : 'status-bar-icon--error'}`}
        />
        <span class={props.isConnected ? 'status-bar-text--success' : 'status-bar-text--error'}>
          {props.isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div class="status-bar-separator" />

      {/* Sync status */}
      <div class="status-bar-item" data-testid="status-bar-sync-time">
        <Icon path={mdiSync} size={14} class="status-bar-icon" />
        <span>Last sync: {relativeTime()}</span>
      </div>

      <div class="status-bar-spacer" />

      <style>{`
        .status-bar {
          display: flex;
          align-items: center;
          height: var(--status-bar-height);
          padding: 0 var(--space-3);
          background: var(--color-bg-surface);
          border-top: 1px solid var(--color-border-subtle);
          font-size: var(--text-xs);
          color: var(--color-text-muted);
          gap: var(--space-2);
        }

        .status-bar-item {
          display: flex;
          align-items: center;
          gap: var(--space-1);
        }

        .status-bar-icon {
          flex-shrink: 0;
          color: var(--color-text-dimmed);
        }

        .status-bar-icon--success {
          color: var(--color-success);
        }

        .status-bar-icon--error {
          color: var(--color-error);
        }

        .status-bar-text--success {
          color: var(--color-success);
        }

        .status-bar-text--error {
          color: var(--color-error);
        }

        .status-bar-separator {
          width: 1px;
          height: 12px;
          background: var(--color-border-subtle);
          margin: 0 var(--space-1);
        }

        .status-bar-spacer {
          flex: 1;
        }
      `}</style>
    </footer>
  );
};

export default StatusBar;
