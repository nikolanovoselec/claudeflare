import { Component, createSignal, createEffect, Show, For, onMount } from 'solid-js';
import {
  mdiClose,
  mdiPaletteOutline,
  mdiConsole,
  mdiAccountGroupOutline,
} from '@mdi/js';
import Icon from './Icon';
import Button from './ui/Button';
import Input from './ui/Input';
import { getUsers, addUser, removeUser } from '../api/client';
import type { UserEntry } from '../api/client';
import '../styles/settings-panel.css';

export interface Settings {
  theme: 'dark' | 'light';
  fontSize: number;
  terminalFont: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;
  scrollback: number;
}

export const defaultSettings: Settings = {
  theme: 'dark',
  fontSize: 14,
  terminalFont: 'JetBrains Mono',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
};

const STORAGE_KEY = 'claudeflare-settings';

export const loadSettings = (): Settings => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
};

export const saveSettings = (settings: Settings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Silently fail if localStorage is not available
  }
};

export interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserEmail?: string;
  currentUserRole?: 'admin' | 'user';
}

const fontSizeOptions = [12, 13, 14, 15, 16];
const terminalFontOptions = ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo'];
const cursorStyleOptions: { value: Settings['cursorStyle']; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' },
];
const scrollbackOptions = [1000, 5000, 10000, 50000];

/**
 * SettingsPanel - Slide-out settings panel
 *
 * Layout:
 * +--------------------------------------------------+
 * | Settings                                    [X]  |
 * +--------------------------------------------------+
 * | APPEARANCE                                       |
 * | Theme           [Dark v]                         |
 * | Font Size       [14px v]                         |
 * | Terminal Font   [JetBrains Mono v]               |
 * +--------------------------------------------------+
 * | TERMINAL                                         |
 * | Cursor Style    [Block v]                        |
 * | Cursor Blink    [Toggle ON]                      |
 * | Scrollback      [10000]                          |
 * +--------------------------------------------------+
 * | KEYBOARD SHORTCUTS                               |
 * | Command Palette        Cmd+K                     |
 * | New Session            Cmd+N                     |
 * | Toggle Sidebar         Cmd+B                     |
 * | Close Tab              Cmd+W                     |
 * +--------------------------------------------------+
 */
