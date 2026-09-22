import { expect, test } from '@playwright/test';
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`day log header stays aligned at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/day-log');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/day-log?*', (route) => route.fulfill({
        json: {
          vehicle_id: 1, date: '2026-09-14', timezone: 'UTC',
          day_start: '2026-09-14T00:00:00Z', day_end: '2026-09-15T00:00:00Z',
          events: [], sources: [], total_events: 0, truncated: false,
          limit: 2000, offset: 0, layers: [],
          summary: {
            drive_count: 0, charge_count: 0, drive_duration_s: null,
            drive_distance_m: null, energy_added_wh: null, energy_used_wh: null,
          },
        },
      }));
      await page.goto('/day-log?date=2026-09-14');
      await waitForHarnessReady(page, mocks);
      const header = page.locator('[data-role="page-header"]');
      const date = header.getByTestId('daylog-date');
      await expect(date).toHaveValue('2026-09-14');
      await expect(header.locator('#daylog-timezone')).toBeVisible();
      await expect(header.locator('[data-role="page-actions"] #daylog-timezone')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      if (width === 1440) {
        const workspace = page.locator('[data-role="workspace-header"]');
        await expect(workspace.getByRole('combobox', { name: 'Select vehicle' })).toBeVisible();
        await workspace.screenshot({ path: testInfo.outputPath('workspace-header.png') });
        const controls = [
          header.locator('[data-action-group="metadata"]'),
          date,
          header.getByRole('button', { name: /copy link/i }),
        ];
        const centers = await Promise.all(controls.map(async (control) => {
          const box = await control.boundingBox();
          if (!box) throw new Error('Header control is not visible');
          return box.y + box.height / 2;
        }));
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
      }
      await header.screenshot({ path: testInfo.outputPath('day-log-header.png') });
      await header.getByTestId('daylog-prev').click();
      await expect(date).toHaveValue('2026-09-13');
    });
  }
}
