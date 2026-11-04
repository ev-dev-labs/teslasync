import { expect, test, type Locator, type Page } from '@playwright/test';
import type { DashboardLayoutsPayload } from '../src/api/hooks/useSettings';
import { prepareCatalogueState } from './dashboardCatalogueStateHarness';
import { fulfillApiFixture, waitForHarnessReady } from './mockApi';
import { positionCataloguePanel } from './dashboardCatalogueCapture';
import { expectFlatWidgetSurfaces } from './dashboardWidgetSurfaces';
import { installCataloguePhotoSource } from './dashboardCatalogueGeometry';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic widget activity sources');

async function samples(element: Locator, property: 'transform' | 'strokeDashoffset') {
  return element.evaluate(async (node, key) => {
    const values: string[] = [];
    for (let frame = 0; frame < 20; frame++) {
      values.push(getComputedStyle(node)[key]);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return values;
  }, property);
}

async function motionSetting(page: Page, enabled: boolean) {
  await page.getByRole('button', { name: 'Switch dashboard layout' }).click();
  await page.getByRole('menuitem', { name: 'Layout settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dashboard settings' });
  const toggle = dialog.getByRole('switch', { name: 'Animate active states' });
  if ((await toggle.getAttribute('aria-checked')) !== String(enabled)) await toggle.click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
}

async function expectFlowGeometry(page: Page) {
  for (const id of ['energy-flow', 'energy-flow-animated', 'live-power-flow']) {
    const diagram = page.locator(`[data-widget-id="state-${id}"] .widget-flow-frame > svg`);
    if (page.viewportSize()!.width < 768 && id === 'energy-flow-animated') {
      await expect(diagram).toHaveCount(0);
      continue;
    }
    const issues = await diagram.evaluate(svg => {
      const frame = svg.parentElement!.getBoundingClientRect();
      const clipped = [...svg.querySelectorAll('[data-flow-node], text')].flatMap(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.left < frame.left - 1 || bounds.right > frame.right + 1
          || bounds.top < frame.top - 1 || bounds.bottom > frame.bottom + 1
          ? [node.textContent || node.getAttribute('data-flow-node')] : [];
      });
      const labels = [...svg.querySelectorAll('text')];
      const overlaps = labels.flatMap((label, index) => {
        const a = label.getBoundingClientRect();
        return labels.slice(index + 1).flatMap(other => {
          const b = other.getBoundingClientRect();
          return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
            ? [`${label.textContent} / ${other.textContent}`] : [];
        });
      });
      return { clipped, overlaps };
    });
    expect(issues, `${id} must retain every instrument and separate its readings`).toEqual({ clipped: [], overlaps: [] });
  }
}