const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  const [settings, setSettings] = createSignal<Settings>(defaultSettings);

  // User management state
  const [users, setUsers] = createSignal<UserEntry[]>([]);
  const [usersLoading, setUsersLoading] = createSignal(false);
  const [userEmail, setUserEmail] = createSignal('');
  const [newUserRole, setNewUserRole] = createSignal<'admin' | 'user'>('user');
  const [userError, setUserError] = createSignal('');

  const isAdmin = () => props.currentUserRole === 'admin';

  // Load settings on mount
  onMount(() => {
    setSettings(loadSettings());
  });

  // Save settings whenever they change
  createEffect(() => {
    saveSettings(settings());
  });

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // User management functions
  const loadUsers = async () => {
    setUsersLoading(true);
    setUserError('');
    try {
      const result = await getUsers();
      setUsers(result);
    } catch (e) {
      setUserError('Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  };

  // Load users when panel opens
  createEffect(() => {
    if (props.isOpen) {
      loadUsers();
    }
  });

  const handleAddUser = async () => {
    const email = userEmail().trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    try {
      setUserError('');
      await addUser(email, newUserRole());
      setUserEmail('');
      setNewUserRole('user');
      await loadUsers();
    } catch (e) {
      setUserError(e instanceof Error ? e.message : 'Failed to add user');
    }
  };

  const handleRemoveUser = async (email: string) => {
    try {
      setUserError('');
      await removeUser(email);
      await loadUsers();
    } catch (e) {
      setUserError(e instanceof Error ? e.message : 'Failed to remove user');
    }
  };

  const handleUserEmailKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddUser();
    }
  };

  // Handle Escape key to close panel
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.isOpen) {
      props.onClose();
    }
  };

  // Handle backdrop click
  const handleBackdropClick = () => {
    props.onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        class={`settings-backdrop ${props.isOpen ? 'open' : ''}`}
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
        data-testid="settings-backdrop"
      />

      {/* Panel */}
      <aside
        class={`settings-panel ${props.isOpen ? 'open' : ''}`}
        data-testid="settings-panel"
        role="dialog"
        aria-label="Settings"
        aria-hidden={!props.isOpen}
      >
        {/* Header */}
        <header class="settings-header">
          <h2 class="settings-title">Settings</h2>
          <button
            class="settings-close-button"
            onClick={() => props.onClose()}
            title="Close settings"
            data-testid="settings-close-button"
          >
            <Icon path={mdiClose} size={20} />
          </button>
        </header>

        {/* Content */}
        <div class="settings-content">
          {/* Appearance Section */}
          <section class="settings-section settings-section-1">
            <div class="settings-section-header">
              <Icon path={mdiPaletteOutline} size={16} />
              <h3 class="settings-section-title">Appearance</h3>
            </div>

            {/* Theme */}
            <div class="setting-row">
              <label for="settings-theme">Theme</label>
              <select
                id="settings-theme"
                value={settings().theme}
                onChange={(e) => updateSetting('theme', e.currentTarget.value as Settings['theme'])}
                data-testid="settings-theme-select"
              >
                <option value="dark">Dark</option>
              </select>
            </div>

            {/* Font Size */}
            <div class="setting-row">
              <label for="settings-font-size">Font Size</label>
              <select
                id="settings-font-size"
                value={settings().fontSize}
                onChange={(e) => updateSetting('fontSize', parseInt(e.currentTarget.value, 10))}
                data-testid="settings-font-size-select"
              >
                <For each={fontSizeOptions}>
                  {(size) => <option value={size}>{size}px</option>}
                </For>
              </select>
            </div>

            {/* Terminal Font */}
            <div class="setting-row">
              <label for="settings-terminal-font">Terminal Font</label>
              <select
                id="settings-terminal-font"
                value={settings().terminalFont}
                onChange={(e) => updateSetting('terminalFont', e.currentTarget.value)}
                data-testid="settings-terminal-font-select"
              >
                <For each={terminalFontOptions}>
                  {(font) => <option value={font}>{font}</option>}
                </For>
              </select>
            </div>
          </section>

          {/* Terminal Section */}
          <section class="settings-section settings-section-2">
            <div class="settings-section-header">
              <Icon path={mdiConsole} size={16} />
              <h3 class="settings-section-title">Terminal</h3>
            </div>

            {/* Cursor Style */}
            <div class="setting-row">
              <label for="settings-cursor-style">Cursor Style</label>
              <select
                id="settings-cursor-style"
                value={settings().cursorStyle}
                onChange={(e) => updateSetting('cursorStyle', e.currentTarget.value as Settings['cursorStyle'])}
                data-testid="settings-cursor-style-select"
              >
                <For each={cursorStyleOptions}>
                  {(option) => <option value={option.value}>{option.label}</option>}
                </For>
              </select>
            </div>

            {/* Cursor Blink */}
            <div class="form-row">
              <label for="settings-cursor-blink">Cursor Blink</label>
              <button
                id="settings-cursor-blink"
                class={`toggle ${settings().cursorBlink ? 'toggle-on' : ''}`}
                onClick={() => updateSetting('cursorBlink', !settings().cursorBlink)}
                role="switch"
                aria-checked={settings().cursorBlink}
                data-testid="settings-cursor-blink-toggle"
              >
                <span class="toggle-thumb" />
              </button>
            </div>

            {/* Scrollback Lines */}
            <div class="setting-row">
              <label for="settings-scrollback">Scrollback Lines</label>
              <select
                id="settings-scrollback"
                value={settings().scrollback}
                onChange={(e) => updateSetting('scrollback', parseInt(e.currentTarget.value, 10))}
                data-testid="settings-scrollback-select"
              >
                <For each={scrollbackOptions}>
                  {(lines) => <option value={lines}>{lines.toLocaleString()}</option>}
                </For>
              </select>
            </div>
          </section>

          {/* User Management Section */}
          <section class="settings-section settings-section-3" data-testid="settings-user-management">
            <div class="settings-section-header">
              <Icon path={mdiAccountGroupOutline} size={16} />
              <h3 class="settings-section-title">User Management</h3>
            </div>

            {/* Admin-only: Add user form */}
            <Show when={isAdmin()}>
              <div class="setting-row" style="flex-direction: column; align-items: stretch">
                <div style="display: flex; gap: 8px; width: 100%; align-items: flex-start">
                  <div style="flex: 1" onKeyDown={handleUserEmailKeyDown}>
                    <Input
                      value={userEmail()}
                      onInput={(value) => { setUserEmail(value); setUserError(''); }}
                      placeholder="user@example.com"
                    />
                  </div>
                  <select
                    value={newUserRole()}
                    onChange={(e) => setNewUserRole(e.currentTarget.value as 'admin' | 'user')}
                    class="settings-role-select"
                    data-testid="settings-new-user-role-select"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <Button onClick={handleAddUser} variant="secondary" size="sm">Add</Button>
                </div>
              </div>
            </Show>

            {/* Non-admin: info message */}
            <Show when={!isAdmin()}>
              <div class="setting-row" data-testid="settings-admin-only-message">
                <span class="settings-hint">Only admins can manage users</span>
              </div>
            </Show>

            {/* Error */}
            <Show when={userError()}>
              <div class="settings-error" data-testid="settings-user-error">{userError()}</div>
            </Show>

            {/* User list */}
            <Show when={usersLoading()}>
              <div class="setting-row" style="justify-content: center">
                <span class="settings-hint">Loading users...</span>
              </div>
            </Show>
            <Show when={!usersLoading()}>
              <For each={users()}>
                {(user) => (
                  <div class="setting-row" style="display: flex; justify-content: space-between; align-items: center" data-testid="settings-user-row">
                    <div style="min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
                      <span style="font-size: var(--text-sm); color: var(--color-text-primary)">{user.email}</span>
                      <span
                        class={`settings-role-badge ${user.role === 'admin' ? 'settings-role-badge--admin' : 'settings-role-badge--user'}`}
                        data-testid="settings-user-role-badge"
                      >
                        {user.role === 'admin' ? 'Admin' : 'User'}
                      </span>
                      <span class="settings-hint" style="font-size: var(--text-xs)">
                        added by {user.addedBy}
                      </span>
                    </div>
                    <Show when={isAdmin()}>
                      <Button
                        onClick={() => handleRemoveUser(user.email)}
                        variant="ghost"
                        size="sm"
                        disabled={user.email === props.currentUserEmail}
                      >
                        Remove
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
            <Show when={!usersLoading() && users().length === 0 && !userError()}>
              <div class="setting-row" style="justify-content: center">
                <span class="settings-hint">No users added yet</span>
              </div>
            </Show>
          </section>

        </div>
      </aside>
    </>
  );
};

export default SettingsPanel;
