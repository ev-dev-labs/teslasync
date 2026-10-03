import { expect, test } from '@playwright/test';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';
test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic loaded-table evidence');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1440, 2560]) {
    test(`shared data table contains wide values at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/notifications/audit');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/system/audit*', (route) => fulfillApiFixture(route, mocks, {
        json: [{
          id: 1,
          created_at: '2026-08-25T08:00:00.000Z',
          action: 'configuration.updated',
          resource: `test-resource-${'identifier'.repeat(30)}`,
          details: 'Synthetic audit entry for responsive table coverage.',
        }],
      }));
      await page.goto('/notifications/audit');
      await waitForHarnessReady(page, mocks);
      const table = page.getByRole('table', { name: 'audit-logs' });
      await expect(table).toBeVisible();
      const details = table.locator('thead th[data-column-key="details"]');
      await expect(details).toHaveCount(1);
      if (width < 768) await expect(details).toBeHidden();
      else await expect(details).toBeVisible();
      const scroll = table.locator('..');
      const geometry = await scroll.evaluate((node) => ({
        width: node.clientWidth, scrollWidth: node.scrollWidth,
        right: node.getBoundingClientRect().right,
        viewport: window.innerWidth,
        overflow: getComputedStyle(node).overflowX,
      }));
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      expect(['auto', 'scroll']).toContain(geometry.overflow);
      if (width <= 1024) expect(geometry.scrollWidth).toBeGreaterThan(geometry.width);
      const download = page.getByRole('button', { name: 'Download CSV', exact: true });
      await expect(download).toBeVisible();
      const bounds = await download.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await expect(page.getByRole('navigation', { name: 'Pagination', exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1440) {
        await page.screenshot({ path: test.info().outputPath(`shared-table-${width}-${theme}.png`), fullPage: true });
      }
      await assertMockApiComplete(page, mocks);
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`bounded audit results do not advertise exhaustive value filters in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedBrowserState(page, theme, '/notifications/audit');
    const mocks = await installApiMocks(page, 'populated', theme);
    await page.route('**/api/v1/system/audit*', (route) => fulfillApiFixture(route, mocks, {
      json: Array.from({ length: 63 }, (_, index) => ({
        id: index + 1,
        created_at: '2026-08-25T08:00:00.000Z',
        action: index === 62 ? 'audit.reviewed' : 'configuration.updated',
        resource: `audit-resource-${index + 1}`,
        details: 'Synthetic loaded-window filter evidence.',
      })),
    }));
    await page.goto('/notifications/audit');
    await waitForHarnessReady(page, mocks);
    const table = page.getByRole('table', { name: 'audit-logs' });
    await expect(table).toBeVisible();
    expect(await table.locator('tbody tr').count()).toBeLessThan(63);
    await expect(table.getByRole('button', { name: / filter$/ })).toHaveCount(0);
    await expect(table.locator('tbody td[data-column-key="action"]').first()).toHaveText('configuration.updated');
    await expect(page.getByRole('button', { name: 'Download CSV', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pagination', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await assertMockApiComplete(page, mocks);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`complete automation checklist filters before pagination at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/automations/list');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/automations/routine-templates', (route) => fulfillApiFixture(route, mocks, {
        json: [],
      }));
      await page.route('**/api/v1/automations', (route) => fulfillApiFixture(route, mocks, {
        json: Array.from({ length: 63 }, (_, index) => ({
          id: index + 1,
          name: `Automation ${String(index + 1).padStart(3, '0')}`,
          enabled: true,
          created_at: '2026-10-01T00:00:00.000Z',
          updated_at: '2026-10-01T00:00:00.000Z',
        })),
      }));
      await page.goto('/automations/list');
      await waitForHarnessReady(page, mocks);
      const table = page.getByRole('table', { name: 'automations:bulk-list', exact: true });
      await expect(table).toBeVisible();
      await expect(table.locator('tbody tr')).toHaveCount(25);
      await expect(table.getByText('Automation 063', { exact: true })).toHaveCount(0);

      await table.getByRole('button', { name: /^name filter$/i }).click();
      const dialog = page.getByRole('dialog', { name: /^name filter$/i });
      await expect(dialog).toBeVisible();
      const values = dialog.getByRole('group', { name: 'Available values', exact: true });
      await expect(values.getByRole('checkbox')).toHaveCount(63);
      const finalValue = values.getByRole('checkbox', { name: 'Automation 063', exact: true });
      await expect(finalValue).toBeChecked();
      const selectAll = dialog.getByRole('checkbox', { name: 'Select all shown values', exact: true });
      await dialog.getByText('Select all shown values', { exact: true }).click();
      await expect(selectAll).not.toBeChecked();
      await values.getByText('Automation 063', { exact: true }).click();
      await expect(finalValue).toBeChecked();
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
      await expect(dialog.getByRole('textbox', { name: 'Search values', exact: true })).toBeInViewport();
      await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
      await expect(values.getByText('Automation 063', { exact: true })).toBeInViewport();
      await page.screenshot({ path: test.info().outputPath(`complete-filter-${width}-${theme}.png`) });
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();

      await expect(table.locator('tbody tr')).toHaveCount(1);
      await expect(table.locator('tbody td[data-column-key="name"]')).toHaveText('Automation 063');
      await expectNoHorizontalOverflow(page);
      await assertMockApiComplete(page, mocks);
    });
  }
}
