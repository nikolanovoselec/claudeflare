import { render as solidRender, cleanup } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';

// Re-export everything from testing-library
export * from '@solidjs/testing-library';

/**
 * Custom render function that wraps SolidJS Testing Library render
 * and handles cleanup properly
 */
export function render(ui: () => JSX.Element) {
  // Cleanup any previous renders
  cleanup();

  // Render the component
  const result = solidRender(ui);

  return {
    ...result,
    // Re-render with a new UI
    rerender: (newUi: () => JSX.Element) => {
      cleanup();
      return solidRender(newUi);
    },
  };
}

// Export cleanup for manual cleanup if needed
export { cleanup };
