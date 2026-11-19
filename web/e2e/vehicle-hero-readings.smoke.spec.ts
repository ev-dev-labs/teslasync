import { expect, test, type Page } from '@playwright/test';
import type { VehicleState } from '../src/api/types';
import {
  closeMockedPage, fulfillApiFixture, installApiMocks,
  retireMockedDocument, seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';
import { COMMANDS } from '../src/features/system/commands';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic vehicle-reading fixtures');

type ReadingCase = 'unknown' | 'zero' | 'regen';
type NullableState = { [K in keyof VehicleState]?: VehicleState[K] | null };

function fixture(reading: ReadingCase): NullableState {
  const unknown = reading === 'unknown';
  const zero = reading === 'zero';
  return {
    vehicle_id: 7, state: 'online', latitude: 37.4, longitude: -122.1,
    speed: 0, heading: null, is_charging: false, is_climate_on: false,
    battery_level: unknown ? null : zero ? 0 : 72,
    rated_range: unknown ? null : zero ? 0 : 400_000,
    ideal_range: unknown ? null : zero ? 0 : 420_000,
    odometer: unknown ? null : zero ? 0 : 12_345_678,
    inside_temp: unknown ? null : zero ? 0 : 21,
    outside_temp: unknown ? null : zero ? 0 : -8,
    power: unknown ? null : zero ? 0 : -4_200,
    is_locked: unknown ? null : !zero,
    sentry_mode: unknown ? null : !zero,
    charger_power: 0, charge_rate: 0, time_to_full_charge: 0,
    software_version: '2026.4.1',
  };
}

async function installDetailsFixtures(
  page: Page,
  mocks: Awaited<ReturnType<typeof installApiMocks>>,
) {
  for (const path of [
    '/motor/latest', '/tire-pressure/latest', '/vehicle-config/latest',
    '/vehicles/7/silence', '/charge-autopilot/decision',
  ]) {
    await page.route(`**/api/v1${path}*`, (route) => fulfillApiFixture(route, mocks, { json: null }));
  }
  await page.route('**/api/v1/vehicles/7/settings*', (route) =>
    fulfillApiFixture(route, mocks, { json: [] }));
}

async function openDashboardHero(page: Page, theme: 'light' | 'dark', reading: ReadingCase) {
  await seedBrowserState(page, theme, '/', { preserveDashboardState: true });
  await page.addInitScript(() => {
    localStorage.setItem('teslasync-active-dashboard', 'e2e');
    localStorage.setItem('teslasync-dashboards', JSON.stringify([{
      id: 'e2e', name: 'E2E', isDefault: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      widgets: [{ id: 'e2e-full-hero', widgetId: 'vehicle-hero' }],
      layouts: {},
    }]));
  });
  const mocks = await installApiMocks(page, 'populated', theme);
  await installDetailsFixtures(page, mocks);
  const state = fixture(reading);
  const envelope = {
    state, live: true, observed_at: new Date().toISOString(),
    freshness: 'fresh',
    verified_fields: Object.keys(state).filter((key) =>
      state[key as keyof NullableState] != null),
  };
  await page.route('**/api/v1/vehicles/7/state*', (route) => fulfillApiFixture(route, mocks, {
    json: envelope,
  }));
  await page.route('**/api/v1/vehicles/states*', (route) => fulfillApiFixture(route, mocks, {
    json: {
      now: envelope.observed_at, total: 1, limit: 250,
      vehicles: [{ vehicle_id: 7, outcome: 'resolved', ...envelope }],
    },
  }));
  await page.goto('/');
  await waitForHarnessReady(page, mocks);
  return mocks;
}

test('command center combines vehicle state and readiness without repeating connection status', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/commands');
      const mocks = await installApiMocks(page, 'populated', theme);
      const state = { ...fixture('regen'), state: 'charging', is_charging: true };
      await page.route('**/api/v1/vehicles/7/commands/latest*', (route) =>
        fulfillApiFixture(route, mocks, { json: [] }));
      await page.route('**/api/v1/vehicles/7/state*', (route) => fulfillApiFixture(route, mocks, {
        json: {
          state, live: true, observed_at: new Date().toISOString(),
          freshness: 'fresh', verified_fields: Object.keys(state),
        },
      }));
      await page.goto('/commands');
      await waitForHarnessReady(page, mocks);
      const hero = page.getByTestId('command-center-hero');
      const readiness = hero.getByRole('region', { name: 'Command readiness' });
      await expect(hero.getByRole('region', { name: 'Vehicle state' })).toBeVisible();
      await expect(readiness).toBeVisible();
      await expect(hero.getByText('Charging', { exact: true })).toHaveCount(1);
      await expect(readiness.getByText('Connection', { exact: true })).toHaveCount(0);
      for (const value of ['Ready', 'No motion reported', 'Current']) {
        await expect(readiness.getByText(value, { exact: true })).toBeVisible();
      }
      const feedback = hero.getByText('No command is currently running. Results will appear here.');
      await expect(feedback).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await hero.screenshot({ path: testInfo.outputPath(`commands-summary-${width}-${theme}.png`) });
      await feedback.scrollIntoViewIfNeeded();
      await expect(feedback).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`commands-summary-bottom-${width}-${theme}.png`) });
      for (const title of ['Vehicle state', 'Command readiness']) {
        const details = hero.getByRole('region', { name: title }).getByRole('button', { name: 'Review details' });
        await details.click();
        await expect(page.getByRole('dialog', { name: `${title} details` })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(details).toBeFocused();
      }
      await retireMockedDocument(page, mocks);
      await page.unrouteAll({ behavior: 'wait' });
    }
  }
});

