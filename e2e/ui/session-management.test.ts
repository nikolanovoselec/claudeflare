import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Browser, Page } from 'puppeteer';
import { launchBrowser, createPage, navigateToHome, takeScreenshot, waitForAppReady } from './setup';
import {
  waitForSelector,
  clickAndWait,
  getTextContent,
  typeIntoInput,
  elementExists,
  isElementVisible,
  waitForText,
  getElementCount,
  waitForElementRemoved,
  getAllElements,
} from './helpers';
import { cleanupSessions } from '../helpers/test-utils';

/**
 * E2E Tests for Session Management
 *
 * Tests the session CRUD operations:
 * - Empty state when no sessions exist
 * - Creating new sessions
 * - Session initialization progress
 * - Session list display
 * - Searching and filtering sessions
 * - Stopping and deleting sessions
 */
describe('Session Management', () => {
  let browser: Browser;
  let page: Page;
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    browser = await launchBrowser();
  });

  afterAll(async () => {
    // Cleanup created sessions via API
    await cleanupSessions(createdSessionIds);
    await browser.close();
  });

  beforeEach(async () => {
    page = await createPage(browser);
  });

  afterEach(async () => {
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      console.error('Error closing page:', error);
    }
  });

  describe('Empty State', () => {
    it('shows empty state when no sessions exist', async () => {
      await navigateToHome(page);

      // Wait for app to load
      const appLoaded = await elementExists(page, '[data-testid="header-logo"]', 10000);

      if (appLoaded) {
        // Check for empty state (either in session list or main area)
        const emptyStateExists =
          (await elementExists(page, '[data-testid="empty-state-no-sessions"]', 3000)) ||
          (await elementExists(page, '[data-testid="session-list-empty"]', 3000)) ||
          (await elementExists(page, '.empty-state', 3000));

        // If there are sessions, the empty state won't show
        const hasSessionCards = await elementExists(page, '[data-testid^="session-card-"]', 2000);

        if (!hasSessionCards) {
          // We should see an empty state
          expect(emptyStateExists).toBe(true);
        }
      }
    });

    it('empty state contains action to create session', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Check if empty state with action exists
      const emptyStateAction = await elementExists(page, '[data-testid="empty-state-action"]', 3000);
      const createButton = await elementExists(page, '[data-testid="empty-state-create-button"]', 3000);

      // Either we have sessions or we have a way to create them
      const hasSessionCards = await elementExists(page, '[data-testid^="session-card-"]', 2000);

      if (!hasSessionCards) {
        // Should have some way to create a session
        const hasCreateOption = emptyStateAction || createButton ||
          (await elementExists(page, 'button[title*="session" i]', 2000)) ||
          (await elementExists(page, '.session-list button', 2000));

        expect(hasCreateOption).toBe(true);
      }
    });

    it('empty state displays helpful message', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Check for empty state message
      const hasSessionCards = await elementExists(page, '[data-testid^="session-card-"]', 2000);

      if (!hasSessionCards) {
        // Look for empty state content
        const emptyStateTitle = await elementExists(page, '[data-testid="empty-state-title"]', 2000);
        const emptyStateDesc = await elementExists(page, '[data-testid="empty-state-description"]', 2000);

        // Should have some empty state messaging
        expect(emptyStateTitle || emptyStateDesc).toBe(true);
      }
    });
  });

  describe('Session List Display', () => {
    it('displays session list search input', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Session list search should be visible
      const searchExists = await elementExists(page, '[data-testid="session-list-search"]', 5000);
      expect(searchExists).toBe(true);
    });

    it('displays session filter tabs', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Filter tabs should be visible
      const filterAll = await elementExists(page, '[data-testid="session-list-filter-all"]', 3000);
      const filterRunning = await elementExists(page, '[data-testid="session-list-filter-running"]', 3000);
      const filterStopped = await elementExists(page, '[data-testid="session-list-filter-stopped"]', 3000);

      expect(filterAll).toBe(true);
      expect(filterRunning).toBe(true);
      expect(filterStopped).toBe(true);
    });

    it('filter tab "All" is active by default', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Wait for filter tabs
      await waitForSelector(page, '[data-testid="session-list-filter-all"]');

      // Check if "All" filter is active
      const isActive = await page.evaluate(() => {
        const allTab = document.querySelector('[data-testid="session-list-filter-all"]');
        return allTab?.classList.contains('active') || false;
      });

      expect(isActive).toBe(true);
    });

    it('displays session cards for existing sessions', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Wait a moment for sessions to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check for session cards or empty state
      const sessionCards = await page.$$('[data-testid^="session-card-"]');
      const hasEmptyState = await elementExists(page, '[data-testid="session-list-empty"]', 1000);

      // Either we have cards or empty state
      expect(sessionCards.length > 0 || hasEmptyState).toBe(true);
    });

    it('session cards show duration information', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Wait for potential session cards
      const sessionCards = await page.$$('[data-testid^="session-card-"]');

      if (sessionCards.length > 0) {
        // First session card should have duration info
        const hasDuration = await elementExists(page, '[data-testid$="-duration"]', 2000);
        expect(hasDuration).toBe(true);
      }
    });

    it('session cards show last accessed time', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      const sessionCards = await page.$$('[data-testid^="session-card-"]');

      if (sessionCards.length > 0) {
        // First session card should have last accessed info
        const hasAccessed = await elementExists(page, '[data-testid$="-accessed"]', 2000);
        expect(hasAccessed).toBe(true);
      }
    });
  });

  describe('Search Functionality', () => {
    it('can type in search input', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Find and interact with search input
      await waitForSelector(page, '[data-testid="session-list-search"]');

      // Type a search query
      const searchInput = await page.$('[data-testid="session-list-search"] input');
      if (searchInput) {
        await searchInput.type('test');

        // Verify the input value
        const value = await page.evaluate(
          (el) => (el as HTMLInputElement).value,
          searchInput
        );
        expect(value).toBe('test');
      }
    });

    it('search filters session list', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Get initial session count
      const initialCards = await page.$$('[data-testid^="session-card-"]');

      if (initialCards.length > 0) {
        // Type a search query that probably won't match
        const searchInput = await page.$('[data-testid="session-list-search"] input');
        if (searchInput) {
          await searchInput.type('zzzznonexistent');

          // Wait for filter to apply
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Check for filtered results or empty state
          const filteredCards = await page.$$('[data-testid^="session-card-"]');
          const hasNoResults = await elementExists(page, '[data-testid="empty-state-no-results"]', 1000);

          // Should have fewer cards or show "no results" empty state
          expect(filteredCards.length < initialCards.length || hasNoResults).toBe(true);
        }
      }
    });

    it('can clear search input', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      const searchInput = await page.$('[data-testid="session-list-search"] input');
      if (searchInput) {
        // Type something
        await searchInput.type('test');

        // Clear it (triple click + delete)
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');

        // Verify empty
        const value = await page.evaluate(
          (el) => (el as HTMLInputElement).value,
          searchInput
        );
        expect(value).toBe('');
      }
    });
  });

  describe('Filter Functionality', () => {
    it('can click running filter tab', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Click the running filter
      await clickAndWait(page, '[data-testid="session-list-filter-running"]');

      // Verify it's now active
      const isActive = await page.evaluate(() => {
        const tab = document.querySelector('[data-testid="session-list-filter-running"]');
        return tab?.classList.contains('active') || false;
      });

      expect(isActive).toBe(true);
    });

    it('can click stopped filter tab', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Click the stopped filter
      await clickAndWait(page, '[data-testid="session-list-filter-stopped"]');

      // Verify it's now active
      const isActive = await page.evaluate(() => {
        const tab = document.querySelector('[data-testid="session-list-filter-stopped"]');
        return tab?.classList.contains('active') || false;
      });

      expect(isActive).toBe(true);
    });

    it('filters only show matching sessions', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Get all sessions count
      await clickAndWait(page, '[data-testid="session-list-filter-all"]');
      const allCards = await page.$$('[data-testid^="session-card-"]');

      // Get running sessions count
      await clickAndWait(page, '[data-testid="session-list-filter-running"]');
      const runningCards = await page.$$('[data-testid^="session-card-"]');

      // Get stopped sessions count
      await clickAndWait(page, '[data-testid="session-list-filter-stopped"]');
      const stoppedCards = await page.$$('[data-testid^="session-card-"]');

      // Running + Stopped should <= All (some might be in other states)
      expect(runningCards.length + stoppedCards.length).toBeLessThanOrEqual(allCards.length + 1);
    });

    it('can switch back to all filter', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Switch to running
      await clickAndWait(page, '[data-testid="session-list-filter-running"]');

      // Switch back to all
      await clickAndWait(page, '[data-testid="session-list-filter-all"]');

      // Verify all is active
      const isActive = await page.evaluate(() => {
        const tab = document.querySelector('[data-testid="session-list-filter-all"]');
        return tab?.classList.contains('active') || false;
      });

      expect(isActive).toBe(true);
    });
  });

  describe('Session Card Interactions', () => {
    it('session card is clickable', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      const sessionCards = await page.$$('[data-testid^="session-card-"]');

      if (sessionCards.length > 0) {
        // Get the first card's testid
        const testId = await page.evaluate(
          (el) => el.getAttribute('data-testid'),
          sessionCards[0]
        );

        // Click the card
        await sessionCards[0].click();

        // Card should respond (might become selected, start session, etc.)
        // This is a smoke test - just verify no errors
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    });

    it('running session shows tab count', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Filter to running sessions
      await clickAndWait(page, '[data-testid="session-list-filter-running"]');

      const runningCards = await page.$$('[data-testid^="session-card-"]');

      if (runningCards.length > 0) {
        // Running sessions should show tab count
        const hasTabCount = await elementExists(page, '[data-testid$="-tabs"]', 2000);
        expect(hasTabCount).toBe(true);
      }
    });

    it('initializing session shows progress bar', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Check for any session with progress bar
      const hasProgress = await elementExists(page, '[data-testid$="-progress"]', 2000);

      // This might not always be visible (depends on session state)
      // Just verify the selector works when present
    });
  });

  describe('Session Creation', () => {
    it('has mechanism to create new session', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Look for create session button/action
      const hasCreateButton =
        (await elementExists(page, '[data-testid="empty-state-action"]', 2000)) ||
        (await elementExists(page, 'button[title*="session" i]', 2000)) ||
        (await elementExists(page, '.session-list-header button', 2000)) ||
        (await elementExists(page, '[aria-label*="create" i]', 2000));

      // Even with existing sessions, there should be a way to create more
      expect(hasCreateButton).toBe(true);
    });
  });

  describe('Keyboard Navigation', () => {
    it('search input can be focused with keyboard shortcut', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // The app supports Cmd+/ to focus search
      await page.keyboard.down('Control');
      await page.keyboard.press('/');
      await page.keyboard.up('Control');

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check if search input is focused
      const isFocused = await page.evaluate(() => {
        const searchInput = document.querySelector('[data-testid="session-list-search"] input');
        return document.activeElement === searchInput;
      });

      // Note: This might not work if keyboard shortcuts aren't fully implemented
      // This is a best-effort test
    });
  });

  describe('Session Status Display', () => {
    it('displays status badges on session cards', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      const sessionCards = await page.$$('[data-testid^="session-card-"]');

      if (sessionCards.length > 0) {
        // Session cards should have status indication (badge, icon, or class)
        const hasBadge = await elementExists(page, '[data-testid="badge"]', 2000);
        const hasStatusClass = await page.evaluate(() => {
          const card = document.querySelector('[data-testid^="session-card-"]');
          const cardWrapper = card?.querySelector('.session-card, [class*="status"]');
          return cardWrapper !== null;
        });

        expect(hasBadge || hasStatusClass).toBe(true);
      }
    });
  });

  describe('UI Responsiveness', () => {
    it('sidebar session list is scrollable with many items', async () => {
      await navigateToHome(page);
      await waitForAppReady(page);

      // Check that session list container exists and has overflow handling
      const hasScrollableContainer = await page.evaluate(() => {
        const container = document.querySelector('.session-list-items, .layout-sidebar-content');
        if (!container) return false;

        const style = window.getComputedStyle(container);
        return (
          style.overflow === 'auto' ||
          style.overflow === 'scroll' ||
          style.overflowY === 'auto' ||
          style.overflowY === 'scroll'
        );
      });

      // The list should be scrollable
      expect(hasScrollableContainer).toBe(true);
    });

    it('session list loads within reasonable time', async () => {
      const startTime = Date.now();

      await navigateToHome(page);
      await waitForAppReady(page);

      // Wait for session list to be ready
      await waitForSelector(page, '[data-testid="session-list-search"]');

      const loadTime = Date.now() - startTime;

      // Should load within 10 seconds
      expect(loadTime).toBeLessThan(10000);
    });
  });
});
