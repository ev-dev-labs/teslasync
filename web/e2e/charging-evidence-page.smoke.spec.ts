import { expect, test } from '@playwright/test';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectIntegratedGridFooter, expectNoHorizontalOverflow } from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic charging evidence');
const route = '/charging?from=2026-08-01&to=2026-08-31&density=compact';
const session = {
  id: 201, vehicle_id: 7,
  started_at: '2026-08-25T08:00:00.000Z', ended_at: '2026-08-25T09:00:00.000Z',
  start_soc_pct: 0, end_soc_pct: 80, delta_soc_pct: 80,
  start_odometer_m: 100000, end_odometer_m: 100000,
  start_lat: null, start_lng: null, start_place: 'Synthetic home charger',
  total_energy_added_wh: 18000, peak_power_w: 22000, avg_power_w: 18000,
  cost_decimal: 0, cost_currency: 'USD', charger_type: 'AC', cable_type: 'Type 2',
  live: false,
};

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1440, 1920, 2560]) {
    test(`charging adopts responsive evidence at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await seedBrowserState(page, theme, route);
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/charging?*', (request) => fulfillApiFixture(request, mocks, {
        json: [
          session,
          { ...session, id: 202, started_at: '2026-08-24T08:00:00.000Z', ended_at: null, end_soc_pct: null, avg_power_w: null, peak_power_w: null, cost_decimal: null },
        ],
      }));
      await page.goto(route);
      await waitForHarnessReady(page, mocks);
      const copyLink = page.getByRole('button', { name: 'Copy link to this view', exact: true });
      await expect(copyLink).toBeVisible();
      expect((await copyLink.textContent())?.trim()).toBe('');
      await expect(copyLink.locator('svg')).toHaveCount(1);
      await expect(page.getByRole('tablist', { name: 'Filter charging sessions by collection' })).toHaveCount(0);
      const overviewBox = await page.getByTestId('charging-overview').boundingBox();
      const trendBox = await page.getByRole('region', { name: 'Charging over time', exact: true }).boundingBox();
      expect(overviewBox).not.toBeNull();
      expect(trendBox).not.toBeNull();
      expect(Math.abs(overviewBox!.width - trendBox!.width)).toBeLessThan(2);
      expect(Math.abs(overviewBox!.x - trendBox!.x)).toBeLessThan(2);
      expect(trendBox!.y).toBeGreaterThanOrEqual(overviewBox!.y + overviewBox!.height);
      const history = page.getByRole('region', { name: 'All charging sessions', exact: true });
      const insights = page.getByRole('region', { name: 'Charging insights', exact: true });
      await expect(history).toBeVisible();
      await expect(insights).toBeVisible();
      const order = await history.evaluate((node) => {
        const following = document.querySelector('[aria-label="Charging insights"]');
        return following != null && Boolean(node.compareDocumentPosition(following) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(order).toBe(true);
      const table = history.getByRole('table', { name: 'All charging sessions', exact: true });
      await history.scrollIntoViewIfNeeded();
      if (width >= 1024) {
        await expect(table).toBeVisible();
        await expectIntegratedGridFooter(table);
        await expect(table.locator('tbody tr')).toHaveCount(2);
        await expect(table.locator('tbody tr').first()).toBeInViewport();
        await expect(table.locator('tbody td[data-column-key="batteryStart"]').first()).toHaveText('0%');
        await expect(table.locator('tbody td[data-column-key="cost"]').first()).toHaveText('Free');
        await expect(table.locator('tbody td[data-column-key="cost"]').last()).toHaveText('—');
        await expect(table.locator('tbody td[data-column-key="power"]').last()).toHaveText('—');
        await expect(table.getByRole('button', { name: / filter$/ })).toHaveCount(9);
        await expect(history.getByText(/cover up to 500 loaded sessions/)).toBeVisible();
        const link = table.locator('a[href="/charging/201"]');
        await expect(link).toBeVisible();
        const scroll = table.locator('..');
        expect(await scroll.evaluate((node) => getComputedStyle(node).overflowX)).toMatch(/auto|scroll/);
        await history.getByRole('button', { name: 'Reorder or hide columns' }).click();
        const columnsMenu = page.getByTestId('datatable-column-menu');
        const selectAll = columnsMenu.getByRole('checkbox', { name: 'Select all', exact: true });
        await expect(columnsMenu.getByRole('checkbox').first()).toHaveAccessibleName('Select all');
        await expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
        await selectAll.locator('..').click();
        await expect(selectAll).toBeChecked();
        const lastColumn = columnsMenu.getByRole('checkbox').last();
        await lastColumn.locator('..').scrollIntoViewIfNeeded();
        await expect(lastColumn.locator('..')).toBeInViewport();
        if (width === 1440) await page.screenshot({ path: test.info().outputPath(`charging-columns-${theme}.png`) });
        await selectAll.locator('..').click();
        await expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
        await expect(table.locator('thead th[data-column-key]')).toHaveCount(1);
        await columnsMenu.getByRole('button', { name: 'Reset', exact: true }).click();
        await expect(table.getByRole('button', { name: / filter$/ })).toHaveCount(9);
        await history.getByRole('button', { name: 'Reorder or hide columns' }).click();
      } else {
        await expect(table).toHaveCount(0);
        await expect(history.locator('a[href="/charging/201"]').first()).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath(`charging-evidence-${width}-${theme}.png`), fullPage: true });
      const preview = history.getByRole('button', { name: 'Quick view charging session', exact: true }).first();
      const target = await preview.boundingBox();
      expect(target?.height).toBeGreaterThanOrEqual(44);
      expect(target?.width).toBeGreaterThanOrEqual(44);
      await preview.click();
      const drawer = page.getByRole('dialog').last();
      await expect(drawer).toBeVisible();
      await expect.poll(async () => {
        const bounds = await drawer.locator('[data-drawer-panel]').boundingBox();
        return bounds != null && bounds.x >= -1 && bounds.x + bounds.width <= width + 1;
      }).toBe(true);
      await expect(drawer.getByRole('button', { name: 'Open session details', exact: true })).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Vehicle', exact: true })).toHaveAttribute('href', '/vehicles/7');
      await expect(drawer.getByRole('link', { name: 'Drive history', exact: true })).toHaveAttribute('href', /\/drives\?/);
      await expectNoHorizontalOverflow(page);
      if (width === 320 || width === 1440) {
        await page.screenshot({ path: test.info().outputPath(`charging-preview-${width}-${theme}.png`) });
      }
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
      if (width >= 1024) {
        const filterButton = table.getByRole('button', { name: 'Cost filter', exact: true });
        await filterButton.click();
        const filter = page.getByRole('dialog', { name: 'Cost filter', exact: true });
        await expect(filter).toBeVisible();
        await expect(filter.getByRole('checkbox', { name: 'Free', exact: true })).toBeChecked();
        await expect(filter.getByRole('checkbox', { name: '(Not recorded)', exact: true })).toBeChecked();
        await filter.getByText('Free', { exact: true }).click();
        await expect(filter.getByRole('checkbox', { name: 'Free', exact: true })).not.toBeChecked();
        await filter.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(table.locator('tbody tr')).toHaveCount(1);
        await expect(table.locator('tbody td[data-column-key="cost"]')).toHaveText('—');
        await expect(filterButton).toHaveAttribute('aria-pressed', 'true');
        await page.reload();
        await waitForHarnessReady(page, mocks);
        await expect(table.locator('tbody tr')).toHaveCount(1);
        await filterButton.click();
        await filter.getByRole('button', { name: 'Clear', exact: true }).click();
        await filter.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(table.locator('tbody tr')).toHaveCount(2);
        if (width === 1440) {
          await filterButton.click();
          await page.screenshot({ path: test.info().outputPath(`charging-header-filter-${width}-${theme}.png`) });
          await filter.getByRole('button', { name: 'Done', exact: true }).click();
        }
      }
      await assertMockApiComplete(page, mocks);
    });
  }
}
