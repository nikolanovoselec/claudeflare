import { Component, Show, Accessor } from 'solid-js';
import {
  mdiStop,
  mdiLoading,
  mdiTrashCanOutline,
} from '@mdi/js';
import Icon from './Icon';
import type { SessionWithStatus, SessionStatus, TerminalConnectionState } from '../types';
import { sessionStore } from '../stores/session';
import { terminalStore } from '../stores/terminal';
import { MAX_TERMINALS_PER_SESSION } from '../lib/constants';

export interface SessionCardProps {
  session: SessionWithStatus;
  index: Accessor<number>;
  isActive: boolean;
  onSelect: () => void;
  onStop: () => void;
  onDelete: () => void;
  onReconnect?: () => void;
}

// WebSocket connection status config
const wsStatusConfig: Record<TerminalConnectionState, { color: string; title: string }> = {
  connected: { color: 'var(--color-success)', title: 'WebSocket connected' },
  disconnected: { color: 'var(--color-error)', title: 'WebSocket disconnected - click to reconnect' },
  connecting: { color: 'var(--color-warning)', title: 'WebSocket connecting... - click to force reconnect' },
  error: { color: 'var(--color-error)', title: 'WebSocket error - click to reconnect' },
};

// Status indicator icons and colors
const statusConfig: Record<SessionStatus, { icon: string; color: string; spinning?: boolean }> = {
  running: { icon: '', color: 'var(--color-success)' },
  stopped: { icon: '', color: 'var(--color-text-muted)' },
  initializing: { icon: mdiLoading, color: 'var(--color-accent)', spinning: true },
  error: { icon: '', color: 'var(--color-error)' },
};

// Status dot variant mapping
const statusDotVariant: Record<SessionStatus, 'success' | 'warning' | 'error' | 'default'> = {
  running: 'success',
  stopped: 'default',
  initializing: 'warning',
  error: 'error',
};

