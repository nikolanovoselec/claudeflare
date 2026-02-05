import { Component, For, Show, createMemo } from 'solid-js';
import { mdiPlus, mdiClose, mdiDragVertical } from '@mdi/js';
import { DragDropProvider, DragDropSensors, SortableProvider, createSortable, closestCenter, DragEvent } from '@thisbeyond/solid-dnd';
import Icon from './Icon';
import { sessionStore } from '../stores/session';
import { TERMINAL_TAB_CONFIG } from '../lib/terminal-config';
import { MAX_TERMINALS_PER_SESSION } from '../lib/constants';

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

      <style>{`
        .terminal-tabs {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 4px 8px;
          background: var(--color-bg-surface);
          border-bottom: 1px solid var(--color-border-default);
          height: 36px;
          overflow-x: auto;
          flex-shrink: 0;
        }

        .terminal-tab {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 4px 12px;
          min-width: 80px;
          font-size: 12px;
          color: var(--color-text-secondary);
          background: rgba(39, 39, 42, 0.6);
          backdrop-filter: blur(8px);
          border: 1px solid var(--color-glass-border, rgba(255, 255, 255, 0.08));
          border-radius: var(--radius-sm) var(--radius-sm) 0 0;
          cursor: pointer;
          transition: all var(--transition-base);
          white-space: nowrap;
        }

        .terminal-tab:hover:not(.terminal-tab--active) {
          color: var(--color-text-primary);
          background: rgba(63, 63, 70, 0.8);
          transform: translateY(-1px);
        }

        .terminal-tab--active {
          color: var(--color-text-primary);
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(139, 92, 246, 0.05));
          border-color: rgba(139, 92, 246, 0.3);
          box-shadow:
            0 0 20px rgba(139, 92, 246, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }

        .terminal-tab--active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 20%;
          right: 20%;
          height: 2px;
          background: linear-gradient(90deg, transparent, var(--color-accent), transparent);
          border-radius: 1px;
        }

        .terminal-tab-icon {
          flex-shrink: 0;
          opacity: 0.7;
          transition: opacity var(--transition-fast), color var(--transition-fast);
        }

        /* Tab-type specific icon colors */
        .terminal-tab[data-type="claude"] .terminal-tab-icon {
          color: var(--color-tab-claude, #8b5cf6);
        }

        .terminal-tab[data-type="htop"] .terminal-tab-icon {
          color: var(--color-tab-htop, #22c55e);
        }

        .terminal-tab[data-type="yazi"] .terminal-tab-icon {
          color: var(--color-tab-yazi, #3b82f6);
        }

        .terminal-tab[data-type="terminal"] .terminal-tab-icon {
          color: var(--color-tab-terminal, #f59e0b);
        }

        .terminal-tab--active .terminal-tab-icon {
          opacity: 1;
        }

        .terminal-tab-label {
          user-select: none;
        }

        .terminal-tab-close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          padding: 0;
          border: none;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--color-text-muted);
          opacity: 0;
          transform: scale(0.8);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .terminal-tab:hover .terminal-tab-close {
          opacity: 1;
          transform: scale(1);
        }

        .terminal-tab-close:hover {
          color: var(--color-error);
          background: var(--color-error-muted);
        }

        .terminal-tab-drag-handle {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          color: var(--color-text-muted);
          opacity: 0;
          cursor: grab;
          transition: opacity var(--transition-fast);
        }

        .terminal-tab:hover .terminal-tab-drag-handle {
          opacity: 1;
        }

        .terminal-tab-drag-handle:active {
          cursor: grabbing;
        }

        .terminal-tab--dragging {
          opacity: 0.8;
          background: var(--color-bg-elevated);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          z-index: 100;
        }

        .sortable-ghost {
          opacity: 0.5;
        }

        .terminal-tab-add {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .terminal-tab-add:hover {
          color: var(--color-accent);
          background: var(--color-bg-elevated);
          transform: scale(1.05);
        }

        .terminal-tab-add:active {
          transform: scale(0.95);
        }
      `}</style>
    </div>
  );
};

export default TerminalTabs;