test('control board keeps all registry homes expanded and readable at supported widths', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/commands');
      const mocks = await installApiMocks(page, 'populated', theme);
      await page.route('**/api/v1/vehicles/7/commands/latest*', route =>
        fulfillApiFixture(route, mocks, { json: [] }));
      await page.goto('/commands');
      await waitForHarnessReady(page, mocks);
      const board = page.getByTestId('command-workspace');
      const homes = board.locator('[data-command-id]');
      await expect(homes).toHaveCount(COMMANDS.length);
      expect(await homes.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-command-id')).sort()))
        .toEqual(COMMANDS.map(def => def.id).sort());
      await expect(board.locator('[data-command-card]')).toHaveCount(12);
      for (const id of ['access', 'climate', 'charging', 'openings', 'navigation', 'driving', 'care', 'media', 'charge-options', 'schedules', 'vehicle', 'security']) {
        const card = board.locator(`[data-command-card="${id}"]`);
        await card.scrollIntoViewIfNeeded();
        await expect(card).toBeVisible();
        const violations = await card.evaluate(root => Array.from(root.querySelectorAll<HTMLElement>('*')).flatMap(element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const problems: string[] = [];
          if (element.scrollWidth > element.clientWidth + 2 && element.clientWidth > 0
            && !['INPUT', 'SELECT', 'SVG', 'path'].includes(element.tagName)) problems.push(`clipped: ${element.tagName} ${element.textContent?.slice(0, 60)}`);
          if (['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2) problems.push(`nested scroll: ${element.tagName}`);
          if (['BUTTON', 'INPUT', 'SELECT'].includes(element.tagName) && (rect.height < 44 || rect.width < 44)) problems.push(`small target: ${element.getAttribute('aria-label') ?? element.textContent}`);
          return problems;
        }));
        expect(violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`controls-${width}-${theme}-${id}.png`) });
      }
      await board.getByRole('heading', { name: 'Control board' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`controls-${width}-${theme}-top.png`) });
      await expectNoHorizontalOverflow(page);
      await retireMockedDocument(page, mocks);
      await page.unrouteAll({ behavior: 'wait' });
    }
  }
});

