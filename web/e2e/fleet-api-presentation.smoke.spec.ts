import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function expectAligned(locators: Locator[]) {
  const boxes = await Promise.all(locators.map(locator => locator.boundingBox()));
  expect(boxes.every(box => box !== null)).toBe(true);
  const centers = boxes.map(box => box!.x + box!.width / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
}

async function expectStatusBarClear(page: Page) {
  const bar = page.locator('[data-role="status-bar"]');
  const main = page.getByRole('main');
  await expect(bar).toHaveCount(1);
  await expect(bar).toBeVisible();
  for (const fraction of [0, 0.5, 1]) {
    await main.evaluate((element, value) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * value;
    }, fraction);
    const geometry = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('[data-role="main-content"]')!;
      const bar = document.querySelector<HTMLElement>('[data-role="status-bar"]')!;
      return {
        mainBottom: main.getBoundingClientRect().bottom,
        barTop: bar.getBoundingClientRect().top,
        position: getComputedStyle(bar).position,
      };
    });
    expect(geometry.position).toBe('fixed');
    expect(geometry.mainBottom).toBeLessThanOrEqual(geometry.barTop + 1);
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1280, 1920, 2560]) {
    test(`fleet API shared controls stay aligned and functional at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
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
      await expect(page.getByRole('heading', { name: 'Fleet API settings' })).toBeVisible();
      await expect(page.getByText('1 of 6 endpoints allowed · 1 auto-polled')).toHaveCount(1);
      await expect(page.getByRole('searchbox', { name: 'Search API routes' })).toHaveCount(1);
      await expect(page.getByText('http://api.test.invalid:8080')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      const cards = await Promise.all([
        page.getByRole('heading', { name: 'Tesla API' }).locator('xpath=ancestor::*[@data-card][1]').boundingBox(),
        page.getByRole('heading', { name: 'Endpoint access' }).locator('xpath=ancestor::*[@data-card][1]').boundingBox(),
        page.getByRole('button', { name: 'Connection details', exact: true }).locator('..').boundingBox(),
      ]);
      expect(cards.every(box => box !== null)).toBe(true);
      expect(Math.max(...cards.map(box => box!.x)) - Math.min(...cards.map(box => box!.x))).toBeLessThanOrEqual(1);
      expect(Math.max(...cards.map(box => box!.x + box!.width)) - Math.min(...cards.map(box => box!.x + box!.width))).toBeLessThanOrEqual(1);

      if (settings.api_suspended) {
        await expect(page.getByText(/Suspended — live requests and commands are blocked/)).toBeVisible();
        await page.getByRole('button', { name: 'Resume API actions', exact: true }).click();
        await expect(page.getByText('Allowed', { exact: true })).toBeVisible();
        await expect(page.getByText(/Suspended — live requests/)).toHaveCount(0);
      }

      const accessHeader = page.getByRole('switch', { name: 'Allow all endpoints' });
      const autoHeader = page.getByRole('switch', { name: 'Auto-poll all eligible endpoints' });
      const accessGroup = page.getByRole('switch', { name: 'Allow all Vehicle data' });
      const autoGroup = page.getByRole('switch', { name: 'Auto-poll all eligible Vehicle data' });
      const accessRow = page.getByRole('switch', { name: 'Enable GET /api/1/vehicles', exact: true });
      const autoRow = page.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles', exact: true });
      await expect(autoHeader).toBeDisabled();
      await expect(autoGroup).toBeDisabled();
      await autoHeader.focus();
      await expect(autoHeader).toBeFocused();
      await expect(autoHeader).toHaveAccessibleDescription(/Turn on Tesla API Polling/);
      await expect(accessRow).toHaveCount(0);
      await page.getByRole('button', { name: 'Expand Vehicle data', exact: true }).click();
      await expect(accessRow).toBeVisible();
      await expect(autoRow).toBeDisabled();
      await expect(page.getByRole('switch', { name: /Auto-poll .*nearby_charging_sites/ })).toHaveCount(0);
      await expectAligned([accessHeader, accessGroup, accessRow]);
      await expectAligned([autoHeader, autoGroup, autoRow]);
      const mobileRow = page.locator('[data-mobile-table] [data-row-key="vehicles.list"]');
      if (width < 768) {
        await expect.poll(async () => (await mobileRow.boundingBox())?.height).toBeLessThanOrEqual(80);
      }
      await expectStatusBarClear(page);

      const copyPath = page.getByRole('button', { name: 'Copy /api/1/vehicles', exact: true });
      if (width < 768) {
        await page.locator('[data-mobile-table]').getByRole('button', { name: 'list', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'list' })).toBeVisible();
      } else {
        await copyPath.focus();
        await expect(copyPath).toHaveCSS('opacity', '1');
        await expectAligned([
          copyPath,
          page.getByRole('button', { name: `Copy ${catalog[1].path}`, exact: true }),
        ]);
      }
      await copyPath.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('/api/1/vehicles');
      if (width < 768) await page.getByRole('dialog', { name: 'list' }).getByRole('button', { name: 'Close', exact: true }).first().click();

      await accessRow.click();
      await expect.poll(() => config.fleet_endpoints['vehicles.list']).toBe(false);
      expect(config.auto_endpoints['vehicles.list']).toBe(false);
      await accessRow.click();
      await expect.poll(() => config.fleet_endpoints['vehicles.list']).toBe(true);
      await accessGroup.click();
      await expect.poll(() => config.fleet_endpoints['vehicle_data.charge_state']).toBe(true);
      expect(config.fleet_endpoints['command.door_lock']).toBe(false);
      const master = page.getByRole('switch', { name: 'Toggle Tesla API polling' });
      await master.click();
      await expect(autoGroup).toBeEnabled();
      await expect.poll(() => master.evaluate(button => {
        const track = button.firstElementChild as HTMLElement;
        const thumb = track.firstElementChild as HTMLElement;
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--theme-primary)';
        document.body.appendChild(probe);
        const result = {
          track: getComputedStyle(track).backgroundColor,
          accent: getComputedStyle(probe).backgroundColor,
          thumb: getComputedStyle(thumb).backgroundColor,
        };
        probe.remove();
        return result.track === result.accent && result.thumb === 'rgb(255, 255, 255)';
      })).toBe(true);
      await autoGroup.click();
      await expect.poll(() => config.auto_endpoints['vehicle_data.charge_state']).toBe(true);
      expect(config.auto_endpoints['vehicles.list']).toBe(true);
      await accessHeader.click();
      await expect.poll(() => config.fleet_endpoints['command.door_lock']).toBe(true);
      await autoHeader.click();
      await expect.poll(() => config.auto_endpoints['vehicles.list']).toBe(false);

      if (width < 768) await page.getByRole('main').getByRole('button', { name: 'More', exact: true }).click();
      if (width < 768) {
        const more = page.getByRole('dialog', { name: 'More', exact: true });
        await expect(page.locator('[data-mobile-table]').getByRole('button', { name: 'Method filter' })).toHaveCount(0);
        await expect(more.getByText('Method', { exact: true })).toBeVisible();
        await more.getByRole('button', { name: 'Method filter' }).click();
        const filter = page.getByRole('dialog', { name: 'Method filter' });
        const post = filter.getByRole('checkbox', { name: 'POST' });
        await post.focus();
        await post.press('Space');
        await expect(page.locator('[data-mobile-group="Vehicle commands"]')).toHaveCount(0);
        await filter.getByRole('button', { name: 'Clear', exact: true }).click();
        await expect(page.locator('[data-mobile-group="Vehicle commands"]')).toHaveCount(1);
        await filter.getByRole('button', { name: 'Done', exact: true }).click();
      }
      await expect(page.getByRole('button', { name: 'Export list' })).toHaveCount(1);
      if (width < 768) {
        await page.getByRole('radio', { name: 'Comfortable', exact: true }).click();
        await expect.poll(async () => (await mobileRow.boundingBox())?.height).toBeGreaterThanOrEqual(100);
      }
      await page.getByRole('radio', { name: 'Compact', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Compact', exact: true })).toBeChecked();
      if (width < 768) {
        await expect.poll(async () => (await mobileRow.boundingBox())?.height).toBeLessThanOrEqual(80);
      }
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
      const methodColumn = columns.getByRole('checkbox', { name: 'Show or hide Method' });
      await methodColumn.focus();
      await methodColumn.press('Space');
      await expect(methodColumn).not.toBeChecked();
      await methodColumn.press('Space');
      await expect(methodColumn).toBeChecked();
      await columns.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'View options', exact: true }).click();
      await page.getByRole('button', { name: 'HTTP method', exact: true }).click();
      await page.getByRole('combobox', { name: 'Sort routes by' }).selectOption('path');
      await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
      await page.getByRole('button', { name: 'View options', exact: true }).click();
      if (width < 768) await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Expand POST', exact: true })).toBeVisible();
      await page.getByRole('searchbox', { name: 'Search API routes' }).fill('door_lock');
      await expect(page.getByRole('switch', { name: 'Enable POST /api/1/vehicles/{vin}/command/door_lock' })).toBeVisible();
      await expect(page.getByRole('switch', { name: /Auto-poll .*door_lock/ })).toHaveCount(0);
      await expect(page.locator('[data-grid-frame]')).toHaveCount(1);
      await page.getByRole('button', { name: 'Connection details', exact: true }).click();
      await expect(page.getByText('http://api.test.invalid:8080', { exact: true })).toBeVisible();
      await assertMockApiComplete(page, mocks);
    });
  }
}

test('direct Fleet API loads follow the route rather than a saved navigation section', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBrowserState(page, 'light', '/fleet-api');
  await page.addInitScript(() => localStorage.setItem('teslasync-deck-view', JSON.stringify({ kind: 'section', title: 'Driving' })));
  const mocks = await installApiMocks(page, 'populated', 'light');
  await page.route('**/api/v1/settings/polling-config', request => fulfillApiFixture(request, mocks, { json: {
    auto_polling_enabled: false, fleet_endpoints: {}, auto_endpoints: {}, endpoint_catalog: catalog,
    telemetry_capture: false, telemetry_capture_retention_days: 7,
  } }));
  await page.goto('/fleet-api');
  await waitForHarnessReady(page, mocks);
  await expect(page.getByRole('searchbox', { name: 'Filter Account pages' })).toBeVisible();
  await page.reload();
  await waitForHarnessReady(page, mocks);
  await expect(page.getByRole('searchbox', { name: 'Filter Account pages' })).toBeVisible();
  await assertMockApiComplete(page, mocks);
});

test('another long page reserves the fixed status bar and hidden-bar preference reclaims its space', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 650 });
  await seedBrowserState(page, 'light', '/settings');
  const mocks = await installApiMocks(page, 'populated', 'light');
  await page.goto('/settings');
  await waitForHarnessReady(page, mocks);
  await expect.poll(() => page.getByRole('main').evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  await expectStatusBarClear(page);
  const visibleHeight = await page.getByRole('main').evaluate(element => element.clientHeight);
  await page.evaluate(() => localStorage.setItem('teslasync-status-bar-prefs', JSON.stringify({ enabled: false })));
  await page.reload();
  await waitForHarnessReady(page, mocks);
  await expect(page.locator('[data-role="status-bar"]')).toHaveCount(0);
  const hiddenHeight = await page.getByRole('main').evaluate(element => element.clientHeight);
  expect(hiddenHeight).toBeGreaterThan(visibleHeight);
  await assertMockApiComplete(page, mocks);
});
