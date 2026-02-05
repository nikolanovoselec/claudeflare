import { Component } from 'solid-js';
import Icon from '../Icon';

export interface IconButtonProps {
  icon: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'ghost';
  tooltip?: string;
  'aria-label'?: string;
  disabled?: boolean;
  onClick?: () => void;
}

const IconButton: Component<IconButtonProps> = (props) => {
  const variant = () => props.variant || 'default';
  const size = () => props.size || 'md';

  const iconSize = () => {
    switch (size()) {
      case 'sm':
        return 16;
      case 'lg':
        return 24;
      default:
        return 20;
    }
  };

  return (
    <button
      data-testid="icon-button"
      data-variant={variant()}
      data-size={size()}
      class="icon-button"
      title={props.tooltip}
      aria-label={props['aria-label'] || props.tooltip}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon path={props.icon} size={iconSize()} />

      <style>{`
        .icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all var(--transition-fast);
          color: var(--color-text-secondary);
        }

        /* Sizes */
        .icon-button[data-size="sm"] {
          width: 28px;
          height: 28px;
        }

        .icon-button[data-size="md"] {
          width: 36px;
          height: 36px;
        }

        .icon-button[data-size="lg"] {
          width: 44px;
          height: 44px;
        }

        /* Default variant */
        .icon-button[data-variant="default"] {
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
        }

        .icon-button[data-variant="default"]:hover:not(:disabled) {
          background: var(--color-bg-hover);
          color: var(--color-text-primary);
          border-color: var(--color-text-muted);
        }

        .icon-button[data-variant="default"]:active:not(:disabled) {
          transform: scale(0.95);
        }

        /* Ghost variant */
        .icon-button[data-variant="ghost"] {
          background: transparent;
        }

        .icon-button[data-variant="ghost"]:hover:not(:disabled) {
          background: var(--color-bg-hover);
          color: var(--color-text-primary);
        }

        .icon-button[data-variant="ghost"]:active:not(:disabled) {
          transform: scale(0.95);
        }

        /* Disabled state */
        .icon-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Focus state */
        .icon-button:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }
      `}</style>
    </button>
  );
};

export default IconButton;
