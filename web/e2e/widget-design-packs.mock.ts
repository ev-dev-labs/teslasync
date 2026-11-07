import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import type { DashboardLayoutsPayload } from '../src/api/hooks/useSettings';
import type { SavedDashboard } from '../src/features/dashboard/widgets/types';
import { mergeDashboardSettings } from '../src/features/dashboard/widgets/types';
import { orderedLayouts } from '../src/features/dashboard/lib/orderedLayout';
import { PACK_APPEARANCES, type PackId } from '../src/features/dashboard/widgets/designPacks/types';
import { installDashboardWidgetSources } from './dashboardWidgetFixtures';
import { catalogueOperationalSources } from './dashboardCatalogueOperationalSources';
import { catalogueAnalyticsSources, installCatalogueRoutes } from './dashboardCatalogueRemainingSources';
import { installCatalogueSignalSources } from './dashboardCatalogueRemainingFixtures';
import { catalogueSystemSources } from './dashboardCatalogueSystemSources';
import { fulfillApiFixture, installApiMocks, seedBrowserState } from './mockApi';

export const statusWidgets = [
  ['drivetrain-health', 'Drivetrain health'], ['motor-performance', 'Motor performance'],
  ['vehicle-specs', 'Vehicle specifications'], ['safety-features', 'Safety features'],
  ['guard-mode', 'Guard mode'], ['automation-status', 'Automation status'],
  ['uptime-monitor', 'Uptime monitor'], ['system-health', 'System health'],
  ['backup-monitor', 'Backup monitor'], ['version-info', 'Version information'],
  ['energy-site-info', 'Energy site'], ['charge-cost-tracker', 'Charge costs'],
  ['fleet-stats', 'Fleet statistics'], ['fleet-stats-bar', 'Fleet statistics bar'],
  ['lifetime-stats', 'Lifetime statistics'], ['mileage-stats', 'Mileage statistics'],
  ['year-review', 'Year in review'], ['analytics-summary', 'Analytics summary'],
  ['dashboard-stats', 'Dashboard statistics'],
] as const;
export const timelineWidgets = [
  ['alert-feed', 'Alert feed'], ['sentry-event-log', 'Security event history'],
  ['backup-history', 'Energy backup history'], ['command-history', 'Command history'],
  ['software-update-history', 'Software update history'],
  ['audit-log', 'Audit history'], ['automation-history', 'Automation history'],
  ['telemetry-errors', 'Telemetry error history'], ['media-history', 'Media history'],
  ['safety-history', 'Safety history'], ['signal-log', 'Signal log'],
  ['supercharger-history', 'Supercharger history'], ['charge-plans', 'Charge plans'],
  ['charging-schedule', 'Charging schedule'], ['maintenance-tracker', 'Maintenance'],
  ['export-status', 'Export status'], ['warranty-status', 'Warranty coverage'],
  ['charging-optimizer', 'Charging optimizer'], ['next-charge-decision', 'Next charge decision'],
  ['anomaly-detector', 'Anomaly detector'], ['recently-unlocked-achievements', 'Recently unlocked achievements'],
] as const;
export const reviewWidgets = [
  ['vehicle-hero', 'Vehicle card'], ['battery-gauge', 'Battery'],
  ['drive-telemetry', 'Drive telemetry'], ['tire-pressure-visual', 'Tire pressure'],
  ['climate-status', 'Climate'], ['security-status', 'Security'],
  ['command-quick-actions', 'Quick commands'],
  ['battery-radial-gauge', 'Battery instrument'], ['range-bar', 'Range comparison'],
  ['projected-range', 'Projected range'], ['battery-health-analytics', 'Battery health'],
  ['sleep-efficiency', 'Sleep efficiency'], ['drive-score', 'Drive efficiency score'],
  ['drive-score-gauge', 'Drive score'], ['regen-efficiency', 'Regenerative braking'],
  ['charge-status', 'Charge status'], ['charge-status-live', 'Live charging'],
  ['software-update-status', 'Software update'], ['signal-health', 'Signal coverage'],
  ['notification-stats', 'Notification delivery'], ['fleet-posture', 'Fleet posture'],
  ['energy-stats', 'Energy usage'], ['range-estimate', 'Range estimate'],
  ['live-signals', 'Live signals'], ['live-signal-sparklines', 'Live signal sparklines'],
  ...statusWidgets,
  ...timelineWidgets,
] as const;
export const packNames: Record<PackId, string> = {
  classic: 'Classic', v1: 'Studio', v2: 'Elevated', v3: 'Precision',
  v4: 'Owner', v5: 'Iconic', v6: 'Expressive', v7: 'Pixel',
};
export const reviewOrigin = 'http://127.0.0.1:4189';
const reviewIdentity = 'widget-design-review';
export const preferenceKey = 'teslasync.widget-design-pack.v1.'
  + createHash('sha256').update(JSON.stringify([reviewOrigin, { mode: 'open' }])).digest('hex');

