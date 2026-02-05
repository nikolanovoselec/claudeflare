import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';
import Badge from '../../components/ui/Badge';

describe('Badge Component', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Default Rendering', () => {
    it('should render with children', () => {
      render(() => <Badge>New</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('New');
    });

    it('should render as a span element', () => {
      render(() => <Badge>Test</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge.tagName).toBe('SPAN');
    });
  });

  describe('Variants', () => {
    it('should render default variant by default', () => {
      render(() => <Badge>Default</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge).toHaveAttribute('data-variant', 'default');
    });

    it('should render success variant', () => {
      render(() => <Badge variant="success">Success</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge).toHaveAttribute('data-variant', 'success');
    });

    it('should render warning variant', () => {
      render(() => <Badge variant="warning">Warning</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge).toHaveAttribute('data-variant', 'warning');
    });

    it('should render error variant', () => {
      render(() => <Badge variant="error">Error</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge).toHaveAttribute('data-variant', 'error');
    });

    it('should render info variant', () => {
      render(() => <Badge variant="info">Info</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge).toHaveAttribute('data-variant', 'info');
    });
  });

  describe('Sizes', () => {
    it('should render medium size by default', () => {
      render(() => <Badge>Medium</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge).toHaveAttribute('data-size', 'md');
    });

    it('should render small size', () => {
      render(() => <Badge size="sm">Small</Badge>);
      const badge = screen.getByTestId('badge');

      expect(badge).toHaveAttribute('data-size', 'sm');
    });
  });

  describe('Dot Indicator', () => {
    it('should show dot indicator when dot prop is true', () => {
      render(() => <Badge dot>With Dot</Badge>);
      const badge = screen.getByTestId('badge');
      const dot = badge.querySelector('.badge-dot');

      expect(dot).toBeInTheDocument();
      expect(badge).toHaveAttribute('data-dot', 'true');
    });

    it('should not show dot indicator by default', () => {
      render(() => <Badge>No Dot</Badge>);
      const badge = screen.getByTestId('badge');
      const dot = badge.querySelector('.badge-dot');

      expect(dot).not.toBeInTheDocument();
      expect(badge).toHaveAttribute('data-dot', 'false');
    });
  });
});