test('control board sends only explicit intent and preserves confirmation and keyboard focus', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await seedBrowserState(page, 'light', '/commands');
  const mocks = await installApiMocks(page, 'populated', 'light');
  const requests: unknown[] = [];
  await page.route('**/api/v1/vehicles/7/commands/latest*', route =>
    fulfillApiFixture(route, mocks, { json: [] }));
  await page.route('**/api/v1/vehicles/7/command', route => {
    requests.push(route.request().postDataJSON());
    return fulfillApiFixture(route, mocks, { json: { success: true } });
  });
  await page.route('**/api/v1/signals/7/live*', route =>
    fulfillApiFixture(route, mocks, { json: { vehicle_id: 7, signals: {} } }));
  await page.goto('/commands');
  await waitForHarnessReady(page, mocks);
  const board = page.getByTestId('command-workspace');
  const home = (id: string) => board.locator(`[data-command-id="${id}"]`);
  const search = board.getByRole('searchbox', { name: 'Search commands' });
  await search.fill('flash_lights');
  await expect(home('flash_lights')).toHaveAttribute('data-command-match', 'true');
  await expect(board.locator('[data-command-card]')).toHaveCount(1);
  await board.getByRole('button', { name: 'Edit pins' }).click();
  await home('flash_lights').getByRole('button', { name: 'Pin Flash lights' }).click();
  await board.getByRole('button', { name: 'Edit pins' }).click();
  await board.getByRole('button', { name: 'Clear search' }).click();
  await board.getByRole('button', { name: 'Pinned only' }).click();
  await expect(home('flash_lights')).toHaveCount(1);
  await expect(home('navigation_request')).toHaveCount(0);
  await board.getByRole('button', { name: 'Pinned only' }).click();
  expect(requests).toEqual([]);
  await home('flash_lights').getByRole('button', { name: 'Flash lights', exact: true }).click();
  await expect.poll(() => requests).toEqual([{ command: 'flash_lights' }]);
  const limit = home('set_charge_limit');
  await limit.getByRole('textbox').fill('92');
  await limit.getByRole('slider').focus();
  await page.keyboard.press('ArrowLeft');
  expect(requests).toHaveLength(1);
  await limit.getByRole('button', { name: 'Apply' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ command: 'set_charge_limit', params: { percent: '91' } });

  const dangerous = home('erase_user_data').getByRole('button', { name: 'Erase data', exact: true });
  await dangerous.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Erase data' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Confirm/ })).toBeDisabled();
  await dialog.getByRole('textbox').fill('ERASE');
  await page.keyboard.press('Enter');
  expect(requests).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath('controls-confirmation-390-light.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(dangerous).toBeFocused();
  await expect(dangerous).toHaveCSS('outline-style', 'solid');
  expect(requests).toHaveLength(2);

  const amps = home('set_charging_amps').getByRole('button', { name: 'Set amps', exact: true });
  await amps.click();
  const ampDialog = page.getByRole('dialog', { name: 'Set amps' });
  await ampDialog.getByRole('textbox').fill('16');
  await expect(ampDialog.getByRole('button', { name: 'Send' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(amps).toBeFocused();
  expect(requests).toHaveLength(2);
  await closeMockedPage(page, mocks);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`vehicle streaming fields render at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/vehicles/7');
      const mocks = await installApiMocks(page, 'populated', theme);
      await installDetailsFixtures(page, mocks);
      const state = {
        ...fixture('regen'),
        accessory_rail: false,
        power_transfer_status: 'ChargeEnabled',
        automatic_emergency_braking_state: 'Unavailable',
        lifetime_dc_charge_energy_wh: 12500,
        rolling_resistance_coefficient: 0.006123456789,
        semi_vehicle_mass_kg: 36500.5,
      };
      const envelope = {
        state, live: true, observed_at: new Date().toISOString(),
        freshness: 'fresh', verified_fields: Object.keys(state),
      };
      await page.route('**/api/v1/vehicles/7/state*', (route) =>
        fulfillApiFixture(route, mocks, { json: envelope }));
      await page.route('**/api/v1/vehicles/states*', (route) => fulfillApiFixture(route, mocks, {
        json: {
          now: envelope.observed_at, total: 1, limit: 250,
          vehicles: [{ vehicle_id: 7, outcome: 'resolved', ...envelope }],
        },
      }));
      await page.goto('/vehicles/7');
      await waitForHarnessReady(page, mocks);
      const panel = page.locator('[data-vehicle-source="Live state"]');
      for (const label of [
        'Accessory rail', 'Power transfer status', 'AEB operating state',
        'Lifetime DC charge energy', 'Rolling resistance coefficient', 'Semi vehicle mass',
      ]) {
        await expect(panel.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(panel.getByText('ChargeEnabled', { exact: true })).toBeVisible();
      await expect(panel.getByText('Unavailable', { exact: true })).toBeVisible();
      await expect(panel.getByText(/12\.50?\s+kWh/)).toBeVisible();
      await expect(panel.getByText('0.00612', { exact: true })).toBeVisible();
      await expect(panel.getByText(/36,500\.50? kg/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await panel.screenshot({
        path: test.info().outputPath(`streaming-fields-${width}-${theme}.png`),
      });
      await closeMockedPage(page, mocks);
    });
  }
}

for (const reading of ['unknown', 'zero'] as const) {
  test(`dashboard battery accessibility preserves ${reading} readings`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const mocks = await openDashboardHero(page, 'dark', reading);
    const hero = page.locator('[data-widget-id="e2e-full-hero"]');
    if (reading === 'unknown') {
      await expect(hero.getByRole('meter', { name: 'Battery', exact: true })).toHaveCount(0);
      await expect(hero.getByRole('group', { name: 'Battery', exact: true }))
        .toHaveAccessibleDescription('Unknown');
    } else {
      await expect(hero.getByRole('meter', { name: 'Battery', exact: true }))
        .toHaveAttribute('aria-valuenow', '0');
    }
    await closeMockedPage(page, mocks);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1440, 2560]) {
    const readings: ReadingCase[] = width === 320 || width === 1440
      ? ['unknown', 'zero', 'regen'] : ['regen'];
    for (const reading of readings) {
      test(`full dashboard hero preserves ${reading} readings at ${width}px in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const mocks = await openDashboardHero(page, theme, reading);
        const hero = page.locator('[data-widget-id="e2e-full-hero"]');
        await expect(hero.getByRole('heading', { name: 'Aurora · Model Y Long Range', exact: true })).toBeVisible();
        if (reading === 'unknown') {
          await expect(hero.getByRole('meter')).toHaveCount(0);
          for (const label of ['Battery', 'Range', 'Inside', 'Outside']) {
            await expect(hero.getByRole('group', { name: label, exact: true }))
              .toHaveAccessibleDescription(/unknown/i);
          }
          await expect(hero.getByText('Unlocked', { exact: true })).toHaveCount(0);
          await expect(hero.getByText('Off', { exact: true })).toHaveCount(0);
        } else if (reading === 'zero') {
          await expect(hero.getByRole('meter')).toHaveCount(1);
          await expect(hero.getByRole('meter', { name: 'Battery', exact: true }))
            .toHaveAttribute('aria-valuenow', '0');
          for (const label of ['Range', 'Inside', 'Outside']) {
            const value = hero.getByRole('group', { name: label, exact: true });
            await expect(value).toContainText(label === 'Range' ? '0 km' : '0°C');
            await expect(value).not.toHaveAccessibleDescription(/unknown/i);
          }
          await expect(hero.getByText('Unlocked', { exact: true })).toBeVisible();
          await expect(hero.getByText('Off', { exact: true })).toBeVisible();
        } else {
          await expect(hero.getByRole('meter', { name: 'Battery', exact: true }))
            .toHaveAttribute('aria-valuenow', '72');
          await expect(hero.getByRole('group', { name: 'Range', exact: true })).toContainText('400 km');
          await expect(hero.getByRole('group', { name: 'Inside', exact: true })).toContainText('21°C');
          await expect(hero.getByRole('group', { name: 'Outside', exact: true })).toContainText('-8°C');
          await expect(hero.getByText(/-4\.20/)).toHaveCount(0);
        }
        await expect(hero.getByRole('link')).toHaveCount(1);
        for (const path of ['/commands', '/live', '/digital-twin']) {
          await expect(hero.locator(`a[href="${path}"]`)).toHaveCount(0);
        }
        for (const path of ['/vehicles/7']) {
          const action = hero.locator(`a[href="${path}"]`);
          await action.scrollIntoViewIfNeeded();
          await expect(action).toBeInViewport();
          const bounds = await action.boundingBox();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
        await expectNoHorizontalOverflow(page);
        await hero.screenshot({
          path: test.info().outputPath(`full-hero-${reading}-${width}-${theme}.png`),
        });
        await hero.getByRole('link', { name: /Details/ }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/vehicles\/7$/);
        await expect(page.getByRole('heading', { name: 'Aurora', exact: true })).toBeVisible();
        await closeMockedPage(page, mocks);
      });
    }
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    for (const reading of ['unknown', 'zero', 'regen'] as const) {
      test(`vehicle hero preserves ${reading} readings at ${width}px in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, '/quick-stats');
        const mocks = await installApiMocks(page, 'populated', theme);
        await installDetailsFixtures(page, mocks);
        const state = fixture(reading);
        await page.route('**/api/v1/analytics/fleet?days=30', (route) => fulfillApiFixture(route, mocks, {
          json: {
            total_vehicles: 1, total_drives: 5, total_charging_sessions: 2,
            total_distance_km: 140, total_energy_kwh: 24, total_cost: 4,
            avg_efficiency_wh_km: 170, vehicle_comparison: [],
          },
        }));
        await page.route('**/api/v1/vehicles/7/state*', (route) => fulfillApiFixture(route, mocks, {
          json: reading === 'unknown' ? {
            vehicle: { id: 7, state: 'online', software_version: '2026.4.1' },
            position: { latitude: 37.4, longitude: -122.1, speed: 0 },
            live: true, observed_at: new Date().toISOString(),
            freshness: 'fresh', verified_fields: ['state', 'latitude', 'longitude', 'speed'],
          } : {
            state, live: true, observed_at: new Date().toISOString(),
            freshness: 'fresh', verified_fields: Object.keys(state).filter((key) =>
              state[key as keyof NullableState] != null),
          },
        }));
        await page.goto('/quick-stats');
        await waitForHarnessReady(page, mocks);
        const hero = page.getByRole('group', { name: 'Aurora', exact: true });
        await expect(hero).toBeVisible();

        if (reading === 'unknown') {
          await expect(hero.getByRole('meter')).toHaveCount(0);
          for (const label of ['Battery', 'Range', 'Inside', 'Outside']) {
            await expect(hero.getByRole('group', { name: label, exact: true }))
              .toHaveAccessibleDescription(/unknown/i);
          }
          await expect(hero.getByText('Unlocked', { exact: true })).toHaveCount(0);
          await expect(hero.getByText('Off', { exact: true })).toHaveCount(0);
          await expect(hero.getByText('0.00', { exact: true })).toHaveCount(0);
        } else if (reading === 'zero') {
          await expect(hero.getByRole('meter')).toHaveCount(1);
          await expect(hero.getByRole('meter', { name: 'Battery', exact: true }))
            .toHaveAttribute('aria-valuenow', '0');
          await expect(hero.getByText('Unlocked', { exact: true })).toBeVisible();
          await expect(hero.getByText('Sentry Off', { exact: true })).toBeVisible();
          await expect(hero.getByRole('meter', { name: 'Battery', exact: true }).getByText('0.00', { exact: true })).toBeVisible();
          for (const label of ['Range', 'Inside', 'Outside']) {
            const value = hero.getByRole('group', { name: label, exact: true });
            await expect(value).toContainText(label === 'Range' ? '0km' : '0°C');
            await expect(value).not.toHaveAccessibleDescription(/unknown/i);
          }
        } else {
          await expect(hero.getByRole('meter', { name: 'Battery', exact: true }))
            .toHaveAttribute('aria-valuenow', '72');
          await expect(hero.getByRole('group', { name: 'Range', exact: true })).toContainText('400km');
          await expect(hero.getByRole('group', { name: 'Inside', exact: true })).toContainText('21°C');
          await expect(hero.getByRole('group', { name: 'Outside', exact: true })).toContainText('-8°C');
          await expect(hero.getByText('Power -4.20 kW', { exact: true })).toBeVisible();
        }

        await expect(hero.getByRole('link')).toHaveCount(1);
        for (const path of ['/vehicles/7/commands', '/vehicles/7/map']) {
          await expect(hero.locator(`a[href="${path}"]`)).toHaveCount(0);
        }
        for (const path of ['/vehicles/7']) {
          const action = hero.locator(`a[href="${path}"]`);
          await action.scrollIntoViewIfNeeded();
          await expect(action).toBeVisible();
          const bounds = await action.boundingBox();
          expect(bounds).not.toBeNull();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        }
        await expectNoHorizontalOverflow(page);
        await hero.screenshot({ path: test.info().outputPath(`vehicle-hero-${reading}-${width}-${theme}.png`) });
        await hero.getByRole('link', { name: /Details/ }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/vehicles\/7$/);
        await expect(page.getByRole('heading', { name: 'Aurora', exact: true })).toBeVisible();
        await closeMockedPage(page, mocks);
      });
    }
  }
}
