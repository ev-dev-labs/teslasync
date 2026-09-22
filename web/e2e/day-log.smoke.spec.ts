import { expect, test } from '@playwright/test';
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 390, 550, 1440]) {
    test(`day log header stays aligned at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/day-log');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/vehicles', (route) => route.fulfill({
        json: [{ id: 7, vehicle_id: 7, display_name: 'Aurora', model: 'Model Y',
          state: 'online', timezone: 'America/Argentina/Buenos_Aires' }],
      }));
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
      const navigation = header.getByTestId('daylog-date-navigation');
      const navBox = await navigation.boundingBox();
      expect(navBox).not.toBeNull();
      const dateControls = ['daylog-prev', 'daylog-date', 'daylog-next', 'daylog-today'];
      for (const id of dateControls) {
        const box = await header.getByTestId(id).boundingBox();
        expect(box).not.toBeNull();
        expect(Math.abs(box!.y - navBox!.y)).toBeLessThanOrEqual(2);
        expect(box!.x + box!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width + 1);
        expect(box!.height).toBeGreaterThanOrEqual(width < 640 ? 44 : 36);
      }
      const metadata = await header.locator('[data-action-group="metadata"]').boundingBox();
      const copy = await header.getByRole('button', { name: /copy link/i }).boundingBox();
      expect(Math.abs(metadata!.y + metadata!.height / 2 - copy!.y - copy!.height / 2)).toBeLessThanOrEqual(2);
      if (width < 640) {
        expect((await header.boundingBox())!.height).toBeLessThanOrEqual(265);
        expect(copy!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);
        expect(copy!.y - navBox!.y - navBox!.height).toBeLessThanOrEqual(8);
      }
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
      await page.screenshot({ path: testInfo.outputPath('day-log-page.png'), fullPage: true });
      await date.focus();
      await expect(date).toBeFocused();
      await header.screenshot({ path: testInfo.outputPath('day-log-date-focused.png') });
      if (width === 1440) {
        const picker = page.locator('[data-role="workspace-header"]').getByRole('combobox', { name: 'Select vehicle' });
        await picker.click();
        await expect(page.getByRole('listbox')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('day-log-vehicle-open.png') });
        await page.keyboard.press('Escape');
        await expect(picker).toBeFocused();
      }
      await header.getByTestId('daylog-prev').click();
      await expect(date).toHaveValue('2026-09-13');
      await header.getByTestId('daylog-next').click();
      await expect(date).toHaveValue('2026-09-14');
      await date.fill('2026-09-10');
      await expect(page).toHaveURL(/date=2026-09-10/);
      await header.getByTestId('daylog-today').click();
      await expect(date).toHaveValue(await date.getAttribute('max') ?? '');
      await header.getByRole('button', { name: /copy link/i }).click();
      await expect(header.getByRole('button', { name: /copy link/i })).toHaveText('Copied');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    });
  }
}
