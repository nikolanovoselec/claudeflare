import { Component, JSX, Show } from 'solid-js';

export interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
  dot?: boolean;
  children: JSX.Element;
}

const Badge: Component<BadgeProps> = (props) => {
  const variant = () => props.variant || 'default';
  const size = () => props.size || 'md';
  const hasDot = () => props.dot || false;

  return (
    <span
      data-testid="badge"
      data-variant={variant()}
      data-size={size()}
      data-dot={hasDot().toString()}
      class="badge"
    >
      <Show when={hasDot()}>
        <span class="badge-dot" />
      </Show>
      {props.children}

      <style>{`
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-sans);
          font-weight: 500;
          border-radius: 9999px;
          white-space: nowrap;
        }

        /* Sizes */
        .badge[data-size="sm"] {
          padding: 2px 8px;
          font-size: 10px;
        }

        .badge[data-size="md"] {
          padding: 4px 10px;
          font-size: 12px;
        }

        /* Default variant */
        .badge[data-variant="default"] {
          background: var(--color-bg-tertiary);
          color: var(--color-text-secondary);
          border: 1px solid var(--color-border);
        }

        /* Success variant */
        .badge[data-variant="success"] {
          background: rgba(34, 197, 94, 0.15);
          color: var(--color-success);
          border: 1px solid rgba(34, 197, 94, 0.3);
        }

        /* Warning variant */
        .badge[data-variant="warning"] {
          background: rgba(234, 179, 8, 0.15);
          color: var(--color-warning);
          border: 1px solid rgba(234, 179, 8, 0.3);
        }

        /* Error variant */
        .badge[data-variant="error"] {
          background: rgba(239, 68, 68, 0.15);
          color: var(--color-error);
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        /* Info variant */
        .badge[data-variant="info"] {
          background: rgba(124, 58, 237, 0.15);
          color: var(--color-accent);
          border: 1px solid rgba(124, 58, 237, 0.3);
        }

        /* Dot indicator */
        .badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }

        .badge[data-size="sm"] .badge-dot {
          width: 5px;
          height: 5px;
        }
      `}</style>
    </span>
  );
};

export default Badge;
