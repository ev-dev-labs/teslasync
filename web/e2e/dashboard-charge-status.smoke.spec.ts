import { expect, test } from '@playwright/test';
import { join } from 'node:path';
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
    let fresh = true;
    let refreshGate: Promise<void> | null = null;
    let refreshPending = false;
    await page.route('**/api/v1/vehicles/7/state', async route => {
      if (refreshGate) {
        refreshPending = true;
        await refreshGate;
      }
      await fulfillApiFixture(route, mocks, {
      json: {
        state: {
          vehicle_id: 7, battery_level: 22, rated_range: 100_000,
          is_charging: charging, charge_limit_soc_pct: 85, charge_amps_a: charging ? 6 : 0,
          charger_power: charging ? 1 : 0, charge_rate: 5000, time_to_full_charge: 6,
        },
        live: true, freshness: fresh ? 'fresh' : 'stale',
        observed_at: new Date(Date.now() - (fresh ? 0 : 180_000)).toISOString(),
        verified_fields: ['is_charging', 'battery_level', 'charge_limit_soc_pct', 'charge_amps_a'],
      },
      });
    });
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
      const indicator = panel.getByRole('img', { name: 'Charging', exact: true });
      await expect(indicator).toBeVisible();
      await expect(indicator.locator('[data-charge-bolt]')).toBeVisible();
      await expect(indicator.locator('.widget-charge-current')).toHaveCSS('animation-name', 'widget-charge-travel');
      await expect(indicator.locator('.widget-charge-current')).toHaveCSS('stroke-width', '1px');
      expect(await indicator.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
      await expect(panel.getByText('Charge limit 85%', { exact: true })).toBeVisible();
      await expect(panel.getByText('Last reported', { exact: true })).toHaveCount(0);
      if (id.startsWith('charge-status') || id === 'charging-telemetry') {
        await expect(panel.getByText('Current', { exact: true })).toBeVisible();
        await expect(panel.getByText(id === 'charging-telemetry' ? '6' : '6.0', { exact: true })).toBeVisible();
      }
      expect(await panel.getByTestId('widget-body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
      expect.soft(await panel.getByTestId('widget-body').evaluate(body => body.scrollHeight - body.clientHeight), `${id} must fit all readings`).toBeLessThanOrEqual(1);
      await panel.screenshot({ path: testInfo.outputPath(`${id}-${width}-${theme}-charging.png`), animations: 'disabled' });
      if (id === 'battery-gauge' || id === 'charge-status') {
        await panel.screenshot({ path: join(process.cwd(), '..', 'docs', 'dashboard-charging', `${id}-${width}-${theme}.png`), animations: 'disabled' });
      }
    }

    const battery = page.locator('[data-widget-id="state-battery-gauge"] > .widget-panel');
    await positionCataloguePanel(battery);
    const indicator = battery.getByRole('img', { name: 'Charging', exact: true });
    const original = await indicator.elementHandle();
    const before = await indicator.boundingBox();
    const beforeLimit = await battery.getByText('Charge limit 85%', { exact: true }).boundingBox();
    const beforeStyle = await indicator.getAttribute('class');
    let releaseRefresh = () => {};
    refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
    try {
      await battery.getByRole('button', { name: /^Refresh data/ }).click();
      await expect.poll(() => refreshPending).toBe(true);
      await expect(indicator).toBeVisible();
      await expect(indicator.locator('.widget-charge-current')).toHaveCSS('animation-name', 'widget-charge-travel');
      expect(await original!.evaluate(node => node.isConnected)).toBe(true);
      fresh = false;
    } finally {
      refreshGate = null;
      releaseRefresh();
    }
    const retained = battery.getByRole('img', { name: 'Charging · Last reported', exact: true });
    await expect(retained).toBeVisible();
    await expect(retained.locator('[data-charge-bolt]')).toBeVisible();
    await expect(retained.locator('.widget-charge-current')).toHaveCount(0);
    expect(await retained.getAttribute('class')).toBe(beforeStyle);
    expect(await original!.evaluate(node => node.isConnected)).toBe(true);
    const after = await retained.boundingBox();
    const afterLimit = await battery.getByText('Charge limit 85%', { exact: true }).boundingBox();
    expect(after!.width).toBe(before!.width);
    expect(after!.height).toBe(before!.height);
    expect(afterLimit!.x - after!.x).toBeCloseTo(beforeLimit!.x - before!.x, 1);
    expect(afterLimit!.y - after!.y).toBeCloseTo(beforeLimit!.y - before!.y, 1);
    await battery.getByRole('button', { name: 'Charging · Last reported', exact: true }).focus();
    await expect(battery.getByRole('tooltip').filter({ hasText: 'Charging · Last reported' })).toHaveCSS('opacity', '1');
    fresh = true;
    await battery.getByRole('button', { name: /^Refresh data/ }).click();
    await expect(indicator).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(indicator.locator('.widget-charge-current')).toHaveCSS('animation-name', 'none');
    await expect(indicator.locator('[data-charge-bolt]')).toBeVisible();

    charging = false;
    await page.reload();
    await waitForHarnessReady(page, mocks);
    for (const id of ids) {
      const panel = page.locator(`[data-widget-id="state-${id}"] > .widget-panel`);
      await positionCataloguePanel(panel);
      await expect(panel.getByRole('img', { name: 'Not charging', exact: true })).toBeVisible();
      await expect(panel.getByText('Charge limit 85%', { exact: true })).toBeVisible();
      await expect(panel.getByText('Charging', { exact: true })).toHaveCount(0);
      await expect(panel.locator('.widget-cell-stream')).toHaveCount(0);
      await expect(panel.locator('[data-charge-bolt], .widget-charge-current')).toHaveCount(0);
      expect.soft(await panel.getByTestId('widget-body').evaluate(body => body.scrollHeight - body.clientHeight), `${id} must fit idle readings`).toBeLessThanOrEqual(1);
    }
  });
}
