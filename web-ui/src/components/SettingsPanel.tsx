import { Component, createSignal, createEffect, Show, For, onMount } from 'solid-js';
import {
  mdiClose,
  mdiPaletteOutline,
  mdiConsole,
} from '@mdi/js';
import Icon from './Icon';
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

        </div>
      </aside>
    </>
  );
};

export default SettingsPanel;
