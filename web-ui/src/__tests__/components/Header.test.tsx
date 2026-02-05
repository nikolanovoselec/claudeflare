import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import Header from '../../components/Header';

describe('Header Component', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Default Rendering', () => {
    it('should render with required elements', () => {
      render(() => <Header />);

      // Logo
      const logo = screen.getByTestId('header-logo');
      expect(logo).toBeInTheDocument();
      expect(logo).toHaveTextContent('Claudeflare');

      // Settings button
      const settingsButton = screen.getByTestId('header-settings-button');
      expect(settingsButton).toBeInTheDocument();

      // User menu
      const userMenu = screen.getByTestId('header-user-menu');
      expect(userMenu).toBeInTheDocument();
    });

    it('should render logo with cloud icon', () => {
      render(() => <Header />);
      const logo = screen.getByTestId('header-logo');
      const icon = logo.querySelector('svg');

      expect(icon).toBeInTheDocument();
    });
  });

  describe('User Name Display', () => {
    it('should show user name when provided', () => {
      render(() => <Header userName="test@example.com" />);
      const userMenu = screen.getByTestId('header-user-menu');

      expect(userMenu).toHaveTextContent('test@example.com');
    });

    it('should show default avatar when no user name', () => {
      render(() => <Header />);
      const userMenu = screen.getByTestId('header-user-menu');
      const icon = userMenu.querySelector('svg');

      expect(icon).toBeInTheDocument();
    });
  });

  describe('Settings Button', () => {
    it('should call onSettingsClick when clicked', () => {
      const handleSettingsClick = vi.fn();
      render(() => <Header onSettingsClick={handleSettingsClick} />);

      const settingsButton = screen.getByTestId('header-settings-button');
      fireEvent.click(settingsButton);

      expect(handleSettingsClick).toHaveBeenCalledTimes(1);
    });

    it('should not throw when clicked without handler', () => {
      render(() => <Header />);
      const settingsButton = screen.getByTestId('header-settings-button');

      expect(() => fireEvent.click(settingsButton)).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button labels', () => {
      render(() => <Header />);

      const settingsButton = screen.getByTestId('header-settings-button');
      expect(settingsButton).toHaveAttribute('title');
    });
  });
});
