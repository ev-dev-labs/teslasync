import { expect, test, type Page } from '@playwright/test';
import type { MediaSnapshot, TirePressureSnapshot, ChargingTelemetry } from '../src/api/types';
import type { WeeklyDigestData } from '../src/types/analytics';
import { prepareCatalogueState } from './dashboardCatalogueStateHarness';
import { captureCataloguePanel, positionCataloguePanel } from './dashboardCatalogueCapture';
import { recordCatalogueObservationSources } from './dashboardCatalogueObservationAge';
import { catalogueWire, installCatalogueRoutes } from './dashboardCatalogueRemainingSources';
import { catalogueOperationalSources } from './dashboardCatalogueOperationalSources';
import { assertMockApiComplete, fulfillApiFixture, waitForHarnessReady } from './mockApi';
import {
  attachDiagnostics, expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
  type PageDiagnostics,
} from './qualityAssertions';

test.skip(process.env.E2E_MOCKS === '0', 'Requires local catalogue fixtures');
test.beforeEach(({ page }) => { recordCatalogueObservationSources(page); });

const weekly: WeeklyDigestData = {
  drives: 4, distanceKm: 42, energyKwh: 7, cost: 2.1, efficiency: 166.67,
  prevDrives: 2, prevDistanceKm: 21, prevEnergyKwh: 4, prevCost: 1.2, prevEfficiency: 190.48,
};
const panelFor = (page: Page, id: string) => page.locator(`[data-widget-id="state-${id}"] > .widget-panel`);

