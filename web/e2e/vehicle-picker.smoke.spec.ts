import { expect, test } from '@playwright/test';
import { fulfillApiMock, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`vehicle popup at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await seedBrowserState(page, theme, '/day-log');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/vehicles', async (route) => {
        await fulfillApiMock(route, mocks, { json: [
          { id: 7, vehicle_id: 7, display_name: 'Aurora', vin: 'MOCK-7', model: 'Model Y', state: 'online' },
          { id: 8, vehicle_id: 8, display_name: 'Roadster with a very long vehicle name for the family', vin: 'MOCK-8', model: 'Roadster', state: 'online' },
          { id: 9, vehicle_id: 9, display_name: 'Cybertruck', vin: 'MOCK-9', model: 'Cybertruck', state: 'online' },
        ] });
      });
      await page.route('**/api/v1/day-log?*', (route) => fulfillApiMock(route, mocks, {
        json: {
          vehicle_id: 7, date: '2026-09-14', timezone: 'UTC',
          day_start: '2026-09-14T00:00:00Z', day_end: '2026-09-15T00:00:00Z',
          events: [], sources: [], total_events: 0, truncated: false,
          limit: 2000, offset: 0, layers: [],
          summary: {
            drive_count: 0, charge_count: 0, drive_duration_s: null,
            drive_distance_m: null, energy_added_wh: null, energy_used_wh: null,
          },
        },
      }));
      await page.goto('/day-log');
      await waitForHarnessReady(page, mocks);
      if (width === 390) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      const picker = page.locator('[data-role="vehicle-picker-control"]:visible').getByRole('combobox');
      await picker.click();
      const popup = page.getByRole('listbox', { name: 'Select vehicle' });
      await expect(popup).toBeVisible();
      await expect(popup.getByRole('option', { selected: true })).toHaveText('Aurora');
      await expect(popup.getByRole('option', { selected: true }).locator('svg')).toBeVisible();
      await expect(popup).toHaveCSS('border-radius', '16px');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('vehicle-popup.png') });
      await picker.press('End');
      await expect(picker).toHaveAttribute('aria-activedescendant', await popup.getByRole('option', { name: 'Cybertruck', exact: true }).getAttribute('id') ?? '');
      await picker.press('Home');
      await picker.press('r');
      await picker.press('Enter');
      await expect(popup).toBeHidden();
      await expect(picker).toHaveValue('Roadster with a very long vehicle name for the family');
      await expect(picker).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('vehicle-long-name.png') });
      await picker.click();
      await picker.press('Escape');
      await expect(popup).toBeHidden();
      await expect(picker).toBeFocused();
      await picker.click();
      await popup.getByRole('option', { name: 'Cybertruck', exact: true }).click();
      await expect(picker).toHaveValue('Cybertruck');
      await expect(picker).toBeFocused();
      await picker.click();
      await picker.press('Home');
      await picker.press('Tab');
      await expect(popup).toBeHidden();
      await expect(picker).toHaveValue('Cybertruck');
    });
  }
}
