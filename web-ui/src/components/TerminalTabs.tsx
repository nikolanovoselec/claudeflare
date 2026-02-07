import { Component, For, Show, createMemo } from 'solid-js';
import { mdiPlus, mdiClose, mdiDragVertical } from '@mdi/js';
import { DragDropProvider, DragDropSensors, SortableProvider, createSortable, closestCenter, DragEvent } from '@thisbeyond/solid-dnd';
import Icon from './Icon';
import { sessionStore } from '../stores/session';
import { TERMINAL_TAB_CONFIG } from '../lib/terminal-config';
import { MAX_TERMINALS_PER_SESSION } from '../lib/constants';
import '../styles/terminal-tabs.css';

interface TerminalTabsProps {
  sessionId: string;
}

// Get tab type from config name (claude, htop, yazi, terminal)
const getTabType = (id: string): string => {
  return TERMINAL_TAB_CONFIG[id]?.name || 'terminal';
};

// Sortable tab component for tabs 2-6
const SortableTab: Component<{
  id: string;
  isActive: boolean;
  canClose: boolean;
  onSelect: () => void;
  onClose: (e: MouseEvent) => void;
}> = (props) => {
  const sortable = createSortable(props.id);

  return (
    <div
      ref={sortable.ref}
      class={`terminal-tab ${props.isActive ? 'terminal-tab--active' : ''} ${sortable.isActiveDraggable ? 'terminal-tab--dragging' : ''}`}
      data-testid={`terminal-tab-${props.id}`}
      data-type={getTabType(props.id)}
      data-active={props.isActive ? 'true' : 'false'}
      onClick={() => props.onSelect()}
      classList={{ 'sortable-ghost': sortable.isActiveDraggable }}
    >
      <div
        class="terminal-tab-drag-handle"
        data-testid={`terminal-tab-${props.id}-drag-handle`}
        {...sortable.dragActivators}
      >
        <Icon path={mdiDragVertical} size={14} />
      </div>
      <Icon
        path={TERMINAL_TAB_CONFIG[props.id]?.icon}
        size={14}
        class="terminal-tab-icon"
        data-testid={`terminal-tab-${props.id}-icon`}
      />
      <span class="terminal-tab-label">{TERMINAL_TAB_CONFIG[props.id]?.name || `Terminal ${props.id}`}</span>
      <Show when={props.canClose}>
        <button
          class="terminal-tab-close"
          data-testid={`terminal-tab-${props.id}-close`}
          onClick={(e) => props.onClose(e)}
          title="Close terminal"
        >
          <Icon path={mdiClose} size={14} />
        </button>
      </Show>
    </div>
  );
};

// Static tab component for tab 1 (not draggable)
const StaticTab: Component<{
  id: string;
  isActive: boolean;
  canClose: boolean;
  onSelect: () => void;
  onClose: (e: MouseEvent) => void;
}> = (props) => {
  return (
    <div
      class={`terminal-tab ${props.isActive ? 'terminal-tab--active' : ''}`}
      data-testid={`terminal-tab-${props.id}`}
      data-type={getTabType(props.id)}
      data-active={props.isActive ? 'true' : 'false'}
      onClick={() => props.onSelect()}
    >
      <Icon
        path={TERMINAL_TAB_CONFIG[props.id]?.icon}
        size={14}
        class="terminal-tab-icon"
        data-testid={`terminal-tab-${props.id}-icon`}
      />
      <span class="terminal-tab-label">{TERMINAL_TAB_CONFIG[props.id]?.name || `Terminal ${props.id}`}</span>
      <Show when={props.canClose}>
        <button
          class="terminal-tab-close"
          data-testid={`terminal-tab-${props.id}-close`}
          onClick={(e) => props.onClose(e)}
          title="Close terminal"
        >
          <Icon path={mdiClose} size={14} />
        </button>
      </Show>
    </div>
  );
};

const TerminalTabs: Component<TerminalTabsProps> = (props) => {
  const terminals = createMemo(() => sessionStore.getTerminalsForSession(props.sessionId));

  const canAddTab = createMemo(() => (terminals()?.tabs.length || 0) < MAX_TERMINALS_PER_SESSION);

  const canCloseTab = createMemo(() => (terminals()?.tabs.length || 0) > 1);

  // Get ordered tabs based on tabOrder
  const orderedTabs = createMemo(() => {
    const terminalData = terminals();
    if (!terminalData) return [];

    const tabOrder = terminalData.tabOrder || terminalData.tabs.map(t => t.id);
    const tabMap = new Map(terminalData.tabs.map(t => [t.id, t]));

    return tabOrder.map(id => tabMap.get(id)).filter((t): t is NonNullable<typeof t> => t !== undefined);
  });

  // Get sortable IDs (excluding tab 1 which is always first and not draggable)
  const sortableIds = createMemo(() => {
    const ordered = orderedTabs();
    return ordered.filter(t => t.id !== '1').map(t => t.id);
  });

  const handleAddTab = () => {
    sessionStore.addTerminalTab(props.sessionId);
  };

  const handleSelectTab = (terminalId: string) => {
    sessionStore.setActiveTerminalTab(props.sessionId, terminalId);
  };

  const handleCloseTab = (e: MouseEvent, terminalId: string) => {
    e.stopPropagation();
    if (canCloseTab()) {
      sessionStore.removeTerminalTab(props.sessionId, terminalId);
    }
  };

  const onDragEnd = (event: DragEvent) => {
    const { draggable, droppable } = event;
    if (draggable && droppable && draggable.id !== droppable.id) {
      const currentOrder = terminals()?.tabOrder || orderedTabs().map(t => t.id);
      const fromIndex = currentOrder.indexOf(String(draggable.id));
      const toIndex = currentOrder.indexOf(String(droppable.id));

      if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
        const newOrder = [...currentOrder];
        newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, String(draggable.id));

        // Ensure tab 1 stays first
        if (newOrder[0] === '1') {
          sessionStore.reorderTerminalTabs(props.sessionId, newOrder);
        }
      }
    }
  };

  return (
    <div class="terminal-tabs" data-testid="terminal-tabs">
      <DragDropProvider onDragEnd={onDragEnd} collisionDetector={closestCenter}>
        <DragDropSensors />
        {/* Tab 1 is always first and not draggable */}
        <Show when={orderedTabs().find(t => t.id === '1')}>
          {(tab) => (
            <StaticTab
              id={tab().id}
              isActive={tab().id === terminals()?.activeTabId}
              canClose={canCloseTab()}
              onSelect={() => handleSelectTab(tab().id)}
              onClose={(e) => handleCloseTab(e, tab().id)}
            />
          )}
        </Show>

        {/* Sortable tabs (2-6) */}
        <SortableProvider ids={sortableIds()}>
          <For each={orderedTabs().filter(t => t.id !== '1')}>
            {(tab) => (
              <SortableTab
                id={tab.id}
                isActive={tab.id === terminals()?.activeTabId}
                canClose={canCloseTab()}
                onSelect={() => handleSelectTab(tab.id)}
                onClose={(e) => handleCloseTab(e, tab.id)}
              />
            )}
          </For>
        </SortableProvider>
      </DragDropProvider>

      <Show when={canAddTab()}>
        <button
          class="terminal-tab-add"
          data-testid="terminal-tab-add"
          onClick={handleAddTab}
          title="New terminal (max 6)"
        >
          <Icon path={mdiPlus} size={16} />
        </button>
      </Show>

    </div>
  );
};

export default TerminalTabs;
