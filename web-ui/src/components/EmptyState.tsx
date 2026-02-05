import { Component, Show } from 'solid-js';
import { mdiKeyboard } from '@mdi/js';
import Icon from './Icon';
import { Button } from './ui';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: string;
  };
  hint?: string;
  testId?: string;
}

/**
 * EmptyState Component
 *
 * Displays a beautiful empty state with:
 * - Large animated icon
 * - Title and description
 * - Optional action button
 * - Optional keyboard shortcut hint
 *
 * Layout:
 * +--------------------------------------------------+
 * |                                                  |
 * |           [Large Icon - animated float]          |
 * |                                                  |
 * |              Title Text Here                     |
 * |                                                  |
 * |    A longer description explaining what to do    |
 * |    and why this state exists.                    |
 * |                                                  |
 * |              [+ Action Button]                   |
 * |                                                  |
 * |        [Keyboard] Cmd+N to create                |
 * |                                                  |
 * +--------------------------------------------------+
 */
const EmptyState: Component<EmptyStateProps> = (props) => {
  return (
    <div
      class="empty-state animate-fadeIn"
      data-testid={props.testId || 'empty-state'}
    >
      <Show when={props.icon}>
        <div class="empty-state-icon animate-float" data-testid="empty-state-icon">
          <Icon path={props.icon!} size={48} />
        </div>
      </Show>

      <h2 class="empty-state-title" data-testid="empty-state-title">
        {props.title}
      </h2>

      <p class="empty-state-description" data-testid="empty-state-description">
        {props.description}
      </p>

      <Show when={props.action}>
        <div class="empty-state-action" data-testid="empty-state-action">
          <Button
            icon={props.action!.icon}
            onClick={props.action!.onClick}
          >
            {props.action!.label}
          </Button>
        </div>
      </Show>

      <Show when={props.hint}>
        <div class="empty-state-hint" data-testid="empty-state-hint">
          <Icon path={mdiKeyboard} size={14} />
          <span>{props.hint}</span>
        </div>
      </Show>

      <style>{`
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: var(--space-8);
          text-align: center;
          max-width: 400px;
          margin: 0 auto;
        }

        .empty-state-icon {
          color: var(--color-text-muted);
          margin-bottom: var(--space-6);
        }

        .empty-state-title {
          margin: 0 0 var(--space-3);
          font-size: var(--text-xl);
          font-weight: var(--font-semibold);
          color: var(--color-text-primary);
          line-height: var(--leading-tight);
        }

        .empty-state-description {
          margin: 0;
          font-size: var(--text-base);
          color: var(--color-text-secondary);
          line-height: var(--leading-normal);
          max-width: 320px;
        }

        .empty-state-action {
          margin-top: var(--space-6);
        }

        .empty-state-hint {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          margin-top: var(--space-4);
          font-size: var(--text-xs);
          color: var(--color-text-muted);
        }
      `}</style>
    </div>
  );
};

export default EmptyState;
