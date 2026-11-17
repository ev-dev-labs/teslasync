import type { Page, Route } from '@playwright/test';
import type { SavedDashboard } from '../src/features/dashboard/widgets/types';
import { mergeDashboardSettings } from '../src/features/dashboard/widgets/types';
import { orderedLayouts } from '../src/features/dashboard/lib/orderedLayout';
import { catalogueAnalyticsSources } from './dashboardCatalogueRemainingSources';
import { catalogueCostBreakdown } from './dashboardWidgetFixtures';
import { fulfillApiFixture, type MockApiController } from './mockApi';
import {
  nativeAchievements, nativeAvailable, nativeCalibrationKey, nativeDrivingStats, nativeLive,
  nativeMaintenance, nativeMilestoneDrives, nativeReviewClock, nativeScenario,
  nativeSignalHistory, nativeSignalNames, nativeState, nativeVehicles, nativeWidgets,
  type NativeLiveMode,
} from './widget-design-packs.native.fixtures';

type Plan = 'success' | 'error' | 'held';
export type NativeReviewSources = Awaited<ReturnType<typeof installNativeReviewSources>>;

/** Deliberately isolated GET sources and local dashboard-preference storage.
 * No endpoint matcher falls back after seeing an invalid method/query. */
export async function installNativeReviewSources(
  page: Page, mocks: MockApiController, width: number,
) {
  await page.clock.setFixedTime(new Date(nativeReviewClock));
  const analytics = catalogueAnalyticsSources(nativeReviewClock);
  const widgets = nativeWidgets.map(([widgetId]) => ({
    id: `pack-review-${widgetId}`, widgetId,
    sizeClass: width === 390 ? 'small' as const : 'large' as const,
  }));
  const base: SavedDashboard = {
    id: 'widget-pack-review', name: 'Implementation review - synthetic data',
    widgets, layouts: orderedLayouts(widgets), settings: mergeDashboardSettings({ vehicleId: 7 }),
    isDefault: true, createdAt: nativeReviewClock, updatedAt: nativeReviewClock,
  };
  const dashboards: SavedDashboard[] = [
    base,
    { ...base, id: 'native-global', name: 'Synthetic alternate layout', isDefault: false },
    { ...base, id: 'native-pin-seven', name: 'Synthetic selected-vehicle pin', isDefault: false, vehicleId: 7 },
    { ...base, id: 'native-pin-eight', name: 'Synthetic other-vehicle pin', isDefault: false, vehicleId: 8 },
  ];
  let layouts = { dashboards: structuredClone(dashboards) as unknown[], active_id: base.id };
  await page.addInitScript(({ layouts, scenario, calibrationKey }) => {
    localStorage.setItem('teslasync-dashboards', JSON.stringify(layouts.dashboards));
    localStorage.setItem('teslasync-active-dashboard', layouts.active_id);
    localStorage.setItem('teslasync:home-energy-orchestrator:scenario:v1', JSON.stringify(scenario));
    localStorage.setItem(calibrationKey, '9000');
    // A legacy unassigned value must not overwrite the scoped 9,000 km base.
    localStorage.setItem('teslasync:milestones-base-km:v1', '777777');
    for (const key of ['dismissed', 'completed-at']) localStorage.removeItem(`teslasync:checklist:${key}`);
    localStorage.removeItem('teslasync:cp-discovered');
    localStorage.removeItem('teslasync:checklist:customizeDashboard');
    localStorage.setItem('teslasync:low-bandwidth:v1', 'on');
  }, { layouts, scenario: nativeScenario, calibrationKey: nativeCalibrationKey });
  let liveMode: NativeLiveMode = 'stale';
  let livePlan: Plan = 'success';
  let historyPlan: Plan = 'success';
  let historyCount = 4;
  let batteryLevel: number | null = 25.5;
  let mileageKm = 12_345;
  let releaseLive: (() => void) | undefined;
  let releaseHistory: (() => void) | undefined;
  let liveReady = Promise.resolve();
  let historyReady = Promise.resolve();
  const reads: Array<{ path: string; plan: Plan }> = [];
  const reject = (route: Route) => {
    mocks.unmatched.add(`${route.request().method()} ${new URL(route.request().url()).pathname}?<invalid-native-contract>`);
    return fulfillApiFixture(route, mocks, { status: 599, json: { error: 'Unexpected native review contract' } });
  };
  const hold = async (ready: Promise<void>) => {
    mocks.pending += 1;
    mocks.lastActivityAt = Date.now();
    try { await ready; } finally { mocks.pending -= 1; mocks.lastActivityAt = Date.now(); }
  };
  const paths = [
    '/vehicles', '/vehicles/states', '/vehicles/7/state', '/vehicles/8/state',
    '/tesla/energy-sites', '/maintenance', '/maintenance/records',
    '/mileage/stats', '/mileage/monthly', '/analytics/lifetime', '/analytics/tco', '/drives/stats',
    '/drives', '/signals/7/live', '/signals/7/available', '/signals/7/stats',
    `/signals/7/${nativeSignalNames.numeric}/history`,
    `/signals/7/${nativeSignalNames.boolean}/history`,
    `/signals/7/${nativeSignalNames.text}/history`,
  ];
  for (const path of paths) {
    await page.route(url => url.pathname === `/api/v1${path}`, async route => {
      const request = route.request();
      const url = new URL(request.url());
      const params = [...url.searchParams.entries()];
      const scoped = ['/maintenance', '/maintenance/records', '/mileage/stats', '/analytics/lifetime',
        '/analytics/tco', '/drives/stats'].includes(path);
      const valid = request.method() === 'GET' && (scoped
        ? params.length === 1 && (['/analytics/tco', '/drives/stats'].includes(path)
          ? ['7', '8'].includes(url.searchParams.get('vehicle_id') ?? '')
          : url.searchParams.get('vehicle_id') === '7')
        : path === '/mileage/monthly'
          ? params.length === 2 && ['7', '8'].includes(url.searchParams.get('vehicle_id') ?? '')
            && url.searchParams.get('timezone') === 'UTC'
        : path === '/vehicles/states'
          ? params.length === 2 && url.searchParams.get('vehicle_ids') === '7,8'
            && url.searchParams.get('limit') === '500'
        : path === '/drives'
          ? url.searchParams.get('vehicle_id') === '7' && url.searchParams.get('limit') === '1000'
            && (params.length === 2 || (params.length === 4
              && url.searchParams.get('start') === '2026-11-10T00:00:00.000Z'
              && url.searchParams.get('end') === '2026-11-11T00:00:00.000Z'))
        : path.endsWith('/history')
          ? params.length === 2 && url.searchParams.get('hours') === '1' && url.searchParams.get('limit') === '30'
        : params.length === 0);
      // Text/time/unknown leaves must never request numeric history.
      if (!valid || path === `/signals/7/${nativeSignalNames.text}/history`) return reject(route);
      const plan = path.endsWith('/live') ? livePlan : path.endsWith('/history') ? historyPlan : 'success';
      reads.push({ path, plan });
      if (plan === 'held') await hold(path.endsWith('/live') ? liveReady : historyReady);
      if (plan === 'error') return fulfillApiFixture(route, mocks, {
        status: 500, json: { error: 'Synthetic native source unavailable' },
      });
      const vehicleId = Number(url.searchParams.get('vehicle_id') ?? 7);
      const stateEnvelope = (id: number) => ({
        state: nativeState(id, id === 7 ? 90 : batteryLevel), live: true,
        observed_at: nativeReviewClock, freshness: 'fresh',
        verified_fields: ['state', 'battery_level', 'rated_range', 'ideal_range', 'odometer', 'outside_temp'],
      });
      let body: unknown;
      if (path === '/vehicles') body = nativeVehicles;
      else if (path === '/vehicles/states') body = {
        now: nativeReviewClock, total: 2, limit: 500, offset: 0,
        counts: { resolved: 2, missing: 0, failed: 0 },
        vehicles: [7, 8].map(id => ({ vehicle_id: id, outcome: 'resolved', ...stateEnvelope(id) })),
      };
      else if (/\/vehicles\/[78]\/state$/.test(path)) body = stateEnvelope(Number(path.split('/')[2]));
      else if (path === '/tesla/energy-sites' || path === '/maintenance/records') body = [];
      else if (path === '/maintenance') body = nativeMaintenance;
      else if (path === '/mileage/stats') body = {
        ...(analytics[path] as Record<string, unknown>), lifetime_km: mileageKm,
      };
      else if (path === '/mileage/monthly') body = {
        vehicle_id: vehicleId, months: ['2026-09', '2026-10', '2026-11'].map((month, index) => ({
          year_month: month, drive_count: (index + 1) * (vehicleId === 7 ? 4 : 3),
          total_km: (index + 1) * (vehicleId === 7 ? 123 : 89),
          total_wh_consumed: (index + 1) * 22_140, avg_efficiency_wh_per_km: 180,
        })),
      };
      else if (path === '/analytics/lifetime') body = {
        ...(analytics[path] as Record<string, unknown>), achievements: nativeAchievements,
      };
      else if (path === '/analytics/tco') body = {
        ...catalogueCostBreakdown(nativeReviewClock, '2026-09-01T00:00:00.000Z'), vehicle_id: vehicleId,
      };
      else if (path === '/drives/stats') body = nativeDrivingStats;
      else if (path === '/drives') {
        // The sidebar's today badge must not count the lifetime milestone rows.
        const start = url.searchParams.get('start');
        const end = url.searchParams.get('end');
        body = nativeMilestoneDrives.filter(drive =>
          (!start || drive.start_ts >= start) && (!end || drive.start_ts < end));
      }
      // Current signalinspect.Stats emits this explicit unknown log extent;
      // live-map reporting coverage must not be inferred from that counter.
      else if (path.endsWith('/stats')) body = { vehicle_id: 7, count: 0, oldest: null, newest: null };
      else if (path.endsWith('/live')) body = nativeLive(liveMode);
      else if (path.endsWith('/available')) body = nativeAvailable;
      else body = nativeSignalHistory(path.split('/')[3], historyCount);
      return fulfillApiFixture(route, mocks, { json: body });
    });
  }
  await page.route(url => url.pathname === '/api/v1/settings/dashboard-layouts', route => {
    const request = route.request();
    if (new URL(request.url()).search) return reject(route);
    if (request.method() === 'PUT') {
      const candidate = request.postDataJSON() as unknown;
      if (!candidate || typeof candidate !== 'object'
        || !('dashboards' in candidate) || !Array.isArray(candidate.dashboards)
        || !('active_id' in candidate) || typeof candidate.active_id !== 'string'
        || candidate.dashboards.length !== dashboards.length
        || !candidate.dashboards.every(item => item && typeof item === 'object'
          && 'id' in item && dashboards.some(saved => saved.id === item.id))
        || new Set(candidate.dashboards.map(item => item.id)).size !== dashboards.length
        || !dashboards.some(saved => saved.id === candidate.active_id)) return reject(route);
      layouts = { dashboards: candidate.dashboards, active_id: candidate.active_id };
    } else if (request.method() !== 'GET') return reject(route);
    return fulfillApiFixture(route, mocks, { json: layouts });
  });
  page.once('close', () => { releaseLive?.(); releaseHistory?.(); });
  return {
    reads,
    setLive(mode: NativeLiveMode) { liveMode = mode; livePlan = 'success'; },
    failLive() { livePlan = 'error'; },
    setHistory(count: number) { historyCount = count; historyPlan = 'success'; },
    failHistory() { historyPlan = 'error'; },
    setBattery(value: number | null) { batteryLevel = value; },
    setMileage(value: number) { mileageKm = value; },
    holdLive() {
      livePlan = 'held';
      liveReady = new Promise<void>(resolve => { releaseLive = resolve; });
      return () => { livePlan = 'success'; releaseLive?.(); releaseLive = undefined; };
    },
    holdHistory() {
      historyPlan = 'held';
      historyReady = new Promise<void>(resolve => { releaseHistory = resolve; });
      return () => { historyPlan = 'success'; releaseHistory?.(); releaseHistory = undefined; };
    },
    release() { releaseLive?.(); releaseHistory?.(); },
  };
}
