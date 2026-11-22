import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks, mockAppSettings,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';
import { createReviewPreference } from './widget-design-packs.mock';

const catalog = [
  { key: 'vehicles.list', method: 'GET', path: '/api/1/vehicles', category: 'Vehicle data', pollable: true },
  { key: 'vehicle_data.charge_state', method: 'GET', path: '/api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state', category: 'Vehicle data', pollable: true },
  { key: 'vehicles.nearby_charging_sites', method: 'GET', path: '/api/1/vehicles/{vin}/nearby_charging_sites', category: 'Vehicle data', pollable: false },
  { key: 'command.door_lock', method: 'POST', path: '/api/1/vehicles/{vin}/command/door_lock', category: 'Vehicle commands', pollable: false },
  { key: 'drivers.remove', method: 'DELETE', path: '/api/1/vehicles/{vin}/drivers', category: 'Vehicle access', pollable: false },
  { key: 'telemetry.subscribe', method: 'POST', path: '/api/1/vehicles/fleet_telemetry_config', category: 'Fleet telemetry', pollable: false },
  { key: 'energy.live_status', method: 'GET', path: '/api/1/energy_sites/{site_id}/live_status', category: 'Charging and energy', pollable: false },
];

async function expectStatusBarClear(page: Page) {
  const bar = page.locator('[data-role="status-bar"]');
  const main = page.getByRole('main');
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

async function openOverflowIfNeeded(page: Page) {
  const overflow = page.getByRole('dialog', { name: 'More', exact: true });
  if (await overflow.isVisible()) return overflow;
  const trigger = page.getByRole('main').getByRole('button', { name: 'More', exact: true });
  if (await trigger.isVisible()) {
    await trigger.click();
    return overflow;
  }
  return page.getByRole('main');
}

async function closeOverflowIfOpen(page: Page) {
  const overflow = page.getByRole('dialog', { name: 'More', exact: true });
  if (await overflow.isVisible()) await overflow.getByRole('button', { name: 'Close', exact: true }).click();
}

async function downloadScope(page: Page, scope: string) {
  const toolbar = await openOverflowIfNeeded(page);
  await toolbar.getByRole('button', { name: 'Export list' }).click();
  await page.getByRole('menuitemradio', { name: scope, exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download as JSON' }).click();
  const file = await (await downloading).path();
  if (!file) throw new Error('Expected a downloaded file');
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>[];
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 1280, 1920, 2560]) {
    test(`Fleet API grid and permission flow at ${width}px ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const density = width === 390 ? 'compact' : 'spacious';
      const pack = width < 640 ? 'material' : 'swiss';
      await seedBrowserState(page, theme, '/fleet-api', { density });
      const mocks = await installApiMocks(page, 'populated', theme, density);
      let config = {
        auto_polling_enabled: false,
        fleet_endpoints: Object.fromEntries(catalog.map(endpoint => [endpoint.key, endpoint.key === 'vehicles.list'])),
        auto_endpoints: { 'vehicles.list': true, 'vehicle_data.charge_state': false },
        smart_endpoints: {} as Record<string, boolean>,
        endpoint_catalog: catalog,
        telemetry_capture: false, telemetry_capture_retention_days: 7,
      };
      const settings = {
        ...mockAppSettings, mode: theme, ui_density: density, api_suspended: width >= 1920,
        theme: 'custom', custom_primary: '#9c6ade', custom_accent: '#c0842b',
        font_family: 'custom', font_custom_sans: 'Georgia', font_scale: 1.15,
      };
      await page.route('**/api/v1/settings', route => fulfillApiFixture(route, mocks, { json: settings }));
      await page.route('**/api/v1/settings/widget-design-pack', route => fulfillApiFixture(route, mocks, {
        json: { ...createReviewPreference(), pack_id: pack, app_wide: true },
      }));
      await page.route('**/api/v1/settings/suspend-api', async route => {
        const update = route.request().postDataJSON() as { suspended: boolean };
        settings.api_suspended = update.suspended;
        await fulfillApiFixture(route, mocks, { json: { api_suspended: settings.api_suspended } });
      });
      await page.route('**/api/v1/settings/polling-config', async route => {
        if (route.request().method() === 'PUT') {
          config = { ...config, ...route.request().postDataJSON() as Partial<typeof config>, endpoint_catalog: catalog };
        }
        await fulfillApiFixture(route, mocks, { json: config });
      });
      await page.route('**/api/v1/system/version', route => fulfillApiFixture(route, mocks, {
        json: { chart_version: 'fixture', go_version: 'fixture', os: 'linux', arch: 'arm64', endpoints: {
          api: 'http://api.test.invalid:8080', web: 'https://web.test.invalid',
          oauth_callback: 'https://web.test.invalid/callback', tesla_api: 'https://fleet.test.invalid',
        } },
      }));
      await page.goto('/fleet-api');
      await waitForHarnessReady(page, mocks);
      await expect(page.getByRole('heading', { name: 'Fleet API settings' })).toBeVisible();
      await expect(page.getByText('Access: 1 of 7')).toBeVisible();
      await expect(page.getByText('Auto-poll: 1 selected')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-app-design-pack', pack);
      await expect(page.locator('body')).toHaveAttribute('data-density', density);
      const grid = page.locator('[data-grid-frame]');
      await expect(grid).toHaveAttribute('data-grid-density', 'auto');
      await expect(grid).toHaveAttribute('data-app-design-owner', new RegExp(`pack-${pack}`));
      const preferences = await grid.evaluate(element => {
        const style = getComputedStyle(element);
        return {
          accent: style.getPropertyValue('--theme-accent').trim().toLowerCase(),
          font: style.getPropertyValue('--font-sans'),
          scale: style.getPropertyValue('--font-scale').trim(),
          mode: style.colorScheme,
        };
      });
      expect(preferences).toMatchObject({ accent: '#9c6ade', scale: '1.15', mode: theme });
      expect(preferences.font).toContain('Georgia');
      await expectNoHorizontalOverflow(page);
      await expectStatusBarClear(page);

      if (settings.api_suspended) {
        await expect(page.getByText('Suspended', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Resume API actions', exact: true }).click();
        await expect(page.getByText('Suspended', { exact: true })).toHaveCount(0);
      }

      const access = page.getByRole('switch', { name: 'Enable GET /api/1/vehicles', exact: true });
      const auto = page.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles', exact: true });
      const smart = page.getByRole('switch', { name: 'Smart Features: GET /api/1/vehicles', exact: true });
      await expect(access).toHaveCount(0);
      await page.getByRole('button', { name: 'Expand Vehicle data', exact: true }).click();
      await expect(auto).toBeChecked();
      await expect(auto).toBeEnabled();
      await expect(auto).toHaveAccessibleDescription(/You can still change this selection/);
      await expect(page.getByText('Auto-poll: Selected · paused', { exact: true })).toBeVisible();
      await expect(page.getByRole('switch', { name: /Auto-poll .*nearby_charging_sites/ })).toHaveCount(0);
      await auto.click();
      await expect(auto).not.toBeChecked();
      await auto.click();
      await expect(auto).toBeChecked();
      expect(config.auto_polling_enabled).toBe(false);
      await smart.click();
      await expect(smart).toBeChecked();
      await access.click();
      await expect(access).not.toBeChecked();
      expect(config.auto_endpoints['vehicles.list']).toBe(false);
      expect(config.smart_endpoints).toEqual({});
      await access.click();
      await expect(access).toBeChecked();
      await expect(smart).not.toBeChecked();

      const mobile = width < 640;
      if (mobile) {
        await expect(grid.locator('[data-mobile-table]')).toBeVisible();
        await expect(grid.getByRole('table')).toHaveCount(0);
        await grid.getByRole('button', { name: 'list', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'list', exact: true })).toBeVisible();
      } else {
        await expect(grid.getByRole('table')).toBeVisible();
      }
      await page.getByRole('button', { name: 'Copy /api/1/vehicles', exact: true }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('/api/1/vehicles');
      if (mobile) await page.getByRole('dialog', { name: 'list', exact: true }).getByRole('button', { name: 'Close', exact: true }).first().click();

      await page.getByRole('button', { name: 'Edit all Vehicle data routes' }).click();
      const review = page.getByRole('dialog', { name: 'Edit endpoint permissions' });
      await expect(review.getByRole('combobox', { name: 'Access' })).toHaveValue('keep');
      await expect(review.getByRole('combobox', { name: 'Auto-poll' })).toHaveValue('keep');
      await review.getByRole('combobox', { name: 'Access' }).selectOption('enable');
      await review.getByRole('combobox', { name: 'Smart Features' }).selectOption('enable');
      await review.getByRole('combobox', { name: 'Auto-poll' }).selectOption('enable');
      await review.getByRole('button', { name: 'Review changes' }).click();
      await expect(review.getByText('Routes without Auto-poll support: 1', { exact: true })).toBeVisible();
      await expect(review.getByRole('list', { name: 'Routes that will change' }).getByRole('listitem')).toHaveCount(3);
      expect(config.fleet_endpoints['vehicle_data.charge_state']).toBe(false);
      await review.getByRole('button', { name: 'Apply changes' }).click();
      await expect(review).toHaveCount(0);
      expect(config.auto_endpoints).toEqual({ 'vehicles.list': true, 'vehicle_data.charge_state': true });
      expect(config.fleet_endpoints['command.door_lock']).toBe(false);
      expect(config.auto_polling_enabled).toBe(false);

      await page.getByRole('button', { name: 'Command review', exact: true }).click();
      await expect(page.getByRole('switch', { name: /^Enable GET/ })).toHaveCount(0);
      await expect(page.getByRole('switch', { name: /^Enable DELETE/ })).toHaveCount(1);
      if (mobile) await grid.getByRole('button', { name: 'Select', exact: true }).click();
      await grid.getByRole('checkbox', { name: 'Select door lock' }).locator('..').click();
      await grid.getByRole('checkbox', { name: 'Select remove' }).locator('..').click();
      await page.getByRole('button', { name: 'Compare selected' }).click();
      const compare = page.getByRole('dialog', { name: 'Compare selected' });
      await expect(compare.getByText('DELETE', { exact: true })).toBeVisible();
      await expect(compare.getByRole('switch')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(compare).toHaveCount(0);

      const selected = await downloadScope(page, 'Selected (2)');
      expect(selected.map(row => row.method).sort()).toEqual(['DELETE', 'POST']);
      const matching = await downloadScope(page, 'Matching (3)');
      expect(matching).toHaveLength(3);
      const full = await downloadScope(page, 'Full catalog (7)');
      expect(full).toHaveLength(catalog.length);
      expect(full).toEqual(expect.arrayContaining(catalog.map(route => expect.objectContaining({
        operation: route.key, method: route.method, path: route.path, category: route.category,
      }))));

      const toolbar = await openOverflowIfNeeded(page);
      await toolbar.getByRole('button', { name: 'Reorder or hide columns' }).click();
      const columns = page.getByRole('dialog', { name: 'Reorder or hide columns' });
      await columns.getByRole('checkbox', { name: 'Show or hide API path' }).locator('..').click();
      await columns.getByRole('checkbox', { name: 'Show or hide Category' }).locator('..').click();
      await columns.getByRole('button', { name: 'Done', exact: true }).click();
      await closeOverflowIfOpen(page);
      if (width === 1280) {
        await expect(grid).toHaveAttribute('data-grid-pinned', 'true');
        const viewport = grid.locator('[data-grid-viewport]');
        const readIdentityX = () => viewport.locator('th[data-grid-identity]').evaluate(element => element.getBoundingClientRect().x);
        const before = await readIdentityX();
        expect(await viewport.evaluate(element => {
          element.scrollLeft = element.scrollWidth;
          return element.scrollLeft;
        })).toBeGreaterThan(0);
        expect(Math.abs(await readIdentityX() - before)).toBeLessThanOrEqual(2);
      }
      await expectNoHorizontalOverflow(page);

      const field = grid.getByRole('combobox', { name: 'Filter by column' });
      if (await field.isVisible()) {
        await field.selectOption('method');
        await grid.locator('[data-grid-tools]').getByRole('combobox', { name: 'Filter Method by value' }).selectOption({ label: 'DELETE' });
      } else {
        await grid.getByRole('button', { name: 'Filter & sort' }).click();
        const tools = page.getByRole('dialog', { name: 'Filter & sort' });
        await tools.getByRole('combobox', { name: 'Column' }).selectOption('method');
        await tools.getByRole('checkbox', { name: 'POST', exact: true }).locator('..').click();
        await tools.getByRole('button', { name: 'Done', exact: true }).click();
      }
      await expect(page.getByRole('switch', { name: /^Enable POST/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Compare selected' })).toHaveCount(0);
      if (width === 390 && theme === 'light') {
        const savedViews = page.getByRole('dialog', { name: 'Saved views', exact: true });
        const openSavedViews = async () => {
          const actions = await openOverflowIfNeeded(page);
          await actions.getByRole('button', { name: 'Saved views', exact: true }).click();
        };
        await openSavedViews();
        await savedViews.getByRole('textbox', { name: 'View name' }).fill('Driver removals');
        await savedViews.getByRole('button', { name: 'Save current view' }).click();
        await expect(savedViews.getByRole('button', { name: 'Driver removals', exact: true })).toBeVisible();
        await savedViews.getByRole('button', { name: 'Close', exact: true }).click();
        await closeOverflowIfOpen(page);
        await page.getByRole('button', { name: 'Clear Method filter' }).click();
        await expect(page.getByRole('switch', { name: /^Enable POST/ })).toHaveCount(2);
        await openSavedViews();
        await savedViews.getByRole('button', { name: 'Driver removals', exact: true }).click();
        await expect(savedViews).toHaveCount(0);
        await closeOverflowIfOpen(page);
        await expect(page.getByRole('switch', { name: /^Enable POST/ })).toHaveCount(0);
      }
      await page.getByRole('button', { name: 'Clear Method filter' }).click();
      await expect(page.getByRole('switch', { name: /^Enable POST/ })).toHaveCount(2);
      await page.getByRole('button', { name: 'Show Solar charging routes', exact: true }).click();
      await expect(page.getByRole('switch', { name: /^Enable GET .*live_status/ })).toHaveCount(1);
      await expect(page.getByRole('switch', { name: /^Enable DELETE/ })).toHaveCount(0);

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
  await page.route('**/api/v1/settings/polling-config', route => fulfillApiFixture(route, mocks, { json: {
    auto_polling_enabled: false, fleet_endpoints: {}, auto_endpoints: {}, endpoint_catalog: catalog,
    telemetry_capture: false, telemetry_capture_retention_days: 7,
  } }));
  await page.goto('/fleet-api');
  await waitForHarnessReady(page, mocks);
  await expect(page.getByRole('searchbox', { name: 'Filter Account pages' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Smart Features' })).toHaveCount(0);
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
