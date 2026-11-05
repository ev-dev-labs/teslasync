import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks, mockAppSettings,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

const catalog = [
  { key: 'vehicles.list', method: 'GET', path: '/api/1/vehicles', category: 'Vehicle data', pollable: true },
  { key: 'vehicle_data.charge_state', method: 'GET', path: '/api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state', category: 'Vehicle data', pollable: true },
  { key: 'vehicles.nearby_charging_sites', method: 'GET', path: '/api/1/vehicles/{vin}/nearby_charging_sites', category: 'Vehicle data', pollable: false },
  { key: 'command.door_lock', method: 'POST', path: '/api/1/vehicles/{vin}/command/door_lock', category: 'Vehicle commands', pollable: false },
  { key: 'command.door_unlock', method: 'POST', path: '/api/1/vehicles/{vin}/command/door_unlock', category: 'Vehicle commands', pollable: false },
  { key: 'telemetry.subscribe', method: 'POST', path: '/api/1/vehicles/fleet_telemetry_config', category: 'Fleet telemetry', pollable: false },
];

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280, 1920, 2560]) {
    test(`fleet API presents one control surface at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await seedBrowserState(page, theme, '/fleet-api');
      const mocks = await installApiMocks(page, 'populated', theme);
      let config = {
        auto_polling_enabled: false,
        fleet_endpoints: Object.fromEntries(catalog.map(endpoint => [endpoint.key, endpoint.key === 'vehicles.list'])),
        auto_endpoints: { 'vehicles.list': true, 'vehicle_data.charge_state': false },
        endpoint_catalog: catalog,
        telemetry_capture: false, telemetry_capture_retention_days: 7,
      };
      const settings = { ...mockAppSettings, api_suspended: width >= 1920 };
      await page.route('**/api/v1/settings', request => fulfillApiFixture(request, mocks, { json: settings }));
      await page.route('**/api/v1/settings/suspend-api', async request => {
        const update = request.request().postDataJSON() as { suspended: boolean };
        settings.api_suspended = update.suspended;
        await fulfillApiFixture(request, mocks, { json: { api_suspended: settings.api_suspended } });
      });
      await page.route('**/api/v1/settings/polling-config', async request => {
        if (request.request().method() === 'PUT') {
          const update = request.request().postDataJSON() as Partial<typeof config>;
          config = { ...config, ...update, endpoint_catalog: catalog };
        }
        await fulfillApiFixture(request, mocks, { json: config });
      });
      await page.route('**/api/v1/system/version', request => fulfillApiFixture(request, mocks, {
        json: { chart_version: 'fixture', go_version: 'fixture', os: 'linux', arch: 'arm64', endpoints: {
          api: 'http://api.test.invalid:8080', web: 'https://web.test.invalid',
          oauth_callback: 'https://web.test.invalid/callback', tesla_api: 'https://fleet.test.invalid',
        } },
      }));
      await page.goto('/fleet-api');
      await waitForHarnessReady(page, mocks);
      await expect(page.getByRole('switch', { name: 'Toggle Tesla API polling' })).toBeVisible();
      const height = await page.getByRole('main').evaluate(node => node.scrollHeight + 180);
      await page.setViewportSize({ width, height: Math.max(1000, height) });
      await page.screenshot({
        path: join(process.cwd(), '..', 'docs', 'fleet-api', process.env.FLEET_API_CAPTURE_PHASE === 'before' ? 'before' : 'after', `${width}-${theme}.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width, height: 1000 });
      await expectNoHorizontalOverflow(page);
      await expect(page.getByText(/^Allow all /)).toHaveCount(0);
      const titleBox = await page.getByText('Tesla API polling', { exact: true }).boundingBox();
      const masterBox = await page.getByRole('switch', { name: 'Toggle Tesla API polling' }).boundingBox();
      expect(titleBox).not.toBeNull();
      expect(masterBox).not.toBeNull();
      expect(masterBox!.x - titleBox!.x - titleBox!.width).toBeLessThan(90);
      expect(Math.abs(masterBox!.y + masterBox!.height / 2 - titleBox!.y - titleBox!.height / 2)).toBeLessThan(4);
      const groupSwitches = await page.getByRole('switch', { name: /^Allow all / }).all();
      const groupCenters = await Promise.all(groupSwitches.map(async toggle => {
        const box = await toggle.boundingBox();
        return box!.x + box!.width / 2;
      }));
      expect(Math.max(...groupCenters) - Math.min(...groupCenters)).toBeLessThan(2);
      if (width >= 1280) {
        const accessHeader = await page.locator('th[data-column-key="access"]').boundingBox();
        const switches = await page.getByRole('switch', { name: /^Allow all / }).all();
        for (const toggle of switches) {
          const box = await toggle.boundingBox();
          expect(Math.abs(box!.x + box!.width / 2 - accessHeader!.x - accessHeader!.width / 2)).toBeLessThan(2);
        }
        await expect(page.locator('[data-row-group] td[data-column-key="auto"] [role="switch"]')).toHaveCount(0);
        const overflow = await page.locator('[data-grid-frame]').evaluate(node => {
          const table = node.querySelector('table')!;
          return table.getBoundingClientRect().width - node.getBoundingClientRect().width;
        });
        expect(overflow).toBeLessThanOrEqual(1);
      }
      if (settings.api_suspended) {
        const badge = await page.getByText('API suspended', { exact: true }).boundingBox();
        const resume = page.getByRole('button', { name: 'Resume API actions', exact: true });
        const resumeBox = await resume.boundingBox();
        expect(resumeBox!.x - badge!.x - badge!.width).toBeLessThanOrEqual(16);
        await resume.click();
        await expect(page.getByText('API allowed', { exact: true })).toBeVisible();
        await expect(page.getByText(/API actions were suspended previously/)).toHaveCount(0);
      }
      if (width < 768) await page.getByRole('main').getByRole('button', { name: 'More', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Export list' })).toHaveCount(1);
      await page.getByRole('radio', { name: 'Compact', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Compact', exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Export list' }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Download as JSON' }).click();
      const download = await downloading;
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();
      const exported = JSON.parse(await readFile(downloadPath!, 'utf8')) as Record<string, unknown>[];
      expect(exported).toHaveLength(catalog.length);
      expect(exported).toEqual(expect.arrayContaining(catalog.map(endpoint => expect.objectContaining({
        operation: endpoint.key, method: endpoint.method, path: endpoint.path,
      }))));
      await page.getByRole('button', { name: 'Reorder or hide columns' }).click();
      const columns = page.getByRole('dialog', { name: 'Reorder or hide columns' });
      const pathColumn = columns.getByRole('checkbox', { name: 'Show or hide API path' });
      await pathColumn.focus();
      await pathColumn.press('Space');
      await expect(pathColumn).not.toBeChecked();
      await columns.getByRole('button', { name: 'Done', exact: true }).click();
      if (width < 768) await page.keyboard.press('Escape');
      await expect(page.getByRole('table')).toHaveCount(1);
      await expect(page.getByRole('columnheader', { name: /^API path/ })).toHaveCount(0);
      await expect(page.getByText('http://api.test.invalid:8080')).toHaveCount(0);
      await expect(page.getByRole('switch', { name: 'Enable GET /api/1/vehicles', exact: true })).toHaveCount(0);
      const groupAccess = page.getByRole('switch', { name: 'Allow all Vehicle data' });
      await groupAccess.scrollIntoViewIfNeeded();
      await expect(groupAccess).toBeInViewport({ ratio: 1 });
      await page.getByRole('button', { name: 'Expand Vehicle data', exact: true }).click();
      await expect(page.getByRole('switch', { name: 'Enable GET /api/1/vehicles', exact: true })).toBeVisible();
      const auto = page.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles', exact: true });
      await expect(auto).toBeDisabled();
      await page.getByRole('switch', { name: 'Toggle Tesla API polling' }).click();
      await expect(auto).toBeEnabled();
      await page.getByRole('switch', { name: 'Allow all Vehicle data' }).click();
      await expect.poll(() => config.fleet_endpoints['vehicle_data.charge_state']).toBe(true);
      expect(config.fleet_endpoints['command.door_lock']).toBe(false);
      await page.getByRole('button', { name: 'View options', exact: true }).click();
      await page.getByRole('button', { name: 'HTTP method', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Expand POST', exact: true })).toBeVisible();
      await page.getByRole('combobox', { name: 'Sort routes by' }).selectOption('path');
      await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search API routes' }).fill('door_lock');
      await expect(page.getByRole('switch', { name: 'Enable POST /api/1/vehicles/{vin}/command/door_lock' })).toBeVisible();
      await expect(page.getByRole('switch', { name: /Auto-poll .*door_lock/ })).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(1);
      await page.getByRole('button', { name: 'Connection details', exact: true }).click();
      await expect(page.getByText('http://api.test.invalid:8080', { exact: true })).toBeVisible();
      await expect.poll(() => page.getByText('http://api.test.invalid:8080', { exact: true }).evaluate(element => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          if (Number(getComputedStyle(node).opacity) < 1) return false;
        }
        return true;
      })).toBe(true);
      await expect(page.getByText('Polling config saved', { exact: true })).toHaveCount(0);
      const expandedHeight = await page.getByRole('main').evaluate(node => node.scrollHeight + 180);
      await page.setViewportSize({ width, height: Math.max(1000, expandedHeight) });
      await page.getByRole('main').evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({
        path: join(process.cwd(), '..', 'docs', 'fleet-api', 'after', `${width}-${theme}-expanded.png`),
        fullPage: true,
      });
      await assertMockApiComplete(page, mocks);
    });
  }
}
