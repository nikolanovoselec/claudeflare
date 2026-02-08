import { Component, Show, createMemo } from 'solid-js';
import {
  mdiLan,
  mdiLanDisconnect,
  mdiSync,
} from '@mdi/js';
import Icon from './Icon';
import '../styles/status-bar.css';
import { formatRelativeTime } from '../lib/format';

export interface StatusBarProps {
  isConnected: boolean;
  lastSyncTime?: Date;
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

    </footer>
  );
};

export default StatusBar;
