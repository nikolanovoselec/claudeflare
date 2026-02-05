import { Component, Show } from 'solid-js';
import {
  mdiCloudOutline,
  mdiCogOutline,
  mdiAccountCircle,
  mdiLogout,
} from '@mdi/js';
import Icon from './Icon';

export interface HeaderProps {
  userName?: string;
  onSettingsClick?: () => void;
}

/**
 * Header component - top bar with logo and user menu
 *
 * Layout:
 * +------------------------------------------------------------------+
 * | [Cloud] Claudeflare                        [Avatar] [Settings]    |
 * +------------------------------------------------------------------+
 */
const Header: Component<HeaderProps> = (props) => {
  return (
    <header class="header animate-fadeInUp">
      {/* Logo */}
      <div class="header-logo" data-testid="header-logo">
        <Icon path={mdiCloudOutline} size={22} class="header-logo-icon" />
        <span class="header-logo-text">Claudeflare</span>
      </div>

      {/* Spacer for flex layout */}
      <div class="header-spacer" />

      {/* Right side - User menu and settings */}
      <div class="header-actions">
        {/* User menu */}
        <button class="header-user-menu" data-testid="header-user-menu" title="User menu">
          <Icon path={mdiAccountCircle} size={24} class="header-user-avatar" />
          <Show when={props.userName}>
            <span class="header-user-name">{props.userName}</span>
          </Show>
        </button>

        {/* Settings button */}
        <button
          class="header-settings-button"
          data-testid="header-settings-button"
          title="Settings"
          onClick={() => props.onSettingsClick?.()}
        >
          <Icon path={mdiCogOutline} size={20} class="settings-rotate" />
        </button>

        {/* Logout button */}
        <button
          class="header-logout-button"
          data-testid="header-logout-button"
          title="Logout"
        >
          <Icon path={mdiLogout} size={20} />
        </button>
      </div>

      <style>{`
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: var(--header-height);
          padding: 0 var(--space-4);
          background: var(--color-bg-surface);
          border-bottom: 1px solid var(--color-border-subtle);
          gap: var(--space-4);
        }

        /* Logo */
        .header-logo {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-shrink: 0;
        }

        .header-logo-icon {
          color: var(--color-accent);
        }

        .header-logo-text {
          font-size: var(--text-lg);
          font-weight: var(--font-semibold);
          color: var(--color-text-primary);
        }

        /* Spacer to push actions to the right */
        .header-spacer {
          flex: 1;
        }

        /* Actions */
        .header-actions {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-shrink: 0;
        }

        .header-user-menu {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-1) var(--space-2);
          border-radius: var(--radius-md);
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .header-user-menu:hover {
          background: var(--color-bg-muted);
          color: var(--color-text-primary);
        }

        .header-user-avatar {
          flex-shrink: 0;
        }

        .header-user-name {
          font-size: var(--text-sm);
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .header-settings-button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-md);
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .header-settings-button:hover {
          background: var(--color-bg-muted);
          color: var(--color-text-primary);
        }

        .header-settings-button:focus-visible {
          outline: none;
          box-shadow: var(--glow-accent);
        }

        .header-logout-button {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: var(--radius-md);
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .header-logout-button:hover {
          background: var(--color-bg-muted);
          color: var(--color-text-primary);
        }

        .header-logout-button:focus-visible {
          outline: none;
          box-shadow: var(--glow-accent);
        }

        /* Settings cog rotation on hover is defined in animations.css */
      `}</style>
    </header>
  );
};

export default Header;
