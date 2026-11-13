import type { Page } from '@playwright/test';
import { installDriveDetailMocks } from './driveDetailFixtures';
import { fulfillApiFixture, type MockApiController } from './mockApi';
import { catalogueAnalyticsSources } from './dashboardCatalogueRemainingSources';
import { cardLayoutWorkspaceSources } from './cardLayoutWorkspaceSources';
import {
  specializedBattery, specializedCharging, specializedDrives, specializedHistory,
  specializedPositions, specializedReviewClock, specializedSessions, specializedTranscripts,
} from './widget-design-packs.specialized.fixtures';

/** Reuse the reviewed owner wire contracts and existing drive 412 fixture.
 * All routes are read-only and use the existing strict accounting controller. */
export async function installSpecializedReviewSources(
  page: Page, mocks: MockApiController, theme: 'dark' | 'light',
) {
  await page.clock.setFixedTime(new Date(specializedReviewClock));
  const analytics = catalogueAnalyticsSources(specializedReviewClock);
  let noCellData = false;
  await installDriveDetailMocks(page, theme, mocks);
  const sources: Record<string, unknown> = {
    '/analytics/battery-cells': specializedBattery,
    '/analytics/period-stats': cardLayoutWorkspaceSources['/analytics/period-stats'],
    '/vehicle-states/summary': analytics['/vehicle-states/summary'],
    '/signals/7/available': {
      vehicle_id: 7, count: 2, source: 'protomodel',
      signals: [{ name: 'NumericA' }, { name: 'NumericB' }],
    },
    '/signals/7/NumericA/history': specializedHistory('NumericA'),
    '/signals/7/NumericB/history': specializedHistory('NumericB'),
    // Positions aliases match vehicle/handler.go, not the differently shaped
    // raw Position model used by some older catalogue fixtures.
    '/vehicles/7/positions': specializedPositions,
    '/location-snapshots/latest': { located_at_home: true, located_at_work: false, homelink_nearby: null },
    '/chatbot/sessions': specializedSessions,
  };
  for (const [path, json] of Object.entries(sources)) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => {
      const url = new URL(route.request().url());
      const params = [...url.searchParams.entries()];
      const validQuery = path === '/analytics/battery-cells' || path === '/location-snapshots/latest'
        ? params.length === 1 && url.searchParams.get('vehicle_id') === '7'
        : path === '/analytics/period-stats'
          ? params.length === 1 && url.searchParams.get('vehicle_id') === '7'
          : path === '/vehicle-states/summary'
            ? url.searchParams.get('vehicle_id') === '7'
              && params.every(([key]) => ['vehicle_id', 'start', 'end'].includes(key))
        : path.endsWith('/history')
          ? params.length === 1 && url.searchParams.get('hours') === '24'
          : path.endsWith('/positions')
            ? params.length === 1 && ['1', '50'].includes(url.searchParams.get('limit') ?? '')
            : params.length === 0;
      if (route.request().method() !== 'GET' || !validQuery) {
        mocks.unmatched.add(`${route.request().method()} ${path}`);
        return fulfillApiFixture(route, mocks, { status: 599, json: { error: 'Unexpected specialist read contract' } });
      }
      const body = path.endsWith('/positions') && Array.isArray(json)
        ? json.slice(0, Number(url.searchParams.get('limit')))
        : path === '/analytics/battery-cells' && noCellData
          ? {
            ...specializedBattery, status: 'no_data', cells: [], history: [],
            signal_availability: {
              ...specializedBattery.signal_availability,
              min_voltage: false, avg_voltage: false, max_voltage: false,
              voltage_spread: false, imbalance_mv: false,
            },
          } : json;
      return fulfillApiFixture(route, mocks, { json: body });
    });
  }
  await page.route(url => url.pathname === '/api/v1/chatbot/history', route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || [...url.searchParams].length !== 1
      || !Object.hasOwn(specializedTranscripts, url.searchParams.get('session_id') ?? '')) {
      mocks.unmatched.add(`${route.request().method()} /chatbot/history`);
      return fulfillApiFixture(route, mocks, { status: 599, json: { error: 'Unexpected conversation read contract' } });
    }
    return fulfillApiFixture(route, mocks, { json: specializedTranscripts[url.searchParams.get('session_id') ?? ''] });
  });
  for (const [path, json] of [['/drives', specializedDrives], ['/charging', specializedCharging]] as const) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => {
      // Other route fixtures keep their original reviewed drive/session bodies.
      const currentPath = new URL(page.url()).pathname;
      // Wall-clock catalogue rows can be future-dated relative to this frozen review clock.
      const driveList = path === '/drives' && currentPath === '/drives';
      if (!driveList && currentPath !== (path === '/drives' ? '/' : '/charging-heatmap')) return route.fallback();
      const url = new URL(route.request().url());
      const params = url.searchParams;
      const validWindow = path === '/drives'
        ? params.get('vehicle_id') === '7' && (driveList
          ? [...params].length === 4 && params.get('limit') === '1000'
            && ((params.get('start') === '2026-10-27' && params.get('end') === '2026-11-11')
              || (params.get('start') === '2026-11-10T00:00:00.000Z' && params.get('end') === '2026-11-11T00:00:00.000Z'))
          : [...params].length === 1)
        : [...params].length === 5 && params.get('vehicle_id') === '7'
          && params.get('limit') === '2000' && params.get('offset') === '0'
          && Date.parse(params.get('start') ?? '') === Date.parse('2026-11-10T00:00:00Z')
          && Date.parse(params.get('end') ?? '') === Date.parse('2026-11-11T00:00:00Z');
      if (route.request().method() !== 'GET' || !validWindow) {
        mocks.unmatched.add(`${route.request().method()} ${path}`);
        return fulfillApiFixture(route, mocks, { status: 599, json: { error: 'Unexpected plot window contract' } });
      }
      return fulfillApiFixture(route, mocks, { json });
    });
  }
  // A deliberately blank local raster fixture prevents third-party requests.
  // Map acceptance below requires real Leaflet route/marker SVG geometry;
  // this pixel is never treated as geographic or visual-map evidence.
  const blankTile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  await page.route('https://tile.openstreetmap.org/**', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ contentType: 'image/png', body: blankTile })
      : route.fallback());
  return { setNoCellData(value: boolean) { noCellData = value; } };
}

export type SpecializedReviewSources = Awaited<ReturnType<typeof installSpecializedReviewSources>>;