export function presentationSelector(widgetId: string, packId: Exclude<PackId, 'classic'>) {
  if (widgetId === 'vehicle-hero') return `[data-vehicle-hero-pack="${packId}"]`;
  if (widgetId === 'battery-gauge') return `[data-battery-gauge-pack="${packId}"]`;
  if (timelineWidgets.some(([id]) => id === widgetId)) return `[data-timeline-appearance="${PACK_APPEARANCES[packId]}"]`;
  if (statusWidgets.some(([id]) => id === widgetId)) return `[data-status-appearance="${PACK_APPEARANCES[packId]}"]`;
  if (reviewWidgets.slice(7).some(([id]) => id === widgetId)) return `[data-instrument-appearance="${PACK_APPEARANCES[packId]}"]`;
  const attributes: Record<string, string> = {
    'drive-telemetry': 'line', 'tire-pressure-visual': 'tire', 'climate-status': 'climate',
    'security-status': 'status', 'command-quick-actions': 'actions',
  };
  return `[data-${attributes[widgetId]}-appearance="${PACK_APPEARANCES[packId]}"]`;
}

export async function installPackReview(
  page: Page, theme: 'light' | 'dark', width: number, unknown = false,
  selection: readonly (readonly [string, string])[] = reviewWidgets,
  fullCatalogue = false,
) {
  if (process.env.E2E_MOCKS === '0') throw new Error('Widget design review requires isolated synthetic fixtures');
  await seedBrowserState(page, theme, '/', { preserveDashboardState: true });
  const now = new Date().toISOString();
  const widgets = selection.map(([widgetId]) => ({
    id: `pack-review-${widgetId}`, widgetId, sizeClass: width === 390 ? 'small' as const : 'large' as const,
  }));
  const dashboard: SavedDashboard = {
    id: 'widget-pack-review', name: 'Implementation review - synthetic data',
    widgets, layouts: orderedLayouts(widgets), settings: mergeDashboardSettings({ vehicleId: 7 }),
    isDefault: true, createdAt: now, updatedAt: now,
  };
  await page.addInitScript(({ saved, key }) => {
    sessionStorage.setItem('teslasync-watch-key', 'synthetic-review-key');
    localStorage.setItem('teslasync-dashboards', JSON.stringify([saved]));
    localStorage.setItem('teslasync-active-dashboard', saved.id);
    if (localStorage.getItem(key) == null) {
      localStorage.setItem(key, JSON.stringify({ version: 1, packId: 'classic' }));
    }
  }, { saved: dashboard, key: preferenceKey });
  await page.route('**/*', route => {
    return new URL(route.request().url()).origin === reviewOrigin
      ? route.continue() : route.abort('blockedbyclient');
  });
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('Missing isolated API fixtures');
  await installDashboardWidgetSources(page, mocks);
  const analytics = catalogueAnalyticsSources(now);
  await installCatalogueRoutes(page, mocks, {
    '/notifications/stats': analytics['/notifications/stats'],
    '/notifications/logs': analytics['/notifications/logs'],
    '/automations': analytics['/automations'],
    '/automations/history': analytics['/automations/history'],
    '/analytics/fleet': analytics['/analytics/fleet'],
    '/analytics/lifetime': analytics['/analytics/lifetime'],
    '/analytics/year-review': analytics['/analytics/year-review'],
    '/mileage/stats': analytics['/mileage/stats'],
    '/alerts': analytics['/alerts'],
    '/analytics/anomalies': analytics['/analytics/anomalies'],
  });
  const system = catalogueSystemSources(now);
  if (fullCatalogue) await installCatalogueRoutes(page, mocks, { ...analytics, ...system });
  await installCatalogueRoutes(page, mocks, {
    '/system/version': system['/system/version'],
    '/system/audit': system['/system/audit'],
    '/backup/runs': system['/backup/runs'],
    '/dev-tools/telemetry-capture/stats': system['/dev-tools/telemetry-capture/stats'],
    '/export/jobs': system['/export/jobs'],
  });
  await installCatalogueSignalSources(page, mocks, now);
  const operational = catalogueOperationalSources(now);
  if (fullCatalogue) await installCatalogueRoutes(page, mocks, operational);
  for (const path of [
    '/climate/latest', '/tire-pressure/latest', '/charging', '/vehicles/7/commands/history', '/media',
    '/charge-planner/history', '/charge-planner/rate-plans', '/tesla/charging/history',
    '/analytics/charging-optimizer', '/charge-autopilot/decision',
  ]) {
    await page.route(url => url.pathname === `/api/v1${path}`, route =>
      fulfillApiFixture(route, mocks, { json: operational[path] }));
  }
  await page.route('**/api/v1/users/me', route => fulfillApiFixture(route, mocks, {
    json: { id: reviewIdentity, displayName: 'Synthetic review', email: 'review@example.invalid', createdAt: now, updatedAt: now },
  }));
  await page.route('**/api/v1/settings/dashboard-layouts', route => fulfillApiFixture(route, mocks, {
    json: { dashboards: [dashboard], active_id: dashboard.id } satisfies DashboardLayoutsPayload,
  }));
  await page.route('**/api/v1/vehicles/7/command', route => fulfillApiFixture(route, mocks, {
    status: 403, json: { error: 'Vehicle commands are disabled in this synthetic review' },
  }));
  if (unknown) {
    const fixtures = {
      '/climate/latest': { vehicle_id: 7, ts: now, inside_temp_c: null, outside_temp_c: 18, driver_setpoint_c: null, hvac_power: null },
      '/tire-pressure/latest': { vehicle_id: 7, created_at: now, front_left: 0, front_right: null, rear_left: null, rear_right: 280_000 },
      '/security/latest': { vehicle_id: 7, ts: now, locked: null, sentry_mode: null },
      '/vehicles/7/state': {
        state: { vehicle_id: 7, battery_level: 0, rated_range: 0, ideal_range: null, is_charging: null, timestamp: now },
        live: true, observed_at: now, freshness: 'fresh', verified_fields: ['battery_level', 'rated_range'],
      },
      '/analytics/regen': { vehicleId: 7, regenRatio: 0, totalRegenWh: -120, totalDriveWh: null },
      '/analytics/battery-health': { vehicle_id: 7, current_soh: null, total_cycles: 0, avg_depth_of_discharge_pct: null, fast_charge_pct: null, temp_exposure_score: null },
      '/notifications/stats': { total_sent: 0, sent: 0, failed: 0, enabled_channels: null },
    };
    for (const [path, json] of Object.entries(fixtures)) {
      await page.route(url => url.pathname === `/api/v1${path}`, route => fulfillApiFixture(route, mocks, { json }));
    }
  }
  // Freeze after fixture creation so its observations never begin in the future.
  await page.clock.setFixedTime(new Date());
  return mocks;
}

export async function selectReviewPack(page: Page, packId: PackId) {
  await page.evaluate(({ key, selected }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, packId: selected }));
    window.dispatchEvent(new CustomEvent('teslasync:widget-design-pack-changed', { detail: key }));
  }, { key: preferenceKey, selected: packId });
}
