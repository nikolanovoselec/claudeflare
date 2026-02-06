import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import SettingsPanel, {
  loadSettings,
  saveSettings,
  defaultSettings,
  type Settings,
} from '../../components/SettingsPanel';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('SettingsPanel Component', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Panel Visibility', () => {
    it('should render when isOpen is true', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const panel = screen.getByTestId('settings-panel');
      expect(panel).toBeInTheDocument();
      expect(panel).toHaveClass('open');
    });

    it('should not be visible when isOpen is false', () => {
      render(() => <SettingsPanel isOpen={false} onClose={() => {}} />);

      const panel = screen.getByTestId('settings-panel');
      expect(panel).toBeInTheDocument();
      expect(panel).not.toHaveClass('open');
    });

    it('should show backdrop when open', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const backdrop = screen.getByTestId('settings-backdrop');
      expect(backdrop).toHaveClass('open');
    });

    it('should hide backdrop when closed', () => {
      render(() => <SettingsPanel isOpen={false} onClose={() => {}} />);

      const backdrop = screen.getByTestId('settings-backdrop');
      expect(backdrop).not.toHaveClass('open');
    });
  });

  describe('Close Button', () => {
    it('should call onClose when close button is clicked', () => {
      const handleClose = vi.fn();
      render(() => <SettingsPanel isOpen={true} onClose={handleClose} />);

      const closeButton = screen.getByTestId('settings-close-button');
      fireEvent.click(closeButton);

      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when backdrop is clicked', () => {
      const handleClose = vi.fn();
      render(() => <SettingsPanel isOpen={true} onClose={handleClose} />);

      const backdrop = screen.getByTestId('settings-backdrop');
      fireEvent.click(backdrop);

      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Appearance Settings', () => {
    it('should render theme select', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const themeSelect = screen.getByTestId('settings-theme-select');
      expect(themeSelect).toBeInTheDocument();
      expect(themeSelect).toHaveValue('dark');
    });

    it('should render font size select with correct options', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const fontSizeSelect = screen.getByTestId('settings-font-size-select');
      expect(fontSizeSelect).toBeInTheDocument();
      expect(fontSizeSelect).toHaveValue('14');

      // Check options exist
      const options = fontSizeSelect.querySelectorAll('option');
      const values = Array.from(options).map((opt) => opt.value);
      expect(values).toEqual(['12', '13', '14', '15', '16']);
    });

    it('should render terminal font select with correct options', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const fontSelect = screen.getByTestId('settings-terminal-font-select');
      expect(fontSelect).toBeInTheDocument();
      expect(fontSelect).toHaveValue('JetBrains Mono');

      const options = fontSelect.querySelectorAll('option');
      const values = Array.from(options).map((opt) => opt.value);
      expect(values).toContain('JetBrains Mono');
      expect(values).toContain('Fira Code');
      expect(values).toContain('SF Mono');
      expect(values).toContain('Menlo');
    });

    it('should update font size when changed', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const fontSizeSelect = screen.getByTestId('settings-font-size-select');
      fireEvent.change(fontSizeSelect, { target: { value: '16' } });

      expect(fontSizeSelect).toHaveValue('16');
    });

    it('should update terminal font when changed', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const fontSelect = screen.getByTestId('settings-terminal-font-select');
      fireEvent.change(fontSelect, { target: { value: 'Fira Code' } });

      expect(fontSelect).toHaveValue('Fira Code');
    });
  });

  describe('Terminal Settings', () => {
    it('should render cursor style select', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const cursorStyleSelect = screen.getByTestId('settings-cursor-style-select');
      expect(cursorStyleSelect).toBeInTheDocument();
      expect(cursorStyleSelect).toHaveValue('block');

      const options = cursorStyleSelect.querySelectorAll('option');
      const values = Array.from(options).map((opt) => opt.value);
      expect(values).toEqual(['block', 'underline', 'bar']);
    });

    it('should render cursor blink toggle', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const toggle = screen.getByTestId('settings-cursor-blink-toggle');
      expect(toggle).toBeInTheDocument();
      expect(toggle).toHaveClass('toggle-on'); // Default is true (uses shared CSS class)
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('should toggle cursor blink when clicked', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const toggle = screen.getByTestId('settings-cursor-blink-toggle');
      expect(toggle).toHaveClass('toggle-on');

      fireEvent.click(toggle);

      expect(toggle).not.toHaveClass('toggle-on');
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('should render scrollback select', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const scrollbackSelect = screen.getByTestId('settings-scrollback-select');
      expect(scrollbackSelect).toBeInTheDocument();
      expect(scrollbackSelect).toHaveValue('10000');

      const options = scrollbackSelect.querySelectorAll('option');
      const values = Array.from(options).map((opt) => opt.value);
      expect(values).toEqual(['1000', '5000', '10000', '50000']);
    });

    it('should update cursor style when changed', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const cursorStyleSelect = screen.getByTestId('settings-cursor-style-select');
      fireEvent.change(cursorStyleSelect, { target: { value: 'bar' } });

      expect(cursorStyleSelect).toHaveValue('bar');
    });

    it('should update scrollback when changed', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const scrollbackSelect = screen.getByTestId('settings-scrollback-select');
      fireEvent.change(scrollbackSelect, { target: { value: '50000' } });

      expect(scrollbackSelect).toHaveValue('50000');
    });
  });


  describe('LocalStorage Persistence', () => {
    it('should save settings to localStorage when changed', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const fontSizeSelect = screen.getByTestId('settings-font-size-select');
      fireEvent.change(fontSizeSelect, { target: { value: '16' } });

      // Check that localStorage.setItem was called
      expect(localStorageMock.setItem).toHaveBeenCalled();
      const lastCall = localStorageMock.setItem.mock.calls.slice(-1)[0];
      expect(lastCall[0]).toBe('claudeflare-settings');

      const savedSettings = JSON.parse(lastCall[1]);
      expect(savedSettings.fontSize).toBe(16);
    });

    it('should load settings from localStorage on mount', () => {
      const customSettings: Settings = {
        ...defaultSettings,
        fontSize: 16,
        terminalFont: 'Fira Code',
        cursorBlink: false,
      };
      localStorageMock.getItem.mockReturnValue(JSON.stringify(customSettings));

      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const fontSizeSelect = screen.getByTestId('settings-font-size-select');
      expect(fontSizeSelect).toHaveValue('16');

      const fontSelect = screen.getByTestId('settings-terminal-font-select');
      expect(fontSelect).toHaveValue('Fira Code');

      const toggle = screen.getByTestId('settings-cursor-blink-toggle');
      expect(toggle).not.toHaveClass('on');
    });
  });

  describe('Admin-gated User Management', () => {
    it('should show add user form when currentUserRole is admin', async () => {
      render(() => (
        <SettingsPanel
          isOpen={true}
          onClose={() => {}}
          currentUserRole="admin"
          currentUserEmail="admin@example.com"
        />
      ));

      // Admin should see the role selector for new users
      const roleSelect = screen.queryByTestId('settings-new-user-role-select');
      expect(roleSelect).toBeInTheDocument();
    });

    it('should show admin-only message when currentUserRole is user', () => {
      render(() => (
        <SettingsPanel
          isOpen={true}
          onClose={() => {}}
          currentUserRole="user"
          currentUserEmail="viewer@example.com"
        />
      ));

      const message = screen.queryByTestId('settings-admin-only-message');
      expect(message).toBeInTheDocument();
      expect(message!.textContent).toContain('Only admins');
    });

    it('should show admin-only message when no role provided', () => {
      render(() => (
        <SettingsPanel
          isOpen={true}
          onClose={() => {}}
        />
      ));

      const message = screen.queryByTestId('settings-admin-only-message');
      expect(message).toBeInTheDocument();
    });

    it('should render user management section', () => {
      render(() => (
        <SettingsPanel
          isOpen={true}
          onClose={() => {}}
          currentUserRole="admin"
        />
      ));

      const section = screen.getByTestId('settings-user-management');
      expect(section).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have correct ARIA attributes', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const panel = screen.getByTestId('settings-panel');
      expect(panel).toHaveAttribute('role', 'dialog');
      expect(panel).toHaveAttribute('aria-label', 'Settings');
    });

    it('should have aria-hidden when closed', () => {
      render(() => <SettingsPanel isOpen={false} onClose={() => {}} />);

      const panel = screen.getByTestId('settings-panel');
      expect(panel).toHaveAttribute('aria-hidden', 'true');
    });

    it('should not have aria-hidden when open', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const panel = screen.getByTestId('settings-panel');
      expect(panel).toHaveAttribute('aria-hidden', 'false');
    });

    it('should have accessible toggle switch', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const toggle = screen.getByTestId('settings-cursor-blink-toggle');
      expect(toggle).toHaveAttribute('role', 'switch');
      expect(toggle).toHaveAttribute('aria-checked');
    });

    it('should have accessible close button', () => {
      render(() => <SettingsPanel isOpen={true} onClose={() => {}} />);

      const closeButton = screen.getByTestId('settings-close-button');
      expect(closeButton).toHaveAttribute('title', 'Close settings');
    });
  });
});

