import { Component, JSX, createSignal, Show } from 'solid-js';

export interface TooltipProps {
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  children: JSX.Element;
}

const Tooltip: Component<TooltipProps> = (props) => {
  const [isVisible, setIsVisible] = createSignal(false);
  const position = () => props.position || 'top';
  const delay = () => props.delay ?? 200;

  let timeoutId: number | undefined;

  const showTooltip = () => {
    timeoutId = window.setTimeout(() => {
      setIsVisible(true);
    }, delay());
  };

  const hideTooltip = () => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    setIsVisible(false);
  };

  return (
    <div
      data-testid="tooltip-wrapper"
      data-position={position()}
      class="tooltip-wrapper"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocusIn={showTooltip}
      onFocusOut={hideTooltip}
    >
      {props.children}
      <Show when={isVisible()}>
        <div
          data-testid="tooltip"
          class="tooltip"
          role="tooltip"
        >
          {props.content}
        </div>
      </Show>

      <style>{`
        .tooltip-wrapper {
          position: relative;
          display: inline-flex;
        }

        .tooltip {
          position: absolute;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text-primary);
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          white-space: nowrap;
          z-index: 1000;
          pointer-events: none;
          animation: tooltip-fade-in 0.15s ease-out;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        /* Position: Top */
        .tooltip-wrapper[data-position="top"] .tooltip {
          bottom: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
        }

        /* Position: Bottom */
        .tooltip-wrapper[data-position="bottom"] .tooltip {
          top: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
        }

        /* Position: Left */
        .tooltip-wrapper[data-position="left"] .tooltip {
          right: calc(100% + 8px);
          top: 50%;
          transform: translateY(-50%);
        }

        /* Position: Right */
        .tooltip-wrapper[data-position="right"] .tooltip {
          left: calc(100% + 8px);
          top: 50%;
          transform: translateY(-50%);
        }

        /* Arrow for top position */
        .tooltip-wrapper[data-position="top"] .tooltip::after {
          content: '';
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-top-color: var(--color-bg-tertiary);
        }

        /* Arrow for bottom position */
        .tooltip-wrapper[data-position="bottom"] .tooltip::after {
          content: '';
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-bottom-color: var(--color-bg-tertiary);
        }

        /* Arrow for left position */
        .tooltip-wrapper[data-position="left"] .tooltip::after {
          content: '';
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          border: 6px solid transparent;
          border-left-color: var(--color-bg-tertiary);
        }

        /* Arrow for right position */
        .tooltip-wrapper[data-position="right"] .tooltip::after {
          content: '';
          position: absolute;
          right: 100%;
          top: 50%;
          transform: translateY(-50%);
          border: 6px solid transparent;
          border-right-color: var(--color-bg-tertiary);
        }

        @keyframes tooltip-fade-in {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        .tooltip-wrapper[data-position="bottom"] .tooltip {
          animation-name: tooltip-fade-in-bottom;
        }

        @keyframes tooltip-fade-in-bottom {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        .tooltip-wrapper[data-position="left"] .tooltip {
          animation-name: tooltip-fade-in-left;
        }

        @keyframes tooltip-fade-in-left {
          from {
            opacity: 0;
            transform: translateY(-50%) translateX(4px);
          }
          to {
            opacity: 1;
            transform: translateY(-50%) translateX(0);
          }
        }

        .tooltip-wrapper[data-position="right"] .tooltip {
          animation-name: tooltip-fade-in-right;
        }

        @keyframes tooltip-fade-in-right {
          from {
            opacity: 0;
            transform: translateY(-50%) translateX(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(-50%) translateX(0);
          }
        }
      `}</style>
    </div>
  );
};

export default Tooltip;
