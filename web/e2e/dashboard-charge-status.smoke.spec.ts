import { expect, test } from '@playwright/test';
import { prepareCatalogueState } from './dashboardCatalogueStateHarness';
import { positionCataloguePanel } from './dashboardCatalogueCapture';
import { fulfillApiFixture, waitForHarnessReady } from './mockApi';

const ids = ['battery-gauge', 'battery-radial-gauge', 'charge-status', 'charge-status-live', 'charging-telemetry'];

for (const theme of ['light', 'dark'] as const) for (const width of [375, 1440]) {
  test(`charge target, current and status at ${width}px ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const mocks = await prepareCatalogueState(page, ids, width, theme);
    await page.addInitScript(() => localStorage.setItem('teslasync-row-height-version', '2'));
    let charging = true;
    await page.route('**/api/v1/vehicles/7/state', route => fulfillApiFixture(route, mocks, {
      json: {
        state: {
          vehicle_id: 7, battery_level: 22, rated_range: 100_000,
          is_charging: charging, charge_limit_soc_pct: 85, charge_amps_a: charging ? 6 : 0,
          charger_power: charging ? 1 : 0, charge_rate: 5000, time_to_full_charge: 6,
        },
        live: true, freshness: 'fresh', observed_at: new Date().toISOString(),
        verified_fields: ['is_charging', 'battery_level', 'charge_limit_soc_pct', 'charge_amps_a'],
      },
    }));
    await page.route('**/api/v1/charging-telemetry/latest?*', route => fulfillApiFixture(route, mocks, {
      json: {
        charging_state: charging ? 'Charging' : 'Disconnected', ts: new Date().toISOString(),
        charger_actual_current: charging ? 6 : 0, charger_voltage: 112, charger_power_w: charging ? 1000 : 0,
        charge_limit_soc_pct: 85, battery_level: 22, charge_energy_added_wh: 1000,
      },
    }));
    await page.goto('/');
    await waitForHarnessReady(page, mocks);
    for (const id of ids) {
      const panel = page.locator(`[data-widget-id="state-${id}"] > .widget-panel`);
      await positionCataloguePanel(panel);
      await expect(panel.getByText('Charging', { exact: true })).toBeVisible();
      await expect(panel.getByText('Charge limit 85%', { exact: true })).toBeVisible();
      await expect(panel.getByText('Last reported', { exact: true })).toHaveCount(0);
      if (id.startsWith('charge-status') || id === 'charging-telemetry') {
        await expect(panel.getByText('Current', { exact: true })).toBeVisible();
        await expect(panel.getByText(id === 'charging-telemetry' ? '6' : '6.0', { exact: true })).toBeVisible();
      }
      expect(await panel.getByTestId('widget-body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
      expect.soft(await panel.getByTestId('widget-body').evaluate(body => body.scrollHeight - body.clientHeight), `${id} must fit all readings`).toBeLessThanOrEqual(1);
      await panel.screenshot({ path: testInfo.outputPath(`${id}-${width}-${theme}-charging.png`), animations: 'disabled' });
    }

    charging = false;
    await page.reload();
    await waitForHarnessReady(page, mocks);
    for (const id of ids) {
      const panel = page.locator(`[data-widget-id="state-${id}"] > .widget-panel`);
      await positionCataloguePanel(panel);
      await expect(panel.getByText('Not charging', { exact: true })).toBeVisible();
      await expect(panel.getByText('Charge limit 85%', { exact: true })).toBeVisible();
      await expect(panel.getByText('Charging', { exact: true })).toHaveCount(0);
      await expect(panel.locator('.widget-cell-stream')).toHaveCount(0);
      expect.soft(await panel.getByTestId('widget-body').evaluate(body => body.scrollHeight - body.clientHeight), `${id} must fit idle readings`).toBeLessThanOrEqual(1);
    }
  });
}
