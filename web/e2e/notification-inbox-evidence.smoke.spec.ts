import { expect, test } from '@playwright/test';
import type { NotificationLog } from '../src/api/types';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectIntegratedGridFooter, expectNoHorizontalOverflow, monitorPage } from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic notification mutation fixtures');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    test(`notification evidence and archive actions remain usable at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(60_000);
      const path = '/notifications/inbox';
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, path);
      await page.addInitScript(() => {
        localStorage.setItem('teslasync.notifications.markOnOpen', 'false');
        localStorage.setItem('teslasync.notifications.markOnClick', 'false');
      });
      const mocks = await installApiMocks(page, 'populated', theme);
      const diagnostics = monitorPage(page);
      const inboxRequests: URLSearchParams[] = [];
      let events: NotificationLog[] = [{
        id: 901, channel_id: null, alert_id: null, title: 'Synthetic battery alert',
        message: 'Recorded notification message with no invented delivery timestamp.',
        status: 'triggered', severity: 'critical', event_type: 'alert.battery_low',
        error: '', created_at: '2026-08-26T15:15:00.000Z',
        sent_at: null, read_at: null, archived_at: null,
      }];
      await page.route('**/api/v1/notifications/logs?*', async route => {
        const params = new URL(route.request().url()).searchParams;
        inboxRequests.push(params);
        const severities = params.get('severity')?.split(',');
        const query = params.get('q')?.toLowerCase();
        const rows = events.filter(event =>
          (params.get('archived') !== 'true' || event.archived_at != null)
          && (params.get('archived') !== 'false' || event.archived_at == null)
          && (params.get('read') !== 'true' || event.read_at != null)
          && (params.get('read') !== 'false' || event.read_at == null)
          && (!severities || severities.includes(event.severity ?? ''))
          && (!query || `${event.title} ${event.message}`.toLowerCase().includes(query)));
        await fulfillApiFixture(route, mocks, {
          json: params.get('count_only') === 'true' ? { total: rows.length } : rows,
        });
      });
      const mutations: string[] = [];
      for (const operation of ['archive', 'unarchive']) {
        await page.route(`**/api/v1/notifications/${operation}`, async route => {
          expect(route.request().method()).toBe('POST');
          expect(route.request().postDataJSON()).toEqual({ ids: [901] });
          mutations.push(operation);
          events = events.map(event => ({
            ...event, archived_at: operation === 'archive' ? '2026-08-26T16:00:00Z' : null,
          }));
          await fulfillApiFixture(route, mocks, { json: { updated: 1 } });
        });
      }
      await page.goto(path);
      await waitForHarnessReady(page, mocks);
      const main = page.locator('main');
      const table = main.getByRole('table', { name: 'Inbox', exact: true });
      await expect(table).toBeVisible();
      await expect(table.getByRole('button', { name: 'Open notification: Synthetic battery alert' })).toBeVisible();
      await expectIntegratedGridFooter(table);
      const frame = table.locator('xpath=ancestor::*[@data-grid-frame][1]');
      const compact = width < 1280;
      const more = frame.getByRole('button', { name: 'More', exact: true });
      await expect(table.getByText('Critical', { exact: true }).filter({ visible: true })).toHaveCount(1);
      if (compact) {
        await expect(frame.getByRole('radio', { name: 'Compact', exact: true })).toHaveCount(0);
        await expect(table.getByText(events[0].message, { exact: true }).filter({ visible: true })).toBeVisible();
        const widths = await table.locator('tbody tr').first().locator('td').evaluateAll(cells =>
          cells.filter(cell => getComputedStyle(cell).display !== 'none').map(cell => cell.getBoundingClientRect().width));
        expect(widths).toHaveLength(3);
        expect(widths[0]).toBeLessThanOrEqual(50);
        expect(widths[1]).toBeLessThanOrEqual(70);
        expect(widths[2]).toBeGreaterThan(widths[0] + widths[1]);
        await more.click();
      }
      const controls = compact ? page.getByRole('dialog', { name: 'More', exact: true }) : frame;
      await expect(controls.getByRole('radio', { name: 'Compact', exact: true })).toBeVisible();
      await controls.getByRole('radio', { name: 'Comfortable', exact: true }).click();
      await expect(controls.getByRole('radio', { name: 'Comfortable', exact: true })).toBeChecked();
      const exportTrigger = controls.getByRole('button', { name: 'Export list', exact: true });
      await exportTrigger.click();
      const exportMenu = page.getByRole('menu', { name: 'Export list', exact: true });
      await expect(exportMenu.getByRole('menuitem', { name: 'Download as CSV', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(exportMenu.getByRole('menuitem', { name: 'Download as JSON', exact: true })).toBeFocused();
      await exportMenu.screenshot({ path: test.info().outputPath(`notification-export-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(exportMenu).toHaveCount(0);
      await expect(exportTrigger).toBeFocused();
      if (compact) await controls.screenshot({ path: test.info().outputPath(`notification-more-${width}-${theme}.png`) });
      const columnsTrigger = controls.getByRole('button', { name: 'Reorder or hide columns' });
      await columnsTrigger.click();
      const columnsDialog = page.getByRole('dialog', { name: 'Reorder or hide columns', exact: true });
      await expect(columnsDialog.getByRole('checkbox', { name: 'Show or hide Notification', exact: true })).toBeDisabled();
      const defaultColumnCount = await table.locator('th[data-column-key]').count();
      await columnsDialog.getByText('Select all', { exact: true }).click();
      await columnsDialog.getByText('Select all', { exact: true }).click();
      await expect(table.locator('th[data-column-key]')).toHaveCount(1);
      await columnsDialog.getByRole('button', { name: 'Reset', exact: true }).click();
      const resetConfirmation = page.getByRole('dialog', { name: 'Reset columns?', exact: true });
      await resetConfirmation.screenshot({ path: test.info().outputPath(`notification-reset-${width}-${theme}.png`) });
      await resetConfirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(table.locator('th[data-column-key]')).toHaveCount(1);
      const reset = columnsDialog.getByRole('button', { name: 'Reset', exact: true });
      await expect(reset).toBeFocused();
      await reset.press('Enter');
      await resetConfirmation.getByRole('button', { name: 'Reset', exact: true }).click();
      await expect(table.locator('th[data-column-key]')).toHaveCount(defaultColumnCount);
      await columnsDialog.screenshot({ path: test.info().outputPath(`notification-columns-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(columnsDialog).toHaveCount(0);
      await expect(columnsTrigger).toBeFocused();
      if (compact) {
        await page.keyboard.press('Escape');
        await expect(more).toBeFocused();
      }
      const search = frame.getByPlaceholder('Search messages…', { exact: true });
      await search.fill('Synthetic battery');
      await expect.poll(() => inboxRequests.some(params =>
        params.get('q') === 'Synthetic battery' && params.get('count_only') !== 'true'
        && Number(params.get('offset') ?? 0) === 0)).toBe(true);
      await search.fill('');
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull();
      const header = compact ? 'Notification' : 'Severity';
      const trigger = table.getByRole('button', { name: `${header} filter`, exact: true });
      expect(await trigger.evaluate(element => element.closest('th') != null)).toBe(true);
      await trigger.click();
      const filterDialog = page.getByRole('dialog', { name: `${header} filter`, exact: true });
      await filterDialog.getByRole('button', { name: 'Warn', exact: true }).click();
      await filterDialog.screenshot({ path: test.info().outputPath(`notification-filter-${width}-${theme}.png`) });
      await filterDialog.getByRole('button', { name: 'Done', exact: true }).click();
      await waitForHarnessReady(page, mocks);
      await expect.poll(() => inboxRequests.some(params =>
        params.get('severity') === 'warn' && params.get('count_only') !== 'true')).toBe(true);
      await expect(table.getByRole('button', { name: 'Open notification: Synthetic battery alert' })).toHaveCount(0);
      await expect(trigger).toBeVisible();
      await page.reload();
      await waitForHarnessReady(page, mocks);
      await trigger.click();
      const persistedFilter = page.getByRole('dialog', { name: `${header} filter`, exact: true });
      await expect(persistedFilter.getByRole('button', { name: 'Warn', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await persistedFilter.getByRole('button', { name: 'Clear', exact: true }).click();
      await persistedFilter.getByRole('button', { name: 'Done', exact: true }).click();
      await waitForHarnessReady(page, mocks);
      await expect(table.getByRole('button', { name: 'Open notification: Synthetic battery alert' })).toBeVisible();
      await table.scrollIntoViewIfNeeded();
      const contentBounds = await main.evaluate(element => ({
        left: element.scrollLeft, width: element.clientWidth, contentWidth: element.scrollWidth,
      }));
      expect(contentBounds.left).toBe(0);
      expect(contentBounds.contentWidth).toBeLessThanOrEqual(contentBounds.width + 1);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath(`notification-inbox-${width}-${theme}.png`), fullPage: true });
      await table.getByRole('button', { name: 'Open notification: Synthetic battery alert' }).click();
      const dialog = page.getByRole('dialog', { name: 'Synthetic battery alert', exact: true });
      await expect(dialog).toContainText(events[0].message);
      await expect(dialog).toContainText('alert.battery_low');
      await dialog.screenshot({ path: test.info().outputPath(`notification-inspection-${width}-${theme}.png`) });
      await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
      await expect.poll(() => mutations).toEqual(['archive']);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(table.getByRole('button', { name: 'Open notification: Synthetic battery alert' })).toHaveCount(0);
      await main.getByRole('link', { name: 'View archived', exact: true }).click();
      await waitForHarnessReady(page, mocks);
      await expect(page).toHaveURL(/\/notifications\/archived$/);
      await main.getByRole('button', { name: 'Open notification: Synthetic battery alert' }).click();
      const archivedDialog = page.getByRole('dialog', { name: 'Synthetic battery alert', exact: true });
      await archivedDialog.getByRole('button', { name: 'Restore', exact: true }).click();
      await expect.poll(() => mutations).toEqual(['archive', 'unarchive']);
      await page.keyboard.press('Escape');
      await expectNoHorizontalOverflow(page);
      expect(diagnostics.pageErrors).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`notification-evidence-${width}-${theme}.png`), fullPage: true });
      await assertMockApiComplete(page, mocks);
    });
  }
}
