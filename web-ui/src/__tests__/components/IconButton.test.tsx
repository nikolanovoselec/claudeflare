import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import IconButton from '../../components/ui/IconButton';

describe('IconButton Component', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Default Rendering', () => {
    it('should render with required icon prop', () => {
      render(() => <IconButton icon="M10 10" />);
      const button = screen.getByTestId('icon-button');

      expect(button).toBeInTheDocument();
      expect(button.querySelector('svg')).toBeInTheDocument();
    });

    it('should render as a button element', () => {
      render(() => <IconButton icon="M10 10" />);
      const button = screen.getByTestId('icon-button');

      expect(button.tagName).toBe('BUTTON');
    });
  });

  describe('Variants', () => {
    it('should render default variant by default', () => {
      render(() => <IconButton icon="M10 10" />);
      const button = screen.getByTestId('icon-button');

      expect(button).toHaveAttribute('data-variant', 'default');
    });

    it('should render ghost variant', () => {
      render(() => <IconButton icon="M10 10" variant="ghost" />);
      const button = screen.getByTestId('icon-button');

      expect(button).toHaveAttribute('data-variant', 'ghost');
    });
  });

  describe('Sizes', () => {
    it('should render medium size by default', () => {
      render(() => <IconButton icon="M10 10" />);
      const button = screen.getByTestId('icon-button');

      expect(button).toHaveAttribute('data-size', 'md');
    });

    it('should render small size', () => {
      render(() => <IconButton icon="M10 10" size="sm" />);
      const button = screen.getByTestId('icon-button');

      expect(button).toHaveAttribute('data-size', 'sm');
    });

    it('should render large size', () => {
      render(() => <IconButton icon="M10 10" size="lg" />);
      const button = screen.getByTestId('icon-button');

      expect(button).toHaveAttribute('data-size', 'lg');
    });
  });

  describe('Tooltip', () => {
    it('should set title attribute when tooltip is provided', () => {
      render(() => <IconButton icon="M10 10" tooltip="My tooltip" />);
      const button = screen.getByTestId('icon-button');

      expect(button).toHaveAttribute('title', 'My tooltip');
    });

    it('should not have title attribute when tooltip is not provided', () => {
      render(() => <IconButton icon="M10 10" />);
      const button = screen.getByTestId('icon-button');

      expect(button).not.toHaveAttribute('title');
    });
  });

  describe('Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      render(() => <IconButton icon="M10 10" disabled />);
      const button = screen.getByTestId('icon-button');

      expect(button).toBeDisabled();
    });

    it('should not be disabled by default', () => {
      render(() => <IconButton icon="M10 10" />);
      const button = screen.getByTestId('icon-button');

      expect(button).not.toBeDisabled();
    });
  });

  describe('Click Handler', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn();
      render(() => <IconButton icon="M10 10" onClick={handleClick} />);
      const button = screen.getByTestId('icon-button');

      fireEvent.click(button);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should not call onClick when disabled', () => {
      const handleClick = vi.fn();
      render(() => <IconButton icon="M10 10" onClick={handleClick} disabled />);
      const button = screen.getByTestId('icon-button');

      fireEvent.click(button);

      expect(handleClick).not.toHaveBeenCalled();
    });
  });
});
