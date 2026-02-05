import { Component, For, Show } from 'solid-js';
import type { TileLayout } from '../types';

export interface TilingOverlayProps {
  tabCount: number;
  currentLayout: TileLayout;
  onSelectLayout: (layout: TileLayout) => void;
  onClose: () => void;
}

interface LayoutOption {
  layout: TileLayout;
  label: string;
  ariaLabel: string;
  minTabs: number;
}

const layoutOptions: LayoutOption[] = [
  { layout: 'tabbed', label: 'Tabbed', ariaLabel: 'Tabbed layout', minTabs: 1 },
  { layout: '2-split', label: '2 Split', ariaLabel: '2 Split layout', minTabs: 2 },
  { layout: '3-split', label: '3 Split', ariaLabel: '3 Split layout', minTabs: 3 },
  { layout: '4-grid', label: '4 Grid', ariaLabel: '4 Grid layout', minTabs: 4 },
];

/**
 * SVG Preview Icons for each layout type
 */
const TabbedIcon: Component = () => (
  <svg viewBox="0 0 40 30" class="tiling-preview-icon">
    <rect x="2" y="2" width="36" height="26" rx="2" class="tiling-preview-rect" />
  </svg>
);

const TwoSplitIcon: Component = () => (
  <svg viewBox="0 0 40 30" class="tiling-preview-icon">
    <rect x="2" y="2" width="17" height="26" rx="2" class="tiling-preview-rect" />
    <rect x="21" y="2" width="17" height="26" rx="2" class="tiling-preview-rect" />
  </svg>
);

const ThreeSplitIcon: Component = () => (
  <svg viewBox="0 0 40 30" class="tiling-preview-icon">
    <rect x="2" y="2" width="17" height="26" rx="2" class="tiling-preview-rect" />
    <rect x="21" y="2" width="17" height="12" rx="2" class="tiling-preview-rect" />
    <rect x="21" y="16" width="17" height="12" rx="2" class="tiling-preview-rect" />
  </svg>
);

const FourGridIcon: Component = () => (
  <svg viewBox="0 0 40 30" class="tiling-preview-icon">
    <rect x="2" y="2" width="17" height="12" rx="2" class="tiling-preview-rect" />
    <rect x="21" y="2" width="17" height="12" rx="2" class="tiling-preview-rect" />
    <rect x="2" y="16" width="17" height="12" rx="2" class="tiling-preview-rect" />
    <rect x="21" y="16" width="17" height="12" rx="2" class="tiling-preview-rect" />
  </svg>
);

const getLayoutIcon = (layout: TileLayout): Component => {
  switch (layout) {
    case 'tabbed':
      return TabbedIcon;
    case '2-split':
      return TwoSplitIcon;
    case '3-split':
      return ThreeSplitIcon;
    case '4-grid':
      return FourGridIcon;
  }
};

/**
 * TilingOverlay - Dropdown for selecting terminal tiling layout
 *
 * Layout:
 * +---------------------------+
 * |  [====]  Tabbed           |
 * |  [= =]   2 Split          |
 * |  [= =]   3 Split          |
 * |  [====]  4 Grid           |
 * +---------------------------+
 */
const TilingOverlay: Component<TilingOverlayProps> = (props) => {
  const availableOptions = () =>
    layoutOptions.filter((option) => option.minTabs <= props.tabCount);

  const handleOptionClick = (layout: TileLayout) => {
    props.onSelectLayout(layout);
  };

  const handleBackdropClick = () => {
    props.onClose();
  };

  const handleOverlayClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      {/* Invisible backdrop for outside click detection */}
      <div
        class="tiling-overlay-backdrop"
        onClick={handleBackdropClick}
        data-testid="tiling-overlay-backdrop"
      />

      {/* Overlay popover */}
      <div
        class="tiling-overlay"
        role="menu"
        onClick={handleOverlayClick}
        data-testid="tiling-overlay"
      >
        <For each={availableOptions()}>
          {(option) => {
            const IconComponent = getLayoutIcon(option.layout);
            const isActive = () => props.currentLayout === option.layout;

            return (
              <button
                class={`tiling-option ${isActive() ? 'tiling-option--active' : ''}`}
                role="menuitem"
                aria-label={option.ariaLabel}
                onClick={() => handleOptionClick(option.layout)}
                data-testid={`tiling-option-${option.layout}`}
                data-active={isActive() ? 'true' : 'false'}
              >
                <IconComponent />
                <span class="tiling-option-label">{option.label}</span>
              </button>
            );
          }}
        </For>

        <style>{`
          .tiling-overlay-backdrop {
            position: fixed;
            inset: 0;
            z-index: 98;
          }

          .tiling-overlay {
            position: absolute;
            top: 100%;
            right: 0;
            margin-top: var(--space-1);
            background: var(--color-bg-elevated);
            border: 1px solid var(--color-border-subtle);
            border-radius: var(--radius-lg);
            padding: var(--space-2);
            min-width: 140px;
            z-index: 99;
            box-shadow: var(--shadow-lg);
            animation: fadeInDown 150ms ease-out;
          }

          .tiling-option {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            width: 100%;
            padding: var(--space-2);
            border: 2px solid transparent;
            border-radius: var(--radius-md);
            background: transparent;
            color: var(--color-text-secondary);
            font-size: var(--text-sm);
            cursor: pointer;
            transition: all var(--transition-fast);
          }

          .tiling-option:hover {
            background: var(--color-bg-muted);
            color: var(--color-text-primary);
          }

          .tiling-option--active {
            border-color: var(--color-accent);
            color: var(--color-text-primary);
          }

          .tiling-option--active:hover {
            border-color: var(--color-accent-hover);
          }

          .tiling-preview-icon {
            width: 32px;
            height: 24px;
            flex-shrink: 0;
          }

          .tiling-preview-rect {
            fill: none;
            stroke: currentColor;
            stroke-width: 1.5;
          }

          .tiling-option-label {
            flex: 1;
            text-align: left;
          }

          @keyframes fadeInDown {
            from {
              opacity: 0;
              transform: translateY(-4px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          /* Reduced motion */
          @media (prefers-reduced-motion: reduce) {
            .tiling-overlay {
              animation: none;
            }
          }
        `}</style>
      </div>
    </>
  );
};

export default TilingOverlay;
