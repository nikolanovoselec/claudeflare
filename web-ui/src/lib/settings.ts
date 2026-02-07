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
