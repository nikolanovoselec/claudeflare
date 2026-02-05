import { Component, JSX } from 'solid-js';

export interface CardProps {
  variant?: 'default' | 'interactive' | 'selected';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: JSX.Element;
}

const Card: Component<CardProps> = (props) => {
  const variant = () => props.variant || 'default';
  const padding = () => props.padding || 'md';

  return (
    <div
      data-testid="card"
      data-variant={variant()}
      data-padding={padding()}
      class="card"
    >
      {props.children}

      <style>{`
        .card {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          transition: all var(--transition-fast);
        }

        /* Padding */
        .card[data-padding="none"] {
          padding: 0;
        }

        .card[data-padding="sm"] {
          padding: 8px;
        }

        .card[data-padding="md"] {
          padding: 16px;
        }

        .card[data-padding="lg"] {
          padding: 24px;
        }

        /* Default variant */
        .card[data-variant="default"] {
          background: var(--color-bg-secondary);
        }

        /* Interactive variant */
        .card[data-variant="interactive"] {
          cursor: pointer;
        }

        .card[data-variant="interactive"]:hover {
          background: var(--color-bg-tertiary);
          border-color: var(--color-text-muted);
        }

        .card[data-variant="interactive"]:active {
          transform: scale(0.99);
        }

        /* Selected variant */
        .card[data-variant="selected"] {
          background: var(--color-bg-tertiary);
          border-color: var(--color-accent);
          box-shadow: 0 0 0 1px var(--color-accent);
        }

        /* Focus state for keyboard navigation */
        .card[data-variant="interactive"]:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
};

export default Card;
