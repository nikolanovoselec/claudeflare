import { Component, For, Show, createSignal, createMemo, onCleanup } from 'solid-js';
import {
  mdiPlus,
  mdiLoading,
  mdiMagnify,
} from '@mdi/js';
import Icon from './Icon';
import { Input } from './ui';
import EmptyState from './EmptyState';
import SessionCard from './SessionCard';
import type { SessionWithStatus } from '../types';
import { DURATION_REFRESH_INTERVAL_MS } from '../lib/constants';
import '../styles/session-list.css';

interface SessionListProps {
  sessions: SessionWithStatus[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onStartSession: (id: string) => void;
  onStopSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onCreateSession: (name: string) => void;
  onReconnect?: (id: string) => void;
}

const SessionList: Component<SessionListProps> = (props) => {
  const [newSessionName, setNewSessionName] = createSignal('');
  const [isCreating, setIsCreating] = createSignal(false);
  const [showCreateInput, setShowCreateInput] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');

  // Update duration displays periodically
  const [, setTick] = createSignal(0);
  const interval = setInterval(() => setTick(t => t + 1), DURATION_REFRESH_INTERVAL_MS);
  onCleanup(() => clearInterval(interval));

  // Filtered sessions memo
  const filteredSessions = createMemo(() => {
    let sessions = props.sessions;

    // Filter by search query
    if (searchQuery()) {
      const query = searchQuery().toLowerCase();
      sessions = sessions.filter(s => s.name.toLowerCase().includes(query));
    }

    return sessions;
  });

  const handleCreateSession = async () => {
    const name = newSessionName().trim();
    if (!name) return;

    setIsCreating(true);
    try {
      props.onCreateSession(name);
      setNewSessionName('');
      setShowCreateInput(false);
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateSession();
    } else if (e.key === 'Escape') {
      setShowCreateInput(false);
      setNewSessionName('');
    }
  };

  return (
    <div class="session-list">
      <div class="session-list-header">
        <h3>Sessions</h3>
      </div>

      {/* Search Input */}
      <div class="session-list-search" data-testid="session-list-search">
        <Input
          type="search"
          placeholder="Search sessions..."
          icon={mdiMagnify}
          value={searchQuery()}
          onInput={setSearchQuery}
        />
      </div>

      <div class="session-list-items">
        {/* Empty state: Search returned no results */}
        <Show when={filteredSessions().length === 0 && searchQuery() && props.sessions.length > 0}>
          <div class="session-list-empty-state" data-testid="session-list-empty">
            <EmptyState
              testId="empty-state-no-results"
              icon={mdiMagnify}
              title="No Results"
              description={`No sessions match "${searchQuery()}"`}
            />
          </div>
        </Show>
        <For each={filteredSessions()}>
          {(session, index) => (
            <SessionCard
              session={session}
              index={index}
              isActive={session.id === props.activeSessionId}
              onSelect={() => props.onSelectSession(session.id)}
              onStop={() => props.onStopSession(session.id)}
              onDelete={() => props.onDeleteSession(session.id)}
              onReconnect={props.onReconnect ? () => props.onReconnect!(session.id) : undefined}
            />
          )}
        </For>
      </div>

      <div class="session-list-footer">
        <Show when={showCreateInput()}>
          <div class="session-create-input">
            <input
              type="text"
              placeholder="Session name..."
              value={newSessionName()}
              onInput={(e) => setNewSessionName(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              autofocus
            />
            <button
              class="session-create-confirm"
              onClick={handleCreateSession}
              disabled={!newSessionName().trim() || isCreating()}
            >
              <Show when={isCreating()} fallback={<Icon path={mdiPlus} size={16} />}>
                <Icon path={mdiLoading} size={16} class="animate-spin" />
              </Show>
            </button>
          </div>
        </Show>
        <Show when={!showCreateInput()}>
          <button
            class="session-create-btn"
            onClick={() => setShowCreateInput(true)}
          >
            <Icon path={mdiPlus} size={16} />
            <span>New Session</span>
          </button>
        </Show>
      </div>
    </div>
  );
};

export default SessionList;
