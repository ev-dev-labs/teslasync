import { expect, test } from '@playwright/test';
import type { PhysicsLedger } from '../src/api/types';
import type { DriveDiagnosticResponse } from '../src/types/admin-diagnostics';
import type { RoadAnomalyResponse } from '../src/types/roadAnomalies';
import type { GearTheater, SilentReport } from '../src/types/teslaPhysics';
import { assertMockApiComplete, closeMockApiFixtures, forwardLocalApiFixture, fulfillApiFixture, mockDrive, waitForHarnessReady } from './mockApi';
import { installSyntheticMediaShell } from './smart-media-shell.fixtures';

const route = '/route-efficiency?vehicle_id=7#private-weekly-efficiency';
const endpoint = '/api/v1/analytics/route-efficiency/weekly-digest';
const early = '2026-03-09T12:59:00Z';
const due = '2026-03-09T13:00:00Z';
const drive = {
  ...mockDrive, id: 812, vehicle_id: 7, start_ts: '2026-03-08T15:00:00Z', end_ts: '2026-03-08T15:10:00Z',
  distance_m: 5005, duration_s: 600, start_lat: 47.11, start_lon: -122.301,
  end_lat: 47.155, end_lon: -122.299, telemetry: [],
  positions: [
    { latitude: 47.11, longitude: -122.301, timestamp: '2026-03-08T15:00:00Z' },
    { latitude: 47.1325, longitude: -122.3013, timestamp: '2026-03-08T15:05:00Z' },
    { latitude: 47.155, longitude: -122.299, timestamp: '2026-03-08T15:10:00Z' },
  ],
};
const driveRef = { drive_id: drive.id, vehicle_id: drive.vehicle_id };
const reportReads: Record<string, unknown> = {
  [`/api/v1/drives/${drive.id}`]: drive,
  [`/api/v1/drives/${drive.id}/shares`]: [],
  '/api/v1/drives/stats': { total_drives: 1, total_distance_m: drive.distance_m, total_duration_s: drive.duration_s },
  [`/api/v1/physics/drives/${drive.id}/silent`]: {
    ...driveRef, intervals: [], unknown: true, honesty: 'No counter intervals in the synthetic route fixture.',
  } satisfies SilentReport,
  [`/api/v1/physics/drives/${drive.id}/theater`]: {
    ...driveRef, events: [], honesty: 'No gear samples in the synthetic route fixture.',
  } satisfies GearTheater,
  [`/api/v1/physics/drives/${drive.id}/ledger`]: {
    vehicle_id: drive.vehicle_id, kind: 'drive', start: drive.start_ts, end: drive.end_ts, dynamics: null,
    drive: null, charge: null, park: null, thermal: null, range: null, tires: null, epochs: null,
    unknown_intervals: null, unknown_hours: 0, black_box: null, truncated: false, missing_signals: [],
    honesty: 'No physics ledger inputs in the synthetic route fixture.',
  } satisfies PhysicsLedger,
  [`/api/v1/drives/${drive.id}/road-anomalies`]: {
    drive_id: drive.id, status: 'insufficient_data', analyzed_samples: 0, candidates: [],
    limitations: ['No acceleration samples in the synthetic route fixture.'],
  } satisfies RoadAnomalyResponse,
  [`/api/v1/drives/${drive.id}/why-ended`]: {
    ...driveRef, start_ts: drive.start_ts, end_ts: drive.end_ts, ended_status: 'parked',
    window: '60s', fsm_transitions: [], signal_window: [],
  } satisfies DriveDiagnosticResponse,
};

test.use({ timezoneId: 'UTC', ...(process.env.SMART_WEEKLY_EFFICIENCY_REAL_BACKEND === '1' ? { headless: false } : {}) });
test.skip(process.env.SMART_WEEKLY_EFFICIENCY_REAL_BACKEND !== '1', 'Requires mounted handlers, worker and disposable PostgreSQL');
test.afterAll(async () => { await closeMockApiFixtures(); });

