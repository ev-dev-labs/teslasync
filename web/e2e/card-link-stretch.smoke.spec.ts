import { expect, test } from '@playwright/test';
import { assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 1920]) {
    test(`shared surfaces fill linked native grid cells at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/settings');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.goto('/settings');
      await waitForHarnessReady(page, mocks);
      const main = page.locator('main');
      const link = main.getByRole('link', { name: /Export dashboard/ });
      const linked = link.locator('[data-surface-variant="standalone"]');
      const sibling = main.getByRole('heading', { name: 'Onboarding tour', exact: true })
        .locator('xpath=ancestor::*[@data-surface-variant="standalone"][1]');
      await expect(linked).toBeVisible();
      await expect(sibling).toBeVisible();
      const geometry = await link.evaluate(element => {
        const ancestors = [];
        for (let node: Element | null = element.querySelector('[data-surface-variant="standalone"]');
          node && !node.matches('main'); node = node.parentElement) {
          const css = getComputedStyle(node), box = node.getBoundingClientRect();
          ancestors.push({
            tag: node.tagName, class: node.className, stretch: node.getAttribute('data-card-stretch'),
            display: css.display, height: css.height, alignItems: css.alignItems,
            alignSelf: css.alignSelf, rows: css.gridTemplateRows,
            top: box.top, bottom: box.bottom,
          });
        }
        return ancestors;
      });
      await test.info().attach('native-row-allocation', {
        body: JSON.stringify(geometry), contentType: 'application/json',
      });
      await page.screenshot({ path: test.info().outputPath(`linked-grid-${width}-${theme}.png`) });
      const [surfaceBox, siblingBox] = await Promise.all([linked.boundingBox(), sibling.boundingBox()]);
      expect(surfaceBox).not.toBeNull();
      expect(siblingBox).not.toBeNull();
      expect(surfaceBox!.y).toBe(siblingBox!.y);
      expect(surfaceBox!.height).toBe(siblingBox!.height);
      await assertMockApiComplete(page, mocks);
    });
  }
}
