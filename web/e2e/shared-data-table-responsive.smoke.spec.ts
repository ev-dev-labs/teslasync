import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';
import { closeTableToolbarControls, openTableToolbarControls } from './tableToolbarControls';
test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic loaded-table evidence');

async function downloadAuditCsv(page: Page): Promise<string> {
  const controls = await openTableToolbarControls(page.locator('[data-grid-frame]'));
  await controls.getByRole('button', { name: 'Export list', exact: true }).click();
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download as CSV', exact: true }).click();
  const download = await pendingDownload;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const path = await download.path();
  if (!path) throw new Error('Audit CSV download has no local artifact');
  await closeTableToolbarControls(controls);
  return readFile(path, 'utf8');
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 550, 1440]) {
    for (const total of [13, 263]) {
      test(`pagination controls align at ${width}px with ${total} rows in ${theme}`, async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, '/notifications/audit');
        const mocks = await installApiMocks(page, 'populated', theme);
        await page.route('**/api/v1/system/audit*', (route) => fulfillApiFixture(route, mocks, {
          json: Array.from({ length: total }, (_, index) => ({
            id: index + 1,
            created_at: '2026-08-25T08:00:00.000Z',
            action: 'configuration.updated',
            resource: `pagination-resource-${index + 1}`,
            details: 'Synthetic pagination alignment evidence.',
          })),
        }));
        await page.goto('/notifications/audit');
        await waitForHarnessReady(page, mocks);
        const mobile = page.getByRole('group', { name: 'Recent activity', exact: true });
        if (await mobile.count()) {
          const rows = mobile.locator('[data-row-key]');
          const footer = mobile.locator('[data-app-part="pagination"]');
          await mobile.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
          await expect(rows).toHaveCount(Math.min(total, 50));
          await expect(footer).toContainText(`Showing ${Math.min(total, 50)} of ${total}`);
          await expect(page.getByRole('navigation', { name: 'Pagination', exact: true })).toHaveCount(0);
          if (total > 50) {
            const more = footer.getByRole('button', { name: 'Load 50 more', exact: true });
            const bounds = await more.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.height).toBeGreaterThanOrEqual(44);
            expect(bounds!.width).toBeGreaterThanOrEqual(44);
            await more.click();
            await expect(rows).toHaveCount(100);
            await expect(footer).toContainText('Showing 100 of 263');
            await mobile.getByRole('combobox', { name: 'Rows per page' }).selectOption('100');
            await expect(rows).toHaveCount(100);
            await footer.getByRole('button', { name: 'Load 100 more', exact: true }).click();
            await expect(rows).toHaveCount(200);
            await footer.getByRole('button', { name: 'Load 63 more', exact: true }).click();
            await expect(rows).toHaveCount(263);
            await expect(rows.last()).toHaveAttribute('data-row-key', '263');
            await expect(footer).toContainText('Showing 263 of 263');
          }
          await expect(footer.getByRole('button', { name: /^Load \d+ more$/ })).toHaveCount(0);
          const geometry = await footer.evaluate(node => {
            const box = node.getBoundingClientRect();
            return { left: box.left, right: box.right, overflow: node.scrollWidth - node.clientWidth };
          });
          expect(geometry.left).toBeGreaterThanOrEqual(0);
          expect(geometry.right).toBeLessThanOrEqual(width);
          expect(geometry.overflow).toBeLessThanOrEqual(1);
          await expectNoHorizontalOverflow(page);
          if (process.env.DESIGN_PACK_CHECK_ONLY !== '1') {
            await footer.screenshot({ path: test.info().outputPath(`pagination-${width}-${total}-${theme}.png`) });
          }
          await assertMockApiComplete(page, mocks);
          return;
        }
        const pagination = page.getByRole('navigation', { name: 'Pagination', exact: true });
        await expect(pagination).toBeVisible();
        await pagination.getByRole('combobox', { name: 'Rows per page' }).selectOption('50');
        await expect(pagination.locator('button[aria-current="page"]')).toHaveAttribute(
          'aria-label', `Page 1 of ${Math.ceil(total / 50)}`,
        );

        const assertAlignment = async () => {
          await pagination.scrollIntoViewIfNeeded();
          const buttons = [
            pagination.getByRole('button', { name: 'First page', exact: true, includeHidden: true }),
            pagination.getByRole('button', { name: 'Previous page', exact: true }),
            pagination.locator('button[aria-current="page"]'),
            pagination.getByRole('button', { name: 'Next page', exact: true }),
            pagination.getByRole('button', { name: 'Last page', exact: true, includeHidden: true }),
          ];
          const visible = [];
          for (const button of buttons) {
            if (await button.isVisible()) visible.push(button);
          }
          const nav = await pagination.boundingBox();
          expect(visible).toHaveLength(nav!.width < 240 ? 3 : 5);
          const bounds = await Promise.all(visible.map(button => button.boundingBox()));
          expect(bounds.every(Boolean)).toBe(true);
          const centers = bounds.map(box => box!.y + box!.height / 2);
          expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
          for (let index = 1; index < bounds.length; index++) {
            expect(bounds[index - 1]!.x + bounds[index - 1]!.width).toBeLessThanOrEqual(bounds[index]!.x);
          }
          for (const box of bounds) {
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);
            if (width < 640) {
              expect(box!.width).toBeGreaterThanOrEqual(44);
              expect(box!.height).toBeGreaterThanOrEqual(44);
            }
          }
          const field = await pagination.getByRole('textbox', { name: 'Go to page' }).boundingBox();
          const go = await pagination.getByRole('button', { name: 'Go', exact: true }).boundingBox();
          expect(Math.abs(field!.y - go!.y)).toBeLessThanOrEqual(1);
          expect(Math.abs(field!.height - go!.height)).toBeLessThanOrEqual(1);
          if (width < 640) {
            const label = await pagination.getByText('Go to page', { exact: true }).boundingBox();
            expect(Math.abs(label!.x - nav!.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(go!.x + go!.width - nav!.x - nav!.width)).toBeLessThanOrEqual(1);
          }
          await expectNoHorizontalOverflow(page);
        };

        await assertAlignment();
        if (total > 50) {
          await pagination.getByRole('button', { name: 'Next page', exact: true }).click();
          await expect(pagination.locator('button[aria-current="page"]')).toHaveAttribute('aria-label', 'Page 2 of 6');
          const field = pagination.getByRole('textbox', { name: 'Go to page' });
          await field.fill('4');
          await field.press('Enter');
          await expect(pagination.locator('button[aria-current="page"]')).toHaveAttribute('aria-label', 'Page 4 of 6');
          await expect(pagination.getByText('Showing 151–200 of 263', { exact: true })).toBeVisible();
          await assertAlignment();
          if (width >= 640) await expect(pagination.getByRole('button', { name: 'Page 6', exact: true })).toBeVisible();
          const last = pagination.getByRole('button', { name: 'Last page', exact: true, includeHidden: true });
          if (await last.isVisible()) await last.click();
          else {
            await field.fill('6');
            await field.press('Enter');
          }
          await expect(pagination.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
          await expect(last).toBeDisabled();
          const first = pagination.getByRole('button', { name: 'First page', exact: true, includeHidden: true });
          if (await first.isVisible()) await first.click();
          else {
            await field.fill('1');
            await field.press('Enter');
          }
        } else {
          for (const name of ['First page', 'Previous page', 'Next page', 'Last page']) {
            await expect(pagination.getByRole('button', { name, exact: true, includeHidden: true })).toBeDisabled();
          }
        }
        if (process.env.DESIGN_PACK_CHECK_ONLY !== '1') {
          await pagination.screenshot({ path: test.info().outputPath(`pagination-${width}-${total}-${theme}.png`) });
        }
        await assertMockApiComplete(page, mocks);
      });
    }
  }
}

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
      const mobile = page.getByRole('group', { name: 'Recent activity', exact: true });
      const mobileActive = await mobile.count() > 0;
      const table = mobileActive ? mobile : page.getByRole('table', { name: 'Recent activity', exact: true });
      await expect(table).toBeVisible();
      if (mobileActive) {
        await expect(table.locator('[data-row-key]')).toHaveCount(1);
        await table.getByRole('button', { name: 'configuration.updated', exact: true }).click();
        const details = page.getByRole('dialog', { name: 'Recent activity', exact: true });
        await expect(details).toContainText(`test-resource-${'identifier'.repeat(30)}`);
        await expect(details).toContainText('Synthetic audit entry for responsive table coverage.');
        expect(await details.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await details.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(table.locator('[data-app-part="pagination"]')).toContainText('Showing 1 of 1');
        await expect(page.getByRole('navigation', { name: 'Pagination', exact: true })).toHaveCount(0);
      } else {
        const details = table.locator('thead th[data-column-key="details"]');
        await expect(details).toHaveCount(1);
        await expect(details).toBeVisible();
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
        await expect(page.getByRole('navigation', { name: 'Pagination', exact: true })).toBeVisible();
      }
      const controls = await openTableToolbarControls(table.locator('xpath=ancestor::*[@data-grid-frame][1]'));
      const download = controls.getByRole('button', { name: 'Export list', exact: true });
      await expect(download).toBeVisible();
      const bounds = await download.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await closeTableToolbarControls(controls);
      await expectNoHorizontalOverflow(page);
      const csv = await downloadAuditCsv(page);
      expect(csv.trim().split(/\r?\n/)).toHaveLength(2);
      expect(csv).toContain('configuration.updated');
      expect(csv).toContain(`test-resource-${'identifier'.repeat(30)}`);
      if ((width === 320 || width === 1440) && process.env.DESIGN_PACK_CHECK_ONLY !== '1') {
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
    const table = page.getByRole('table', { name: 'Recent activity' });
    await expect(table).toBeVisible();
    expect(await table.locator('tbody tr').count()).toBeLessThan(63);
    await expect(table.getByRole('button', { name: / filter$/ })).toHaveCount(0);
    await expect(table.locator('tbody td[data-column-key="action"]').first()).toHaveText('configuration.updated');
    await expect(page.getByRole('button', { name: 'Export list', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pagination', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const csv = await downloadAuditCsv(page);
    expect(csv.trim().split(/\r?\n/)).toHaveLength(64);
    expect(csv).toContain('audit-resource-63');
    expect(csv).toContain('audit.reviewed');
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
      const table = page.getByRole('group', { name: 'automations:bulk-list', exact: true });
      await expect(table).toBeVisible();
      await expect(table.locator('[data-row-key]')).toHaveCount(25);
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
      if (process.env.DESIGN_PACK_CHECK_ONLY !== '1') {
        await page.screenshot({ path: test.info().outputPath(`complete-filter-${width}-${theme}.png`) });
      }
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();

      await expect(table.locator('[data-row-key]')).toHaveCount(1);
      await expect(table.locator('[data-card-label]')).toHaveText('Automation 063');
      await expectNoHorizontalOverflow(page);
      await assertMockApiComplete(page, mocks);
    });
  }
}