for (const variant of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { name: 'mobile', width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const) {
  test(`consent, measure a completed week and review a sustained change: ${variant.name}`, async ({ context }) => {
    test.setTimeout(120_000);
    const origin = process.env.E2E_BASE_URL;
    if (!origin) throw new Error('A local fixture server is required');
    const subject = `synthetic-efficiency-${variant.name}`;
    const externalOrigins: string[] = [];
    const writes: string[] = [];
    const errors: string[] = [];
    await context.route(url => /^https?:$/.test(url.protocol) && url.origin !== origin, intercepted => intercepted.abort());
    context.on('request', request => {
      const { protocol, origin: target, pathname } = new URL(request.url());
      if (pathname === '/api/v1/web-errors') errors.push(request.postData() ?? pathname);
      if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${pathname}`);
      if (/^https?:$/.test(protocol) && target !== origin) externalOrigins.push(target);
    });
    await context.addCookies([{ name: 'personal_test_subject', value: subject, url: origin }]);
    const tick = async (phase: 'early' | 'due' | 'moving' | 'parked') => {
      const response = await context.request.post(`${origin}/__fixture/weekly-efficiency?phase=${phase}`);
      expect(response.status(), await response.text()).toBe(204);
    };
    const open = async (now: string) => {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.stack ?? error.message));
      const api = await installSyntheticMediaShell(page, subject, route, now, variant);
      await page.route(url => url.pathname === '/api/v1/analytics/route-efficiency', intercepted =>
        fulfillApiFixture(intercepted, api, { json: { routes: [] } }));
      await page.route(url => Object.hasOwn(reportReads, url.pathname), intercepted => {
        expect(intercepted.request().method()).toBe('GET');
        return fulfillApiFixture(intercepted, api, { json: reportReads[new URL(intercepted.request().url()).pathname] });
      });
      await page.route(url => url.pathname === endpoint, async intercepted => {
        const headers = await intercepted.request().allHeaders();
        const url = new URL(intercepted.request().url());
        expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
        expect(url.searchParams.get('vehicle_id')).toBe('7');
        await forwardLocalApiFixture(intercepted, api, headers);
      });
      await page.goto(route);
      await waitForHarnessReady(page, api);
      return { page, api, panel: page.getByRole('region', { name: 'Private weekly drive efficiency' }) };
    };

    await tick('early');
    const settings = await open(early);
    await expect(settings.panel.getByText(/^Off\./)).toBeVisible();
    expect(writes).toEqual([]);
    await settings.panel.getByRole('button', { name: 'Set up weekly review' }).press('Enter');
    const zone = settings.panel.getByLabel('Weekly comparison time zone');
    await expect(zone).toBeFocused();
    await zone.fill('America/New_York');
    const submit = settings.panel.getByRole('button', { name: 'Confirm private weekly review' });
    await expect(submit).toBeDisabled();
    await settings.panel.getByRole('switch', { name: /^Compare this vehicle/ }).press('Space');
    await submit.press('Enter');
    await expect(settings.panel.getByText(/^Active\. No qualifying/)).toBeVisible();
    await expect(settings.panel.getByRole('button', { name: 'Edit weekly review' })).toBeFocused();
    await tick('early');
    await assertMockApiComplete(settings.page, settings.api);
    await settings.page.close();

    await tick('due');
    const { page, api, panel } = await open(due);
    const evidence = panel.getByRole('heading', { name: 'Higher consumption on matched drives' });
    await expect(evidence).toBeVisible();
    await expect(panel.getByText('160 Wh/km to 160 Wh/km')).toBeVisible();
    await expect(panel.getByText('240 Wh/km to 240 Wh/km')).toBeVisible();
    await expect(panel.getByText(/^4 observed days last week, compared with 8 earlier days/)).toBeVisible();

    const openDrive = panel.getByRole('button', { name: 'Open latest matching drive' });
    const edit = panel.getByRole('button', { name: 'Edit weekly review' });
    await expect(edit).toBeEnabled();
    await tick('moving');
    await edit.press('Enter');
    await expect(panel.getByText(/Park and wait for fresh vehicle data/)).toBeVisible();
    await expect(panel.getByLabel('Weekly comparison time zone')).toHaveCount(0);
    await expect(edit).toBeDisabled();
    await tick('parked');
    await page.reload();
    await expect(openDrive).toBeEnabled();
    await tick('moving');
    await openDrive.press('Enter');
    await expect(evidence).toBeVisible();
    await expect(panel.getByText(/Park and wait for fresh vehicle data/)).toBeVisible();
    await expect(page).toHaveURL(new URL(route, origin).href);
    await expect(openDrive).toBeDisabled();
    await expect(edit).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Dismiss this weekly digest' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Pause weekly review' })).toBeEnabled();
    expect(writes).toEqual([`PUT ${endpoint}`]);
    await tick('parked');
    await page.reload();
    await expect(openDrive).toBeEnabled();
    await openDrive.press('Enter');
    await expect(page).toHaveURL(/\/drives\/812\?local_evidence=1$/);
    await expect(page.getByText('Local evidence view. External map tiles are not loaded.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Route map' })).toHaveAttribute('data-route-mode', 'path');
    await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
    await expect(page.locator('.leaflet-tile')).toHaveCount(0);
    expect(externalOrigins).toEqual([]);
    await page.goto(route);
    await expect(evidence).toBeVisible();

    await panel.getByRole('button', { name: 'Dismiss this weekly digest' }).press('Enter');
    await expect(evidence).toHaveCount(0);
    await expect(panel.getByText('Dismissed for this week.')).toBeVisible();
    await panel.getByRole('button', { name: 'Pause weekly review' }).press('Enter');
    await expect(panel.getByText(/^Paused\./)).toBeVisible();
    const clearLabel = 'Turn off and clear weekly review';
    const clear = panel.getByRole('button', { name: clearLabel });
    const dialog = page.getByRole('dialog', { name: clearLabel });
    await clear.press('Enter');
    await dialog.getByRole('button', { name: 'Cancel' }).press('Enter');
    await expect(clear).toBeFocused();
    await clear.press('Enter');
    await dialog.getByRole('button', { name: clearLabel }).press('Enter');
    await expect(panel.getByText(/^Off\./)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await assertMockApiComplete(page, api);
    expect(writes).toEqual([`PUT ${endpoint}`, `PATCH ${endpoint}`, `PUT ${endpoint}`, `DELETE ${endpoint}`]);
    expect(errors).toEqual([]);
    expect(externalOrigins).toEqual([]);
  });
}