function expectOnlyDeliberateWeeklyFailure(diagnostics: PageDiagnostics) {
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.brokenResources).toEqual([]);
  expect(diagnostics.failedDataRequests).toHaveLength(1);
  expect(diagnostics.failedDataRequests[0]).toMatch(/^400 (?:fetch|xhr) http:\/\/127\.0\.0\.1:\d+\/api\/v1\/vehicles\/7\/weekly-digest$/);
  // Chromium logs an HTTP failure separately from the monitored response.
  // Account for that exact injected status, never CSP/style/runtime messages.
  for (const error of diagnostics.consoleErrors) {
    expect(error).toMatch(/^Failed to load resource: the server responded with a status of 400 \(Bad Request\)$/);
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`catalogue initial, retained failure and recovery at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      const mocks = await prepareCatalogueState(page, ['weekly-digest'], width, theme);
      let release = () => {};
      const held = new Promise<void>(resolve => { release = resolve; });
      let mode: 'hold' | 'ok' | 'failed' = 'hold';
      let recovered = false;
      let reads = 0;
      await page.route('**/api/v1/vehicles/7/weekly-digest', async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        reads++;
        if (mode === 'hold') await held;
        if (mode === 'failed') return fulfillApiFixture(route, mocks, {
          status: 400, json: { error: 'Deliberate local catalogue read failure', code: 'BAD_REQUEST' },
        });
        return fulfillApiFixture(route, mocks, {
          json: catalogueWire(recovered ? { ...weekly, distanceKm: 84, prevDistanceKm: 42 } : weekly),
        });
      });
      const diagnostics = monitorPage(page);
      const panel = panelFor(page, 'weekly-digest');
      try {
        await page.goto('/');
        await expect(panel.getByRole('heading').first()).toBeVisible();
        await expect(panel.locator('[aria-busy]').first()).toHaveAttribute('aria-busy', 'true');
        await expect(panel).not.toContainText('42.00');
        mode = 'ok';
        release();
        await expect(panel).toContainText('42.00');
        await waitForHarnessReady(page, mocks);
        mode = 'failed';
        const beforeFailure = reads;
        await panel.getByRole('button', { name: /^Refresh data/ }).click();
        await expect.poll(() => reads).toBeGreaterThan(beforeFailure);
        await expect(panel.locator('[data-data-state]').first()).toHaveAttribute('data-data-state', 'stale');
        await expect(panel.getByRole('status').filter({ hasText: /Previously loaded|Data may be stale/ }).first()).toBeVisible();
        await expect(panel).toContainText('42.00');
        await expect(panel).not.toContainText('No weekly data yet');
        await captureCataloguePanel(page, panel, test.info(), `retained-${width}-${theme}.png`);
        mode = 'ok';
        recovered = true;
        await panel.getByRole('button', { name: /^Refresh data/ }).click();
        await expect(panel).toContainText('84.00');
        await expect(panel.locator('[data-data-state]').first()).toHaveAttribute('data-data-state', 'ok');
        await expect(panel).not.toContainText('Previously loaded data remains visible');
        await expectNoHorizontalOverflow(page);
        expectOnlyDeliberateWeeklyFailure(diagnostics);
        await assertMockApiComplete(page, mocks);
      } finally {
        release();
        await attachDiagnostics(test.info(), diagnostics);
      }
    });

    test(`catalogue initial failure retries without fabricated readings at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      const mocks = await prepareCatalogueState(page, ['weekly-digest'], width, theme);
      let fail = true;
      await page.route('**/api/v1/vehicles/7/weekly-digest', route => fulfillApiFixture(route, mocks, fail
        ? { status: 400, json: { error: 'Deliberate local catalogue read failure', code: 'BAD_REQUEST' } }
        : { json: catalogueWire(weekly) }));
      const diagnostics = monitorPage(page);
      const panel = panelFor(page, 'weekly-digest');
      try {
        await page.goto('/');
        await expect(panel.getByRole('heading').first()).toBeVisible();
        await expect(panel.getByRole('alert')).toBeVisible();
        await expect(panel).not.toContainText('42.00');
        await expect(panel).not.toContainText('0.00 km');
        const retry = panel.getByRole('button', { name: 'Retry', exact: true });
        await retry.focus();
        await expect(retry).toBeFocused();
        fail = false;
        await retry.press('Enter');
        await expect(panel).toContainText('42.00');
        await expect(panel.getByRole('alert')).toHaveCount(0);
        await waitForHarnessReady(page, mocks);
        await expectNoHorizontalOverflow(page);
        expectOnlyDeliberateWeeklyFailure(diagnostics);
        await assertMockApiComplete(page, mocks);
        await captureCataloguePanel(page, panel, test.info(), `retry-recovered-${width}-${theme}.png`);
      } finally {
        await attachDiagnostics(test.info(), diagnostics);
      }
    });

    test(`catalogue genuine empty and inactive sources at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      const ids = ['alert-feed', 'media-now-playing', 'charging-telemetry'];
      const mocks = await prepareCatalogueState(page, ids, width, theme);
      const base = catalogueOperationalSources(new Date().toISOString())['/charging-telemetry/latest'];
      if (!base || typeof base !== 'object') throw new Error('Missing charging telemetry fixture');
      await installCatalogueRoutes(page, mocks, {
        '/alerts': [], '/media/latest': null,
        '/charging-telemetry/latest': { ...base, charging_state: 'Stopped', charger_power_w: 0 },
      });
      const diagnostics = monitorPage(page);
      try {
        await page.goto('/');
        await waitForHarnessReady(page, mocks);
        for (const [id, message] of [
          ['alert-feed', 'No alerts yet'], ['media-now-playing', 'Nothing playing'],
          ['charging-telemetry', 'Not currently charging'],
        ]) {
          const panel = panelFor(page, id);
          await positionCataloguePanel(panel);
          await expect(panel.getByRole('heading').first()).toBeVisible();
          await expect(panel).toContainText(message);
          await expect(panel.getByRole('alert')).toHaveCount(0);
          await captureCataloguePanel(page, panel, test.info(), `empty-${id}-${width}-${theme}.png`);
        }
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      } finally {
        await attachDiagnostics(test.info(), diagnostics);
      }
    });

    test(`catalogue extreme readings retain SI and accessible bounds at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      const ids = ['media-now-playing', 'tire-pressure-visual', 'charging-telemetry'];
      const mocks = await prepareCatalogueState(page, ids, width, theme);
      const now = new Date().toISOString();
      const media: MediaSnapshot = {
        id: 1, vehicle_id: 7, now_playing_title: 'Catalogue overrun track',
        now_playing_artist: 'Synthetic ensemble', now_playing_duration: 240, now_playing_elapsed: 720,
        playback_status: 'Playing', playback_source: 'Bluetooth', audio_volume: 25,
        audio_volume_max: 10, created_at: now,
      };
      const tires: TirePressureSnapshot = {
        id: 1, vehicle_id: 7, front_left: 180000, front_right: 400000,
        rear_left: 280000, rear_right: null, created_at: now,
      };
      const charging: ChargingTelemetry = {
        vehicle_id: 7, ts: now, session_id: null, battery_level: 72, battery_range_mi: null,
        charging_state: 'Charging', charger_voltage: 400, charger_actual_current: 375,
        charger_power_w: 150000, charger_phases: null, charge_energy_added_wh: 6000,
        range_added_meters: 30000, range_added_meters_per_hour: null, charger_pilot_current: null,
        scheduled_charging_at: null, source: 'telemetry',
      };
      await installCatalogueRoutes(page, mocks, {
        '/media/latest': media, '/tire-pressure/latest': tires, '/charging-telemetry/latest': charging,
      });
      const diagnostics = monitorPage(page);
      try {
        await page.goto('/');
        await waitForHarnessReady(page, mocks);
        for (const id of ids) {
          const panel = panelFor(page, id);
          await positionCataloguePanel(panel);
          await expect(panel.getByRole('heading').first()).toBeVisible();
          if (id === 'media-now-playing') {
            await expect(panel).toContainText('Catalogue overrun track');
            await expect(panel.getByRole('progressbar', { name: 'Playback progress' })).toHaveAttribute('aria-valuenow', '100');
          } else if (id === 'tire-pressure-visual') {
            await expect(panel).toContainText('1.80');
            await expect(panel).toContainText('4.00');
            await expect(panel).toContainText('—');
          } else {
            await expect(panel).toContainText('150.00');
            await expect(panel).toContainText('kW');
          }
          await expect(panel.getByRole('alert')).toHaveCount(0);
          await captureCataloguePanel(page, panel, test.info(), `extreme-${id}-${width}-${theme}.png`);
        }
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      } finally {
        await attachDiagnostics(test.info(), diagnostics);
      }
    });
  }
}
