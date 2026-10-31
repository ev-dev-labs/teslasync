import { expect, test } from '@playwright/test';
import {
  assertMockApiComplete, installApiMocks, seedBrowserState, waitForHarnessReady,
} from './mockApi';

for (const theme of ['light', 'dark'] as const) {
  test(`notification pagination is fully reachable inside the main scroller in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date('2026-09-13T12:00:00Z'));
    const path = '/notifications/inbox?from=2026-08-20&to=2026-09-13';
    await seedBrowserState(page, theme, path);
    await page.addInitScript(() => {
      localStorage.setItem('teslasync.notifications.markOnOpen', 'false');
    });
    const mocks = await installApiMocks(page, 'populated', theme);
    await page.goto(path);
    await waitForHarnessReady(page, mocks);
    const main = page.locator('main');
    const table = main.getByRole('table', { name: 'Inbox', exact: true });
    const frame = table.locator('xpath=ancestor::*[@data-grid-frame][1]');
    const pagination = frame.getByRole('navigation', { name: 'Pagination', exact: true });
    await expect(table.getByText('Fleet connection restored', { exact: true })).toBeVisible();
    await expect(table.getByText('Charging schedule changed', { exact: true })).toBeVisible();
    await expect(table.getByText('Battery alert', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`pagination-initial-${theme}.png`) });
    const initialScroll = await main.evaluate(element => element.scrollTop);
    await main.hover();
    await page.mouse.wheel(0, 320);
    await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(initialScroll);
    await pagination.scrollIntoViewIfNeeded();
    await expect(pagination).toBeInViewport({ ratio: 1 });
    const geometry = await pagination.evaluate(element => {
      const scroller = element.closest('main')!;
      const bounds = element.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      return {
        top: bounds.top, bottom: bounds.bottom, viewportTop: viewport.top,
        viewportBottom: viewport.bottom, scrollTop: scroller.scrollTop,
      };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewportTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportBottom);
    const controls = pagination.locator('button, input, select').filter({ visible: true });
    expect(await controls.count()).toBeGreaterThan(3);
    for (const control of await controls.all()) await expect(control).toBeInViewport({ ratio: 1 });
    await pagination.getByRole('textbox', { name: 'Go to page', exact: true }).fill('1');
    await pagination.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(pagination.getByRole('textbox', { name: 'Go to page', exact: true }))
      .not.toHaveAttribute('aria-invalid', 'true');
    const occluded = await controls.evaluateAll(elements => elements.flatMap(element => {
      const bounds = element.getBoundingClientRect();
      const owner = element.closest('[data-grid-frame]')!;
      const points = [
        [bounds.left + 1, bounds.top + 1], [bounds.right - 1, bounds.top + 1],
        [bounds.left + 1, bounds.bottom - 1], [bounds.right - 1, bounds.bottom - 1],
        [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
      ];
      return points.some(([x, y]) => !owner.contains(document.elementFromPoint(x, y)))
        ? [element.getAttribute('aria-label') ?? element.textContent] : [];
    }));
    expect(occluded).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`pagination-reachable-${theme}.png`) });
    await test.info().attach('main-scroller-geometry', {
      body: JSON.stringify(geometry), contentType: 'application/json',
    });
    await assertMockApiComplete(page, mocks);
  });
}
