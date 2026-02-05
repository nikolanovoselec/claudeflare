import { Component, Show } from 'solid-js';
import { mdiViewGridOutline } from '@mdi/js';
import Icon from './Icon';

export interface TilingButtonProps {
  sessionId: string;
  tabCount: number;
  isActive: boolean;
  onClick: () => void;
}

const TilingButton: Component<TilingButtonProps> = (props) => {
  const isVisible = () => props.tabCount >= 2;

  return (
    <Show when={isVisible()}>
      <button
        data-testid="tiling-button"
        data-active={props.isActive}
        class="tiling-button"
        aria-label="Toggle terminal tiling layout"
        title="Toggle terminal tiling layout"
        onClick={props.onClick}
      >
        <Icon path={mdiViewGridOutline} size={16} />

        <style>{`
          .tiling-button {
            position: absolute;
            top: var(--space-2);
            right: var(--space-2);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border: none;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all var(--transition-fast);
            color: var(--color-text-secondary);
            background: rgba(24, 24, 27, 0.8);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: 1px solid var(--color-border-subtle);
            z-index: 10;
          }

          .tiling-button:hover {
            background: rgba(39, 39, 42, 0.9);
            color: var(--color-text-primary);
            border-color: var(--color-border-default);
          }

          .tiling-button:active {
            transform: scale(0.95);
          }

          .tiling-button:focus-visible {
            outline: 2px solid var(--color-accent);
            outline-offset: 2px;
          }

          /* Active state with accent glow */
          .tiling-button[data-active="true"] {
            color: var(--color-accent);
            border-color: var(--color-accent);
            box-shadow: var(--glow-accent);
          }

          .tiling-button[data-active="true"]:hover {
            color: var(--color-accent-hover);
            border-color: var(--color-accent-hover);
          }
        `}</style>
      </button>
    </Show>
  );
};

export default TilingButton;
