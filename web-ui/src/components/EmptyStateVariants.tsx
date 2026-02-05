import { Component } from 'solid-js';
import { mdiCloudOutline, mdiPowerSleep, mdiPlay } from '@mdi/js';
import EmptyState from './EmptyState';

/**
 * No Sessions Empty State
 * Shown when user has no sessions at all
 */
export const NoSessionsEmptyState: Component = () => (
  <EmptyState
    testId="empty-state-no-sessions"
    icon={mdiCloudOutline}
    title="Welcome to Claudeflare"
    description="Click '+ New Session' in the sidebar to get started."
  />
);

/**
 * All Sessions Stopped Empty State
 * Shown when all sessions exist but are stopped
 */
interface AllStoppedProps {
  onStartLast: () => void;
}

export const AllStoppedEmptyState: Component<AllStoppedProps> = (props) => (
  <EmptyState
    testId="empty-state-all-stopped"
    icon={mdiPowerSleep}
    title="All Sessions Stopped"
    description="Start a session to continue working, or create a new one."
    action={{
      label: 'Start Last Session',
      onClick: props.onStartLast,
      icon: mdiPlay,
    }}
  />
);
