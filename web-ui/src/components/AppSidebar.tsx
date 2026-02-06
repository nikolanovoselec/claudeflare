import { Component, Show } from 'solid-js';
import { mdiMenu, mdiChevronLeft } from '@mdi/js';
import Icon from './Icon';
import SessionList from './SessionList';
import type { SessionWithStatus } from '../types';

export interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  sessions: SessionWithStatus[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onStartSession: (id: string) => void;
  onStopSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onCreateSession: (name: string) => void;
  onReconnect?: (id: string) => void;
}

const AppSidebar: Component<AppSidebarProps> = (props) => {
  return (
    <aside class={`layout-sidebar ${props.collapsed ? 'layout-sidebar--collapsed' : ''}`}>
      <div class="layout-sidebar-header">
        <button
          class="layout-sidebar-toggle"
          onClick={props.onToggle}
          title={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon path={props.collapsed ? mdiMenu : mdiChevronLeft} size={20} />
        </button>
      </div>

      <Show when={!props.collapsed}>
        <div class="layout-sidebar-content">
          <SessionList
            sessions={props.sessions}
            activeSessionId={props.activeSessionId}
            onSelectSession={props.onSelectSession}
            onStartSession={props.onStartSession}
            onStopSession={props.onStopSession}
            onDeleteSession={props.onDeleteSession}
            onCreateSession={props.onCreateSession}
            onReconnect={props.onReconnect}
          />
        </div>
      </Show>
    </aside>
  );
};

export default AppSidebar;
