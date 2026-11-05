import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import type { NotificationLog } from '../src/api/types';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, mockVehicle, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow, monitorPage } from './qualityAssertions';
import { openTableToolbarControls } from './tableToolbarControls';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test(`notification identity and full evidence at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await seedBrowserState(page, theme, '/notifications/inbox');
      await page.addInitScript(() => {
        localStorage.setItem('teslasync.notifications.markOnOpen', 'false');
        localStorage.setItem('teslasync.notifications.markOnClick', 'false');
      });
      const mocks = await installApiMocks(page, 'populated', theme);
      const diagnostics = monitorPage(page);
      const rows: NotificationLog[] = [901, 900].map(id => ({
        id, channel_id: null, alert_id: null, vehicle_id: mockVehicle.id,
        title: id === 901 ? 'Turn signal changed' : 'Media station changed',
        message: id === 901 ? 'Turn signal changed to Off.' : 'Media station changed. Notification details are unavailable.',
        status: 'triggered', severity: 'info', event_type: 'alert.rule',
        error: '', created_at: '2026-10-28T15:00:00Z', sent_at: null, read_at: null, archived_at: null,
        group_key: 'polish-evidence',
      }));
      await page.route('**/api/v1/notifications/logs?*', async route => {
        const params = new URL(route.request().url()).searchParams;
        const json = params.get('count_only') === 'true' ? { total: rows.length }
          : params.get('grouped') === 'true' ? [{
            group_key: 'polish-evidence', count: 2, unread_count: 2, vehicle_ids: [mockVehicle.id], latest: rows[0],
          }] : rows;
        await fulfillApiFixture(route, mocks, { json });
      });
      await page.goto('/notifications/inbox');
      await waitForHarnessReady(page, mocks);
      const main = page.locator('main');
      const capture = async (state: string) => {
        await expectNoHorizontalOverflow(page);
        await main.locator('[data-tour="alerts-list"]').evaluate(element => {
          const scroller = element.closest('main')!;
          scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
        });
        await page.screenshot({ path: join(process.cwd(), '..', 'docs', 'notification-inbox', `${state}-${width}-${theme}.png`), fullPage: true });
      };
      await expect(main.getByText('Turn signal changed', { exact: true }).first()).toBeVisible();
      await expect(main.getByText(mockVehicle.display_name, { exact: true }).first()).toBeVisible();
      await expect(main.getByText('alert.rule', { exact: true })).toHaveCount(0);
      await capture('flat');
      if (width === 390) {
        await main.locator('[data-mobile-table]').getByRole('button', { name: 'Expand row', exact: true }).first().click();
      } else {
        const table = main.getByRole('table', { name: 'Inbox', exact: true });
        await expect(table.locator('th[data-column-key]')).toHaveCount(7);
        await table.getByRole('button', { name: 'Expand row: Turn signal changed' }).click();
      }
      const details = main.getByRole('region', { name: 'Notification details' });
      await expect(details).toContainText('Turn signal changed to Off.');
      await expect(details).toContainText(mockVehicle.display_name);
      await expect(details).toContainText('Alert rule');
      await expect(details.getByText('Info', { exact: true })).toBeVisible();
      for (const missing of ['Sent', 'Delivery error', 'Delivery latency', 'Scheduled']) {
        await expect(details.getByText(missing, { exact: true })).toHaveCount(0);
      }
      await capture('expanded');
      const controls = await openTableToolbarControls(main.locator('[data-grid-frame]').first());
      await controls.getByRole('button', { name: 'Grouped', exact: true }).click();
      await expect(main.getByRole('button', { name: 'Open notification: Turn signal changed' })).toBeVisible();
      await expect(main.getByText('alert.rule', { exact: true })).toHaveCount(0);
      await capture('grouped');
      await main.getByTestId('group-expand-toggle').click();
      await expect(main.getByTestId('group-members-region')).toContainText(rows[1].message);
      await expect(main.getByTestId('group-members-region')).toContainText(mockVehicle.display_name);
      await capture('grouped-expanded');
      expect(diagnostics.pageErrors).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });
  }
}
