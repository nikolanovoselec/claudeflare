import { Component, Show } from 'solid-js';
import {
  mdiCloudOutline,
  mdiCogOutline,
  mdiAccountCircle,
  mdiLogout,
} from '@mdi/js';
import Icon from './Icon';
import '../styles/header.css';

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

    </header>
  );
};

export default Header;
