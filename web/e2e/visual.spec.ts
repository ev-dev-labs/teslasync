import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete,
  expectThemeApplied,
  installApiMocks,
  seedBrowserState,
  waitForHarnessReady,
  waitForNoVisibleActivity,
} from './mockApi';
import { VISUAL_ROUTES } from './routeRegistry';

for (const route of VISUAL_ROUTES) {
  test(`${route.name} visual baseline`, async ({ page }, testInfo) => {
    const theme = testInfo.project.name.endsWith('-light') ? 'light' : 'dark';
    await seedBrowserState(page, theme, route.path);
    const mockApi = await installApiMocks(page, 'populated', theme);
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await waitForHarnessReady(page, mockApi);
    await expectThemeApplied(page, theme);
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const viewportHeight = page.viewportSize()?.height ?? 900;
    for (let top = viewportHeight; top < pageHeight; top += viewportHeight) {
      await page.evaluate((scrollTop) => window.scrollTo(0, scrollTop), top);
      await waitForNoVisibleActivity(page);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForHarnessReady(page, mockApi);
    const sidebar = page.getByRole('navigation', { name: /sidebar navigation/i });
    if (await sidebar.count()) {
      await sidebar.evaluate((element) => { element.scrollTop = 0; });
    }
    if (route.name === 'battery') {
      await expect(page.getByText('State of Health', { exact: true })).toBeVisible();
    }
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          caret-color: transparent !important;
        }
        [aria-label^="API connection status"] {
          min-width: 8rem !important;
        }
        [aria-label^="Refresh data"],
        [aria-label^="Data freshness:"] {
          width: 8.5rem !important;
          min-width: 8.5rem !important;
          max-width: 8.5rem !important;
        }
      `,
    });
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      animations: 'disabled',
      fullPage: true,
      mask: [
        page.locator('time'),
        page.locator('[data-testid*="timestamp"], [data-testid*="relative-time"]'),
        page.locator('[aria-label^="API connection status"], [aria-label^="Refresh data"], [aria-label^="Data freshness:"]'),
        page.locator('.recharts-tooltip-wrapper'),
      ],
      threshold: 0.1,
      maxDiffPixels: 500,
    });
    await assertMockApiComplete(page, mockApi);
  });
}
