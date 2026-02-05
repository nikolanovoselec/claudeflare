import { Component, For, Show } from 'solid-js';

export interface SkeletonProps {
  variant?: 'text' | 'circle' | 'rect';
  width?: string;
  height?: string;
  lines?: number;
}

const Skeleton: Component<SkeletonProps> = (props) => {
  const variant = () => props.variant || 'text';
  const lines = () => props.lines || 1;

  const getStyle = () => {
    const style: Record<string, string> = {};

    if (props.width) {
      style.width = props.width;
    }

    if (props.height) {
      style.height = props.height;
    }

    return style;
  };

  return (
    <div data-testid="skeleton" class="skeleton-container">
      <Show
        when={variant() === 'text' && lines() > 1}
        fallback={
          <div
            data-variant={variant()}
            class="skeleton"
            style={getStyle()}
          />
        }
      >
        <For each={Array(lines()).fill(0)}>
          {(_, index) => (
            <div
              data-variant="text"
              class="skeleton"
              style={{
                ...getStyle(),
                width: index() === lines() - 1 ? '75%' : props.width || '100%',
              }}
            />
          )}
        </For>
      </Show>

      <style>{`
        .skeleton-container {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .skeleton {
          background: linear-gradient(
            90deg,
            var(--color-bg-tertiary) 0%,
            var(--color-bg-hover) 50%,
            var(--color-bg-tertiary) 100%
          );
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }

        /* Text variant */
        .skeleton[data-variant="text"] {
          height: 16px;
          width: 100%;
          border-radius: 4px;
        }

        /* Circle variant */
        .skeleton[data-variant="circle"] {
          width: 40px;
          height: 40px;
          border-radius: 50%;
        }

        /* Rectangle variant */
        .skeleton[data-variant="rect"] {
          width: 100%;
          height: 100px;
          border-radius: 8px;
        }

        @keyframes shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
};

export default Skeleton;