describe('Settings Helper Functions', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('loadSettings', () => {
    it('should return default settings when localStorage is empty', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const settings = loadSettings();
      expect(settings).toEqual(defaultSettings);
    });

    it('should return saved settings when available', () => {
      const customSettings: Settings = {
        ...defaultSettings,
        fontSize: 16,
      };
      localStorageMock.getItem.mockReturnValue(JSON.stringify(customSettings));

      const settings = loadSettings();
      expect(settings.fontSize).toBe(16);
    });

    it('should merge partial settings with defaults', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify({ fontSize: 16 }));

      const settings = loadSettings();
      expect(settings.fontSize).toBe(16);
      expect(settings.theme).toBe(defaultSettings.theme);
      expect(settings.terminalFont).toBe(defaultSettings.terminalFont);
    });

    it('should return default settings on parse error', () => {
      localStorageMock.getItem.mockReturnValue('invalid json');

      const settings = loadSettings();
      expect(settings).toEqual(defaultSettings);
    });
  });

  describe('saveSettings', () => {
    it('should save settings to localStorage', () => {
      const customSettings: Settings = {
        ...defaultSettings,
        fontSize: 16,
      };

      saveSettings(customSettings);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'claudeflare-settings',
        JSON.stringify(customSettings)
      );
    });

    it('should not throw on localStorage error', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage full');
      });

      expect(() => saveSettings(defaultSettings)).not.toThrow();
    });
  });
});