for (const theme of ['dark', 'light'] as const) {
  for (const width of [375, 1440]) {
    test(`unified widget surfaces and unknown readings at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const ids = [
        'vehicle-hero', 'vehicle-hero-card', 'digital-twin-mini', 'climate-control-panel',
        'tire-pressure-visual', 'battery-gauge', 'charge-status-live', 'vehicle-specs',
        'drive-efficiency-chart', 'weekly-summary-card', 'command-history', 'security-status',
        'driving-coach', 'energy-flow', 'range-bar', 'maintenance-tracker',
        'signal-catalog', 'geofence-status', 'quick-nav',
      ];
      const mocks = await prepareCatalogueState(page, ids, width, theme);
      await page.addInitScript(() => localStorage.setItem('teslasync-row-height-version', '2'));
      await page.goto('/');
      await waitForHarnessReady(page, mocks);
      for (const id of ids) {
        const panel = page.locator(`[data-widget-id="state-${id}"] > .widget-panel`);
        await expect(panel).toBeVisible();
        await positionCataloguePanel(panel);
        await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0);
        await expectFlatWidgetSurfaces(panel);
        if (['vehicle-hero', 'battery-gauge', 'security-status', 'drive-efficiency-chart'].includes(id)) {
          await panel.screenshot({ path: test.info().outputPath(`flat-${id}-${width}-${theme}.png`), animations: 'disabled' });
        }
      }

      const state = {
        vehicle_id: 7, state: 'online', battery_level: 0, rated_range: 0, ideal_range: 0,
        inside_temp: 0, outside_temp: 0, is_locked: false, sentry_mode: false, is_charging: false,
      };
      const evidence = { state, live: false, observed_at: null, freshness: 'unknown', verified_fields: [] };
      await page.route('**/api/v1/vehicles/7/state', route => fulfillApiFixture(route, mocks, { json: evidence }));
      await page.route('**/api/v1/vehicles/states*', route => fulfillApiFixture(route, mocks, { json: {
        now: new Date().toISOString(), total: 1, limit: 100, offset: 0,
        counts: { resolved: 1, missing: 0, failed: 0 },
        vehicles: [{ vehicle_id: 7, outcome: 'resolved', ...evidence }],
      } }));
      await page.reload();
      await waitForHarnessReady(page, mocks);
      const hero = page.locator('[data-widget-id="state-vehicle-hero"] > .widget-panel');
      await positionCataloguePanel(hero);
      await expect(hero).toContainText('0 verified fields');
      await expect(hero.getByRole('meter', { name: 'Battery', exact: true })).toHaveCount(0);
      for (const label of ['Range', 'Inside', 'Outside']) {
        await expect(hero.getByRole('group', { name: label, exact: true })).toHaveAccessibleDescription('Unknown');
      }
      await expect(hero.getByText('Unlocked', { exact: true })).toHaveCount(0);
      await expect(hero.locator('.widget-road-motion')).toHaveCount(0);
      await hero.screenshot({ path: test.info().outputPath(`flat-unknown-hero-${width}-${theme}.png`), animations: 'disabled' });
      expect(failures).toEqual([]);
      expect([...mocks.unmatched]).toEqual([]);
    });

    test(`verified activity, pause and inactive states at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      let mode: 'charging' | 'complete' | 'driving' | 'lights-off' | 'conditioning' | 'stale' = 'charging';
      let savedLayouts: DashboardLayoutsPayload | undefined;
      const failures: string[] = [];
      page.on('pageerror', error => failures.push(error.message));
      const mocks = await prepareCatalogueState(page, [
        'battery-gauge', 'vehicle-hero', 'vehicle-hero-card', 'climate-status',
        'energy-flow', 'energy-flow-animated', 'live-power-flow',
      ], width, theme);
      await page.addInitScript(() => localStorage.setItem('teslasync-row-height-version', '2'));
      await page.route('**/api/v1/settings/dashboard-layouts', async route => {
        if (route.request().method() === 'PUT') savedLayouts = route.request().postDataJSON() as DashboardLayoutsPayload;
        if (savedLayouts) return fulfillApiFixture(route, mocks, { json: savedLayouts });
        return route.fallback();
      });
      await page.route('**/api/v1/vehicles/7/state', route => {
        const now = new Date(Date.now() - (mode === 'stale' ? 180_000 : 0)).toISOString();
        const driving = mode === 'driving' || mode === 'lights-off';
        const state = {
          vehicle_id: 7, state: driving ? 'driving' : mode === 'charging' ? 'charging' : 'online',
          battery_level: 72, rated_range: 410_000, ideal_range: 430_000, odometer: 32_100_000,
          power: mode === 'charging' ? -7680 : driving ? 14_000 : 0,
          is_charging: mode === 'charging', charger_power: mode === 'charging' ? 7.68 : 0,
          charge_rate: mode === 'charging' ? 30_000 : 0,
          time_to_full_charge: mode === 'charging' ? 3600 : 0,
          speed: driving ? 18 : 0, is_climate_on: mode === 'conditioning',
          inside_temp: 21, outside_temp: 18, is_locked: true, sentry_mode: false,
          timestamp: now, updated_at: now,
        };
        return fulfillApiFixture(route, mocks, { json: {
          state, live: mode !== 'stale', observed_at: now,
          freshness: mode === 'stale' ? 'stale' : 'fresh', verified_fields: Object.keys(state),
        } });
      });
      await page.route('**/api/v1/security/latest*', route => fulfillApiFixture(route, mocks, { json: {
        vehicle_id: 7, ts: new Date(Date.now() - (mode === 'stale' ? 180_000 : 0)).toISOString(),
        lights_high_beams: mode === 'driving', source: 'telemetry',
      } }));
      await page.route('**/api/v1/climate/latest*', route => fulfillApiFixture(route, mocks, { json: {
        vehicle_id: 7, ts: new Date().toISOString(), source: 'telemetry',
        inside_temp_c: 21, outside_temp_c: 18, driver_setpoint_c: 22, passenger_setpoint_c: 22,
        hvac_state: mode === 'conditioning' ? 'On' : 'Off', defrost_mode: 'Off',
        is_climate_on: mode === 'conditioning', is_preconditioning: false,
        fan_status: mode === 'conditioning' ? 3 : 0,
        inside_temp: 21, outside_temp: 18, driver_temp_setting: 22, passenger_temp_setting: 22,
        fan_speed: mode === 'conditioning' ? 3 : 0, hvac_power: mode === 'conditioning',
      } }));

      const load = async () => {
        await page.goto('/');
        await waitForHarnessReady(page, mocks);
      };
      await load();
      await expectFlowGeometry(page);
      const battery = page.locator('[data-widget-id="state-battery-gauge"]');
      const stream = battery.locator('.widget-energy-stream').first();
      await expect(stream).toBeAttached();
      await expect(stream).toHaveCSS('animation-name', 'widget-energy-sweep');
      const reading = battery.locator('[aria-valuenow]').first();
      await expect(reading).toHaveAttribute('aria-valuenow', '72');
      const moving = await samples(stream, 'transform');
      expect(moving.every((value, index) => index === 0 || value !== moving[index - 1])).toBe(true);
      await expect(reading).toHaveAttribute('aria-valuenow', '72');

      const savedRequest = page.waitForRequest(request =>
        request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/settings/dashboard-layouts');
      await motionSetting(page, false);
      await savedRequest;
      await expect(stream).toHaveCSS('animation-name', 'none');
      await load();
      await expect(stream).toHaveCSS('animation-name', 'none');
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('teslasync-dashboards') ?? '[]')[0]
        ?.settings?.animateActiveStates)).toBe(false);
      await battery.hover();
      await battery.getByRole('button', { name: /^Expand / }).click();
      const fullscreen = page.getByRole('dialog');
      await expect(fullscreen.locator('.widget-energy-stream').first()).toHaveCSS('animation-name', 'none');
      await fullscreen.getByRole('button', { name: 'Exit fullscreen' }).click();
      await motionSetting(page, true);
      await expect(stream).toHaveCSS('animation-name', 'widget-energy-sweep');

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(stream).toHaveCSS('animation-name', 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(stream).toHaveCSS('animation-name', 'widget-energy-sweep');
      for (const preference of ['on', 'auto']) {
        await page.evaluate(value => {
          const key = 'teslasync:low-bandwidth:v1';
          localStorage.setItem(key, value);
          window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
        }, preference);
        await expect(stream).toHaveCSS('animation-name', preference === 'on' ? 'none' : 'widget-energy-sweep');
      }
      for (const hidden of [true, false]) {
        await page.evaluate(value => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
          document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);
        await expect(stream).toHaveCSS('animation-name', hidden ? 'none' : 'widget-energy-sweep');
      }

      for (const inactive of ['complete', 'stale'] as const) {
        mode = inactive;
        await load();
        const animations = await battery.locator('.widget-state-motion').evaluateAll(nodes =>
          nodes.map(node => getComputedStyle(node).animationName));
        expect(animations.every(name => name === 'none')).toBe(true);
        await expect(battery).toContainText('72');
      }
      mode = 'driving';
      await load();
      await expectFlowGeometry(page);
      if (width >= 768) {
        const pair = page.locator('[data-widget-id="state-energy-flow-animated"] .widget-flow-frame > svg');
        const centering = await pair.evaluate(svg => {
          const frame = svg.getBoundingClientRect();
          const instruments = [...svg.querySelectorAll('[data-flow-node]')].map(node => node.getBoundingClientRect());
          return Math.abs((Math.min(...instruments.map(node => node.left)) + Math.max(...instruments.map(node => node.right))) / 2
            - (frame.left + frame.width / 2));
        });
        expect(centering, 'a two-instrument flow must remain centered when the charger disappears').toBeLessThan(1);
      }
      const road = page.locator('[data-widget-id="state-vehicle-hero"] .widget-road-near-motion');
      await expect(road).toHaveCSS('animation-name', 'widget-road-travel');
      expect(new Set(await samples(road, 'strokeDashoffset')).size).toBeGreaterThan(1);
      const studios = page.locator('[data-vehicle-studio]');
      await expect(studios).toHaveCount(2);
      for (const studio of await studios.all()) {
        const strip = studio.locator('.widget-road-strip');
        await expect(strip).toHaveCSS('mask-image', /linear-gradient.*0, 0, 0, 0.*12%.*88%.*0, 0, 0, 0/);
        await expect(studio.locator('.widget-road-near-motion')).toHaveCSS('animation-duration', '6s');
        await expect(studio.locator('.widget-road-far-motion')).toHaveCSS('animation-duration', '9s');
        await expect(studio.locator('.widget-road-grain-motion')).toHaveCSS('animation-name', 'widget-road-grain-travel');
        await expect(studio.locator('[data-vehicle-road-lighting]')).toHaveCount(1);
        const lights = await studio.evaluate(element => {
          const front = element.querySelector('.widget-road-headlight-pool')!;
          const rear = element.querySelector('.widget-road-taillight-pool')!;
          const frontBox = front.getBoundingClientRect();
          const rearBox = rear.getBoundingClientRect();
          const car = element.querySelector('[data-vehicle-twin]')!.getBoundingClientRect();
          const strip = element.querySelector('.widget-road-strip')!.getBoundingClientRect();
          const near = element.querySelector('.widget-road-near-motion')!.getBoundingClientRect();
          const groundOffset = element.querySelector<SVGGElement>('.widget-road-strip > g')!
            .transform.baseVal.consolidate()!.matrix.f;
          const expectedGround = (car.top - strip.top + 211 * car.width / 560) * 200 / strip.height;
          const color = (pool: Element) => getComputedStyle(
            document.getElementById(pool.getAttribute('fill')!.slice(5, -1))!.firstElementChild!).stopColor;
          return {
            frontWidth: frontBox.width, rearWidth: rearBox.width,
            frontAhead: frontBox.x + frontBox.width / 2 < car.x + car.width * .15,
            rearBehind: rearBox.x + rearBox.width / 2 > car.x + car.width * .85,
            differentColors: color(front) !== color(rear),
            nearVisible: near.y >= strip.y && near.y <= strip.bottom,
            groundError: Math.abs(177 + groundOffset - expectedGround),
            filters: element.querySelectorAll('.widget-road-strip [filter]').length,
          };
        });
        expect(lights.frontWidth).toBeGreaterThan(lights.rearWidth * 2);
        expect(lights.groundError, 'the road follows the real car bounds, including compact studio resize').toBeLessThan(1);
        expect(lights).toMatchObject({ frontAhead: true, rearBehind: true, differentColors: true, nearVisible: true, filters: 0 });
        await expect(studio.locator('[data-wheel-rotor].widget-wheel-motion')).toHaveCount(2);
      }
      const checkWheels = async (moving: boolean, variant: 'photo' | 'svg') => {
        for (const studio of await studios.all()) {
          const wheels = studio.locator(variant === 'photo' ? '[data-wheel-rotor]' : '[data-svg-wheel-rotor]');
          await expect(wheels).toHaveCount(2);
          for (const wheel of await wheels.all()) {
            await expect(wheel).toHaveCSS('animation-name', moving ? 'widget-wheel-turn' : 'none');
          }
          const frames = await studio.evaluate(async element => {
            const rotors = [...element.querySelectorAll('[data-wheel-rotor], [data-svg-wheel-rotor]')];
            const frames: string[][] = [];
            for (let frame = 0; frame < 6; frame++) {
              frames.push(rotors.map(rotor => getComputedStyle(rotor).transform));
              await new Promise(resolve => setTimeout(resolve, 150));
            }
            return frames;
          });
          for (const index of [0, 1]) {
            const distinct = new Set(frames.map(frame => frame[index])).size;
            if (moving) expect(distinct, `${variant} wheel ${index} rotates`).toBeGreaterThan(1);
            else expect(distinct, `${variant} wheel ${index} stays still`).toBe(1);
          }
          await expect(studio.locator(':scope > [role="img"]')).toHaveCSS('transform', 'none');
        }
      };
      await checkWheels(true, 'photo');
      for (const [index, studio] of (await studios.all()).entries()) {
        await positionCataloguePanel(studio.locator('xpath=ancestor::*[@data-widget-id][1]'));
        await studio.screenshot({ path: test.info().outputPath(`driving-photo-${index}-${width}-${theme}.png`) });
      }
      await motionSetting(page, false);
      await expect(road).toHaveCSS('animation-name', 'none');
      await expect(studios.first().locator('.widget-road-grain-motion')).toHaveCSS('animation-name', 'none');
      await checkWheels(false, 'photo');
      await motionSetting(page, true);
      await checkWheels(true, 'photo');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await checkWheels(false, 'photo');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      for (const preference of ['on', 'auto']) {
        await page.evaluate(value => {
          const key = 'teslasync:low-bandwidth:v1';
          localStorage.setItem(key, value);
          window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
        }, preference);
        await checkWheels(preference === 'auto', 'photo');
      }
      for (const hidden of [true, false]) {
        await page.evaluate(value => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
          document.dispatchEvent(new Event('visibilitychange'));
        }, hidden);
        await checkWheels(!hidden, 'photo');
      }
      await installCataloguePhotoSource(page, true);
      await load();
      await checkWheels(true, 'svg');
      for (const studio of await studios.all()) {
        await expect(studio.locator('[data-twin-ground-shadow]')).toHaveCSS('display', 'none');
      }
      await motionSetting(page, false);
      await checkWheels(false, 'svg');
      await motionSetting(page, true);
      for (const [index, studio] of (await studios.all()).entries()) {
        await positionCataloguePanel(studio.locator('xpath=ancestor::*[@data-widget-id][1]'));
        await studio.screenshot({ path: test.info().outputPath(`driving-svg-${index}-${width}-${theme}.png`) });
      }
      mode = 'lights-off';
      await load();
      await expect(studios.locator('[data-vehicle-road-lighting]')).toHaveCount(0);
      await expect(road).toHaveCSS('animation-name', 'widget-road-travel');
      mode = 'conditioning';
      await load();
      const airflow = page.locator('[data-widget-id="state-climate-status"] .widget-airflow-motion').first();
      await expect(airflow).toHaveCSS('animation-name', 'widget-airflow-travel');
      expect(new Set(await samples(airflow, 'strokeDashoffset')).size).toBeGreaterThan(1);
      await expect(page.locator('[data-widget-id="state-vehicle-hero"] .widget-road-motion')).toHaveCount(0);
      await expect(studios.locator('.widget-wheel-motion')).toHaveCount(0);
      expect(failures).toEqual([]);
      expect([...mocks.unmatched]).toEqual([]);
    });
  }
}
