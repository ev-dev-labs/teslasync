import { expect, test } from '@playwright/test';
import type { NotificationLog } from '../src/api/types';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectNoHorizontalOverflow, monitorPage } from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic notification mutation fixtures');

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1024, 1440]) {
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
      const header = width < 768 ? 'Notification' : 'Severity';
      const trigger = table.getByRole('button', { name: `${header} filter`, exact: true });
      expect(await trigger.evaluate(element => element.closest('th') != null)).toBe(true);
      await trigger.click();
      const filterDialog = page.getByRole('dialog', { name: `${header} filter`, exact: true });
      await filterDialog.getByRole('button', { name: 'Warn', exact: true }).click();
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