// Format uptime (compact format for metrics display)
export function formatUptime(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const SessionCard: Component<SessionCardProps> = (props) => {
  const config = () => statusConfig[props.session.status];
  const canStop = () => props.session.status === 'running' || props.session.status === 'initializing';
  const canDelete = () => true;
  const wsState = () => terminalStore.getConnectionState(props.session.id, '1');
  const wsConfig = () => wsStatusConfig[wsState()];

  // Allow reconnect for any non-connected state (including stuck 'connecting')
  const canReconnect = () => wsState() !== 'connected';

  // Merged status: use WebSocket state when running, otherwise session status
  const mergedTitle = () => {
    if (props.session.status === 'running') {
      return wsConfig().title;
    }
    return `Session ${props.session.status}`;
  };

  const isPulsing = () => {
    return config().spinning || (props.session.status === 'running' && wsState() === 'connecting');
  };

  const statusVariant = () => {
    if (props.session.status === 'running' && wsState() !== 'connected') {
      return wsState() === 'connecting' ? 'warning' : 'error';
    }
    return statusDotVariant[props.session.status];
  };

  // Get tab count for a session
  const getTabCount = (): number => {
    const terminals = sessionStore.getTerminalsForSession(props.session.id);
    return terminals?.tabs.length || 0;
  };

  // Get init progress for a session
  const getProgress = (): number => {
    const progress = sessionStore.getInitProgressForSession(props.session.id);
    return progress?.progress || 0;
  };

  return (
    <div
      class="session-card-wrapper stagger-item"
      style={{ '--stagger-index': props.index() }}
      data-testid={`session-card-${props.session.id}`}
    >
      <div
        class={`session-card session-card-gradient ${props.isActive ? 'session-card--active' : ''} ${props.isActive && props.session.status === 'running' ? 'session-card-glow' : ''}`}
        data-status={props.session.status}
        onClick={() => {
          if (canReconnect() && props.onReconnect) {
            props.onReconnect();
          }
          props.onSelect();
        }}
        title={mergedTitle()}
      >
        <div class="session-card-content">
          <div class="session-card-header">
            <span class="session-name">{props.session.name}</span>
            <span
              class={`session-status-badge ${isPulsing() ? 'animate-pulse' : ''} ${props.session.status === 'running' ? 'session-badge-shimmer' : ''}`}
              data-testid="session-status-badge"
              data-status={statusVariant()}
            >
              <Show when={props.session.status === 'running'}>
                <span class="session-status-dot" />
              </Show>
              {props.session.status === 'running' ? 'Live' : props.session.status === 'initializing' ? 'Starting' : 'Stopped'}
            </span>
          </div>

          <Show when={props.session.status === 'running'}>
            <div class="session-card-metrics" data-testid="session-metrics">
              {/* Row 1: CPU, MEM, HDD */}
              <div class="session-card-metrics-row">
                <div class="session-card-metric" data-testid={`session-card-${props.session.id}-metric-cpu`}>
                  <span class="metric-label">CPU</span>
                  <span class="metric-value">{sessionStore.getMetricsForSession(props.session.id)?.cpu || '...'}</span>
                </div>
                <div class="session-card-metric" data-testid={`session-card-${props.session.id}-metric-mem`}>
                  <span class="metric-label">MEM</span>
                  <span class="metric-value">{sessionStore.getMetricsForSession(props.session.id)?.mem || '...'}</span>
                </div>
                <div class="session-card-metric" data-testid={`session-card-${props.session.id}-metric-hdd`}>
                  <span class="metric-label">HDD</span>
                  <span class="metric-value">{sessionStore.getMetricsForSession(props.session.id)?.hdd || '...'}</span>
                </div>
              </div>
              {/* Row 2: R2 Bucket (full width) */}
              <div class="session-card-metrics-row">
                <div class="session-card-metric session-card-metric--full" data-testid={`session-card-${props.session.id}-metric-bucket`}>
                  <span class="metric-label">R2 Bucket</span>
                  <span class="metric-value">{sessionStore.getMetricsForSession(props.session.id)?.bucketName || '...'}</span>
                </div>
              </div>
              {/* Row 3: Sync status */}
              <div class="session-card-metrics-row">
                <div class="session-card-metric" data-testid={`session-card-${props.session.id}-metric-sync`}>
                  <span class="metric-label">Sync</span>
                  <span class="metric-value metric-value--status">
                    <span class={`status-dot status-dot--${sessionStore.getMetricsForSession(props.session.id)?.syncStatus || 'pending'}`} />
                    {sessionStore.getMetricsForSession(props.session.id)?.syncStatus || '...'}
                  </span>
                </div>
              </div>
              {/* Row 4: Terminals + Age */}
              <div class="session-card-metrics-row">
                <div class="session-card-metric" data-testid={`session-card-${props.session.id}-metric-terminals`}>
                  <span class="metric-label">Terminals</span>
                  <span class="metric-value">{getTabCount()}/{MAX_TERMINALS_PER_SESSION}</span>
                </div>
                <div class="session-card-metric" data-testid={`session-card-${props.session.id}-metric-uptime`}>
                  <span class="metric-label">Age</span>
                  <span class="metric-value">{formatUptime(props.session.createdAt)}</span>
                </div>
              </div>
            </div>
          </Show>

          <Show when={props.session.status === 'initializing'}>
            <div class="progress-bar progress-bar-thin progress-bar-animated session-init-progress">
              <div
                class="progress-bar-fill"
                style={{ width: `${getProgress()}%` }}
                data-testid={`session-card-${props.session.id}-progress`}
              />
            </div>
          </Show>
        </div>

      </div>
      <div class="session-card-actions-overlay" data-testid="session-actions-overlay">
        <Show when={canStop()}>
          <button
            class="session-action-btn session-action-btn--stop"
            title="Stop session"
            onClick={(e) => {
              e.stopPropagation();
              props.onStop();
            }}
          >
            <Icon path={mdiStop} size={16} />
          </button>
        </Show>
        <Show when={canDelete()}>
          <button
            class="session-action-btn session-action-btn--delete"
            title="Delete session"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete session "${props.session.name}"?`)) {
                props.onDelete();
              }
            }}
          >
            <Icon path={mdiTrashCanOutline} size={16} />
          </button>
        </Show>
      </div>
    </div>
  );
};

export default SessionCard;
