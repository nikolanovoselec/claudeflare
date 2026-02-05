import { Component, JSX, Show } from 'solid-js';
import Icon from '../Icon';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: JSX.Element;
}

const Button: Component<ButtonProps> = (props) => {
  const variant = () => props.variant || 'primary';
  const size = () => props.size || 'md';
  const iconPosition = () => props.iconPosition || 'left';
  const isLoading = () => props.loading || false;
  const isDisabled = () => props.disabled || isLoading();

  const iconSize = () => {
    switch (size()) {
      case 'sm':
        return 14;
      case 'lg':
        return 20;
      default:
        return 16;
    }
  };

  return (
    <button
      data-testid="button"
      data-variant={variant()}
      data-size={size()}
      data-loading={isLoading().toString()}
      data-icon-position={props.icon ? iconPosition() : undefined}
      class="button"
      disabled={isDisabled()}
      onClick={props.onClick}
    >
      <Show when={isLoading()}>
        <span class="button-spinner" />
      </Show>
      <Show when={!isLoading() && props.icon && iconPosition() === 'left'}>
        <Icon path={props.icon!} size={iconSize()} class="button-icon" />
      </Show>
      <span class="button-content">{props.children}</span>
      <Show when={!isLoading() && props.icon && iconPosition() === 'right'}>
        <Icon path={props.icon!} size={iconSize()} class="button-icon" />
      </Show>

      <style>{`
        .button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-family: var(--font-sans);
          font-weight: 500;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          transition: all var(--transition-fast);
          white-space: nowrap;
          user-select: none;
        }

        /* Sizes */
        .button[data-size="sm"] {
          padding: 6px 12px;
          font-size: 12px;
          gap: 6px;
        }

        .button[data-size="md"] {
          padding: 8px 16px;
          font-size: 14px;
          gap: 8px;
        }

        .button[data-size="lg"] {
          padding: 12px 24px;
          font-size: 16px;
          gap: 10px;
        }

        /* Primary variant */
        .button[data-variant="primary"] {
          background: var(--color-accent);
          color: white;
        }

        .button[data-variant="primary"]:hover:not(:disabled) {
          background: var(--color-accent-hover);
        }

        .button[data-variant="primary"]:active:not(:disabled) {
          transform: scale(0.98);
        }

        /* Secondary variant */
        .button[data-variant="secondary"] {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }

        .button[data-variant="secondary"]:hover:not(:disabled) {
          background: var(--color-bg-hover);
          border-color: var(--color-text-muted);
        }

        .button[data-variant="secondary"]:active:not(:disabled) {
          transform: scale(0.98);
        }

        /* Ghost variant */
        .button[data-variant="ghost"] {
          background: transparent;
          color: var(--color-text-secondary);
        }

        .button[data-variant="ghost"]:hover:not(:disabled) {
          background: var(--color-bg-hover);
          color: var(--color-text-primary);
        }

        .button[data-variant="ghost"]:active:not(:disabled) {
          transform: scale(0.98);
        }

        /* Danger variant */
        .button[data-variant="danger"] {
          background: var(--color-error);
          color: white;
        }

        .button[data-variant="danger"]:hover:not(:disabled) {
          background: #dc2626;
        }

        .button[data-variant="danger"]:active:not(:disabled) {
          transform: scale(0.98);
        }

        /* Disabled state */
        .button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Focus state */
        .button:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }

        /* Loading spinner */
        .button-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        .button[data-size="sm"] .button-spinner {
          width: 12px;
          height: 12px;
        }

        .button[data-size="lg"] .button-spinner {
          width: 20px;
          height: 20px;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* Icon styles */
        .button-icon {
          flex-shrink: 0;
        }

        /* Content */
        .button-content {
          display: inline-flex;
          align-items: center;
        }
      `}</style>
    </button>
  );
};

export default Button;
