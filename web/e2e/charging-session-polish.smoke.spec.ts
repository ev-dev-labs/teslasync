import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi';
import { expectNoHorizontalOverflow, monitorPage } from './qualityAssertions';

const routePath = '/charging?from=2026-10-25&to=2026-11-06';
const baseSession = {
  id: 301, vehicle_id: 7,
  started_at: '2026-10-25T21:59:00Z', ended_at: '2026-10-25T22:19:00Z',
  start_soc_pct: 20, end_soc_pct: 65, delta_soc_pct: 45,
  start_odometer_m: null, end_odometer_m: null,
  start_lat: null, start_lng: null, start_place: 'Bothell Supercharger',
  total_energy_added_wh: 25780, peak_power_w: 150000, avg_power_w: 78720,
  cost_decimal: 12.89, cost_currency: 'USD', cost_source: 'tesla_actual',
  charger_type: 'Supercharger', cable_type: null, live: false, is_home: false,
};

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280]) {
    test(`charging identity costs and live completion at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await seedBrowserState(page, theme, routePath);
      const mocks = await installApiMocks(page, 'populated', theme);
      const diagnostics = monitorPage(page);
      let completed = false;
      const home = {
        ...baseSession, id: 302, started_at: '2026-11-01T18:00:00Z', ended_at: '2026-11-01T20:00:00Z',
        start_place: 'Saved home', charger_type: 'AC', is_home: true,
        peak_power_w: 11000, avg_power_w: 10000, total_energy_added_wh: 20000,
        cost_decimal: 6, cost_source: 'default_estimate',
      };
      await page.route('**/api/v1/charging?*', request => fulfillApiFixture(request, mocks, {
        json: [{
          ...home, id: 303, start_place: 'Live home session', started_at: '2026-11-04T18:44:00Z',
          ended_at: completed ? '2026-11-04T19:24:00Z' : null,
          live: !completed, duration_s: completed ? 2400 : 1200,
          current_power_w: completed ? null : 9000, total_energy_added_wh: completed ? 6000 : 3000,
          end_soc_pct: completed ? 60 : 50, cost_decimal: completed ? 1.8 : 0.9,
        }, home, baseSession, {
          ...baseSession, id: 304, start_place: 'Unidentified charger',
          charger_type: null, peak_power_w: null, avg_power_w: null,
          total_energy_added_wh: null,
          cost_decimal: null, cost_source: null,
        }],
      }));
      await page.goto(routePath);
      await waitForHarnessReady(page, mocks);
      const history = page.getByRole('region', { name: 'All charging sessions', exact: true });
      await history.scrollIntoViewIfNeeded();
      await expect(history.getByText('Charging', { exact: true })).toBeVisible();
      await expect(history.getByText('Supercharger', { exact: true }).first()).toBeVisible();
      await expect(history.getByText('Home / AC', { exact: true }).first()).toBeVisible();
      await expect(history.getByText('Unknown', { exact: true }).first()).toBeVisible();
      await expect(history.getByText(/estimated/).first()).toBeVisible();
      if (width >= 1024) {
        const table = history.getByRole('table', { name: 'All charging sessions', exact: true });
        const liveRow = table.locator('tbody tr').filter({ hasText: 'Live home session' });
        await expect(liveRow.locator('[data-column-key="duration"]')).toContainText('20m');
        await expect(liveRow.locator('[data-column-key="power"]')).toContainText(/9.*kW/);
        await expect(liveRow.locator('[data-column-key="batteryEnd"]')).toHaveText('50%');
        const unknown = table.locator('tbody tr').filter({ hasText: 'Unidentified charger' });
        await expect(unknown.locator('[data-column-key="cost"]')).toHaveText('—');
      } else {
        await expect(history.getByText(/kW now/)).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: join(process.cwd(), '..', 'docs', 'charging-sessions', `${width}-${theme}.png`), fullPage: true });
      completed = true;
      await expect(history.getByText('Charging', { exact: true })).toHaveCount(0, { timeout: 30000 });
      await expect(history.getByText('40m', { exact: true }).first()).toBeVisible();
      expect(diagnostics.pageErrors).toEqual([]);
      await assertMockApiComplete(page, mocks);
    });
  }
}
