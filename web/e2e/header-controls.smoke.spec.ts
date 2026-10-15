import { expect, test, type Page } from '@playwright/test';
import type { SavedView } from '../src/api/types';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';

const savedViewsFixture: SavedView[] = [{
  id: 1,
  name: 'Daily commute',
  route: '/drives',
  query: 'quick=highway',
  is_default: false,
  is_pinned: false,
  sort_order: 0,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
}];

async function installSavedViewFixture(page: Page, mocks: Awaited<ReturnType<typeof installApiMocks>>) {
  await page.route('**/api/v1/saved-views?**', (route) =>
    fulfillApiFixture(route, mocks, {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(savedViewsFixture),
    }),
  );
}

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic header data');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 1440]) {
    test(`header help and icon controls are readable at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/drives');
      const mocks = await installApiMocks(page, 'populated', theme);
      await installSavedViewFixture(page, mocks);
      await page.goto('/drives?from=2026-08-01&to=2026-08-31');
      await waitForHarnessReady(page, mocks);
      const header = page.locator('[data-role="page-header"]');
      const help = header.getByRole('button', { name: /^More info:/ });
      await help.focus();
      const helpId = (await help.getAttribute('aria-describedby'))!;
      const tooltip = page.locator(`[id="${helpId}"]`);
      await expect(tooltip).toHaveCSS('opacity', '1');
      const box = (await tooltip.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(Math.min(320, width - 24) - 1);
      expect(box.x).toBeGreaterThanOrEqual(11);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 11);
      await expect(tooltip).toHaveCSS('white-space', 'normal');
      await page.screenshot({ path: test.info().outputPath(`header-help-${width}-${theme}.png`) });

      const views = header.getByRole('button', { name: 'Saved views', exact: true });
      await expect(views).toBeVisible();
      expect(await views.textContent()).toBe('');
      await views.focus();
      const viewsId = (await views.getAttribute('aria-describedby'))!;
      const viewsTooltip = page.locator(`[id="${viewsId}"]`);
      await expect(viewsTooltip).toHaveCSS('opacity', '1');
      await expect(viewsTooltip).toHaveText('Saved views');
      await views.click();
      const menu = page.getByRole('menu', { name: 'Saved views', exact: true });
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('background-color', /^rgb\(/);
      await expect(menu.getByRole('button', { name: 'Save current view…' }).first()).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Daily commute', exact: true })).toBeVisible();
      const pin = menu.getByRole('button', { name: 'Pin', exact: true });
      if (width < 640) {
        await expect(pin).toHaveCSS('opacity', '1');
        const pinBox = await pin.boundingBox();
        if (!pinBox) throw new Error('Saved-view pin has no measured geometry');
        expect(pinBox.width).toBeGreaterThanOrEqual(44);
        expect(pinBox.height).toBeGreaterThanOrEqual(44);
      } else {
        await pin.focus();
        await expect(pin).toHaveCSS('opacity', '1');
      }
      const menuBox = await menu.boundingBox();
      if (!menuBox) throw new Error('Saved-view menu has no measured geometry');
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: test.info().outputPath(`saved-view-menu-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);

      const freshness = header.getByRole('button', { name: /^Refresh data ·/ });
      await expect(freshness).toBeVisible();
      await expect(freshness).toHaveCSS('border-top-width', '0px');
      await expect(freshness).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await freshness.hover();
      await expect(freshness).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await page.screenshot({ path: test.info().outputPath(`header-controls-${width}-${theme}.png`) });
      await assertMockApiComplete(page, mocks);
    });
  }

  test.describe(`non-hover saved-view controls in ${theme}`, () => {
    test.use({ hasTouch: true, viewport: { width: 768, height: 900 } });

    test('keeps tablet actions visible, touch-sized and separate from the full view name', async ({ page }) => {
      await seedBrowserState(page, theme, '/drives');
      const mocks = await installApiMocks(page, 'populated', theme);
      await installSavedViewFixture(page, mocks);
      await page.goto('/drives?from=2026-08-01&to=2026-08-31');
      await waitForHarnessReady(page, mocks);
      await page.locator('[data-role="page-header"]').getByRole('button', { name: 'Saved views', exact: true }).click();
      const menu = page.getByRole('menu', { name: 'Saved views', exact: true });
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('background-color', /^rgb\(/);
      expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
      const nameBox = await menu.getByRole('button', { name: 'Daily commute', exact: true }).boundingBox();
      if (!nameBox) throw new Error('Saved-view name has no measured geometry');
      expect(nameBox.width).toBeGreaterThanOrEqual(200);
      for (const name of ['Set as default', 'Pin', 'Rename view', 'Delete']) {
        const action = menu.getByRole('button', { name, exact: true });
        await expect(action).toHaveCSS('opacity', '1');
        const box = await action.boundingBox();
        if (!box) throw new Error(`Saved-view ${name} action has no measured geometry`);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
      }
      await page.screenshot({ path: test.info().outputPath(`saved-view-touch-${theme}.png`) });
      await page.keyboard.press('Escape');
      await assertMockApiComplete(page, mocks);
    });
  });
}
