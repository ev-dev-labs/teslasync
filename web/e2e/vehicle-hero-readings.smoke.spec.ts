import { expect, test } from '@playwright/test';
import type { VehicleState } from '../src/api/types';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks,
  seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectNoHorizontalOverflow } from './qualityAssertions';

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

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1440, 2560]) {
    const readings: ReadingCase[] = width === 320 || width === 1440
      ? ['unknown', 'zero', 'regen'] : ['regen'];
    for (const reading of readings) {
      test(`full dashboard hero preserves ${reading} readings at ${width}px in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, '/');
        await page.addInitScript(() => {
          localStorage.setItem('teslasync-dashboards', JSON.stringify([{
            id: 'e2e', name: 'E2E', isDefault: true,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
            widgets: [{ id: 'e2e-full-hero', widgetId: 'vehicle-hero' }],
            layouts: {},
          }]));
        });
        const mocks = await installApiMocks(page, 'populated', theme);
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
        const hero = page.locator('[data-widget-id="e2e-full-hero"]');
        await expect(hero.getByRole('heading', { name: 'Aurora', exact: true })).toBeVisible();
        if (reading === 'unknown') {
          await expect(hero.getByRole('meter')).toHaveCount(0);
          for (const label of ['Battery', 'Range', 'Inside', 'Outside']) {
            await expect(hero.getByRole('group', { name: label, exact: true }))
              .toHaveAccessibleDescription(/unknown/i);
          }
          await expect(hero.getByText('Unlocked', { exact: true })).toHaveCount(0);
          await expect(hero.getByText('Off', { exact: true })).toHaveCount(0);
        } else if (reading === 'zero') {
          for (const label of ['Battery', 'Range', 'Inside', 'Outside']) {
            await expect(hero.getByRole('meter', { name: label, exact: true }))
              .toHaveAttribute('aria-valuenow', '0');
          }
          await expect(hero.getByText('Unlocked', { exact: true })).toBeVisible();
          await expect(hero.getByText('Off', { exact: true })).toBeVisible();
        } else {
          await expect(hero.getByRole('meter', { name: 'Battery', exact: true }))
            .toHaveAttribute('aria-valuenow', '72');
          await expect(hero.getByRole('meter', { name: 'Outside', exact: true }))
            .toHaveAttribute('aria-valuenow', '-8');
          await expect(hero.getByText('-4.20 kW', { exact: true })).toBeVisible();
        }
        for (const path of ['/vehicles/7', '/commands', '/live', '/digital-twin']) {
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
        await assertMockApiComplete(page, mocks);
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
          for (const label of ['Battery', 'Range', 'Inside', 'Outside']) {
            await expect(hero.getByRole('meter', { name: label, exact: true }))
              .toHaveAttribute('aria-valuenow', '0');
          }
          await expect(hero.getByText('Unlocked', { exact: true })).toBeVisible();
          await expect(hero.getByText('Off', { exact: true })).toBeVisible();
          await expect(hero.getByText('0.00', { exact: true })).toBeVisible();
        } else {
          await expect(hero.getByRole('meter', { name: 'Battery', exact: true }))
            .toHaveAttribute('aria-valuenow', '72');
          await expect(hero.getByRole('meter', { name: 'Outside', exact: true }))
            .toHaveAttribute('aria-valuenow', '-8');
          await expect(hero.getByText('-4.20', { exact: true })).toBeVisible();
        }

        for (const path of ['/vehicles/7', '/vehicles/7/commands', '/vehicles/7/map']) {
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
        await assertMockApiComplete(page, mocks);
      });
    }
  }
}
