import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { MapConfig } from '../src/api/types';
import type { FsdInsightsPeriod, FsdInsightsTotals } from '../src/types/fsd';
import { catalogueAnalyticsSources, installCatalogueRoutes, type CatalogueSources } from './dashboardCatalogueRemainingSources';
import { catalogueOperationalSources } from './dashboardCatalogueOperationalSources';
import { catalogueSystemSources } from './dashboardCatalogueSystemSources';
import { fulfillApiFixture, resolveApiFixture, type MockApiController } from './mockApi';
import { assertCatalogueYAxisTickBounds } from './dashboardCatalogueGeometry';

export const remainingBatches = {
  'catalogue-analytics-totals': ['fleet-stats', 'fleet-stats-bar', 'weekly-summary-card', 'weekly-digest',
    'fsd-weekly', 'monthly-mileage', 'lifetime-stats'],
  'catalogue-analytics-evidence': ['mileage-stats', 'state-timeline', 'anomaly-detector',
    'fsm-distribution', 'year-review', 'analytics-summary', 'recently-unlocked-achievements'],
  'catalogue-alerts-automations': ['alert-feed', 'notification-stats', 'automation-status', 'automation-history'],
  'catalogue-charging-history': ['charge-status', 'charge-status-live', 'charge-history', 'charge-session-chart',
    'charge-cost-tracker', 'charging-session-detail'],
  'catalogue-charging-strategy': ['charging-schedule', 'charging-optimizer', 'supercharger-history',
    'charge-plans', 'next-charge-decision'],
  'catalogue-charging-telemetry': ['charging-telemetry'],
  'catalogue-climate': ['climate-status', 'climate-control-panel', 'weather-at-car', 'climate-history'],
  'catalogue-commands-media': ['command-quick-actions', 'command-history', 'media-now-playing', 'media-history'],
  'catalogue-maps': ['location-map', 'location-favorites', 'geofence-status', 'destination-eta', 'position-heatmap'],
  'catalogue-workspace': ['onboarding-checklist', 'fleet-posture', 'quick-nav'],
  'catalogue-system': ['audit-log', 'backup-monitor', 'export-status', 'version-info', 'dashboard-stats'],
  'catalogue-signals-tires': ['live-signals', 'live-signal-sparklines', 'tire-pressure-visual', 'tire-pressure-history'],
};

export const remainingReadings: Record<string, RegExp> = {
  'alert-feed': /Catalogue battery threshold/,
  'notification-stats': /90\.00/,
  'fleet-stats': /300\.00/,
  'fleet-stats-bar': /300\.00/,
  'weekly-summary-card': /42\.00/,
  'weekly-digest': /42\.00/,
  'fsd-weekly': /Unmeasured is not zero/,
  'monthly-mileage': /123/,
  'lifetime-stats': /1,234\.00/,
  'mileage-stats': /10\.00/,
  'state-timeline': /66\.67/,
  'anomaly-detector': /Catalogue cabin temperature exceeded baseline/,
  'fsm-distribution': /driving/i,
  'year-review': /1,234\.00/,
  'analytics-summary': /300\.00/,
  'recently-unlocked-achievements': /Catalogue first trip/,
  'automation-status': /Catalogue cabin routine/,
  'automation-history': /Catalogue cabin routine/,
  'charge-status': /72\.00%/,
  'charge-status-live': /72\.00%/,
  'charge-history': /42\.00/,
  'charge-session-chart': /42\.00/,
  'charge-cost-tracker': /\$6\.72/,
  'charging-schedule': /80%/,
  'charging-optimizer': /80\.00%/,
  'charging-telemetry': /11\.00/,
  'supercharger-history': /\$12\.00/,
  'charge-plans': /80\.00%/,
  'next-charge-decision': /Catalogue low-rate window starts soon/,
  'charging-session-detail': /42\.00/,
  'climate-status': /21\s*°?C/,
  'climate-control-panel': /21\s*°?C/,
  'weather-at-car': /18\s*°?C/,
  'climate-history': /21\.00/,
  'command-quick-actions': /Lock/,
  'command-history': /Flash Lights/i,
  'location-favorites': /Catalogue home/,
  'geofence-status': /Catalogue home/,
  'destination-eta': /12\.00/,
  'media-now-playing': /Catalogue evening drive/,
  'media-history': /Catalogue evening drive/,
  'onboarding-checklist': /Connect your Tesla/i,
  'fleet-posture': /1 of 1 verified/,
  'quick-nav': /Trip history/,
  'audit-log': /Catalogue settings updated/,
  'backup-monitor': /2\.0(?:0)?\s*MB/,
  'export-status': /Running/,
  'version-info': /catalogue-2026\.10/,
  'dashboard-stats': /123/,
  'live-signals': /21\.00/,
  'live-signal-sparklines': /72\.00/,
  'tire-pressure-visual': /2\.80/,
  // Deliberately demands real history. Do not inject the frontend-only
  // timestamp alias: the actual tire-pressure handler emits created_at.
  'tire-pressure-history': /2\.80/,
};

export const remainingCompactReadings: Record<string, RegExp> = {
  'anomaly-detector': /1 active/,
  'automation-status': /1\/1/,
  'automation-history': /100\.00/,
  'charging-optimizer': /01:00|1:00/,
  'audit-log': /Events \(24h\)\s*2/,
  'backup-monitor': /Just now/i,
  'export-status': /Active exports\s*2/,
  'location-favorites': /Home/,
};

export const geometrySourceIDs = new Set(['location-map', 'position-heatmap']);

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export async function installRemainingCatalogueSources(page: Page, mocks: MockApiController) {
  const now = new Date().toISOString();
  const sources: CatalogueSources = {
    ...catalogueAnalyticsSources(now),
    ...catalogueOperationalSources(now),
    ...catalogueSystemSources(now),
    '/system/map-config': { provider: 'free', api_key: '' } satisfies MapConfig,
    '/alerts/rules': [],
    '/notifications/channels': [],
  };
  // The signals fixture also feeds ChargingSchedule, without dropping Soc.
  sources['/signals/7/live'] = {
    vehicle_id: 7, count: 5, at: now,
    signals: {
      Soc: { value: 72, timestamp: now },
      ChargeLimitSoc: { value: 80, timestamp: now },
      ScheduledChargingMode: { value: 'StartAt', timestamp: now },
      ScheduledChargingPending: { value: true, timestamp: now },
      ScheduledChargingStartTime: { value: now, timestamp: now },
    },
  };
  await installCatalogueRoutes(page, mocks, sources);
  await page.route('https://tile.openstreetmap.org/**', route => {
    if (!/\/\d+\/\d+\/\d+\.png$/.test(new URL(route.request().url()).pathname)) {
      throw new Error(`Unexpected catalogue tile request: ${route.request().url()}`);
    }
    return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'),
    });
  });
  await page.route('**/api/v1/analytics/fsd?*', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    if (!start || !end) throw new Error('FSD catalogue needs both actual weekly bounds');
    const baseline = resolveApiFixture('/analytics/fsd', 'GET', 'empty');
    if (!baseline.matched || !record(baseline.body)) throw new Error('Missing typed FSD unmeasured baseline');
    const days = Math.ceil((Date.parse(end) - Date.parse(start)) / 86_400_000);
    const timezone = url.searchParams.get('timezone') ?? 'UTC';
    const calendarDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const period: FsdInsightsPeriod = {
      days, timezone,
      start_date: calendarDate.format(new Date(start)),
      end_date: calendarDate.format(new Date(Date.parse(end) - 1)),
      start_at: start, end_at: end,
    };
    const totals: FsdInsightsTotals = {
      fsd_distance_m: null, driving_distance_m: null, fsd_share_pct: null,
      active_days: 0, measured_days: 0, days_in_period: days,
      avg_measured_day_fsd_distance_m: null, avg_active_day_fsd_distance_m: null,
      best_day: null,
    };
    return fulfillApiFixture(route, mocks, { json: { ...baseline.body, period, totals, daily: [] } });
  });
}

export async function assertRemainingContent(panel: Locator, id: string, width: number, info: TestInfo) {
  if (geometrySourceIDs.has(id)) {
    const layout = await panel.evaluate(element => {
      const map = element.querySelector('.leaflet-container');
      if (!map) throw new Error('Missing populated map container');
      const bounds = (node: Element) => {
        const r = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { tag: node.tagName, className: node.className.toString(),
          x: r.x, y: r.y, width: r.width, height: r.height,
          display: style.display, heightCSS: style.height, overflow: style.overflow };
      };
      const ancestors = [];
      let current: Element | null = map;
      while (current && current !== element) {
        ancestors.push(bounds(current));
        current = current.parentElement;
      }
      return { map: bounds(map), panel: bounds(element), ancestors };
    });
    await writeFile(info.outputPath(`${id}-map-layout.json`), JSON.stringify(layout, null, 2));
    expect(layout.map.height, `${id}: populated map must have visible body allocation`).toBeGreaterThan(30);
  }
  if (id === 'location-map') {
    const marker = panel.getByRole('img', { name: 'Vehicle position', exact: true });
    await expect(marker).toBeVisible();
    const angle = await marker.locator('[style*="rotate"]').getAttribute('style');
    expect(angle).toContain('rotate(90deg)');
    const bounds = await marker.boundingBox();
    expect(bounds?.width).toBe(24);
    const geometry = await marker.evaluate(node => {
      const map = node.closest('.leaflet-container');
      if (!map) throw new Error('Missing marker map viewport');
      const m = map.getBoundingClientRect();
      const b = node.getBoundingClientRect();
      return { marker: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
        map: { left: m.left, right: m.right, top: m.top, bottom: m.bottom } };
    });
    await writeFile(info.outputPath(`${id}-source-geometry.json`), JSON.stringify({ heading: 90, bounds, geometry }, null, 2));
    expect(geometry.marker.left, 'Source-bound marker clipped at map left').toBeGreaterThanOrEqual(geometry.map.left);
    expect(geometry.marker.right, 'Source-bound marker clipped at map right').toBeLessThanOrEqual(geometry.map.right);
    expect(geometry.marker.top, 'Source-bound marker clipped at map top').toBeGreaterThanOrEqual(geometry.map.top);
    expect(geometry.marker.bottom, 'Source-bound marker clipped at map bottom').toBeLessThanOrEqual(geometry.map.bottom);
  }
  if (id === 'position-heatmap') {
    const circles = panel.locator('path.leaflet-interactive');
    await expect(circles).toHaveCount(2);
    const fills = await circles.evaluateAll(nodes => nodes.map(node => node.getAttribute('fill')).sort());
    expect(fills).toEqual(['rgba(133,124,196,0.625)', 'rgba(245,64,226,0.9)'].sort());
    const geometry = await circles.evaluateAll(nodes => nodes.map(node => {
      const map = node.closest('.leaflet-container');
      if (!map) throw new Error('Missing cluster map viewport');
      const m = map.getBoundingClientRect();
      const b = node.getBoundingClientRect();
      return { cluster: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
        map: { left: m.left, right: m.right, top: m.top, bottom: m.bottom } };
    }));
    await writeFile(info.outputPath(`${id}-source-geometry.json`), JSON.stringify({ positions: 3, clusters: 2, fills, geometry }, null, 2));
    for (const circle of await circles.all()) {
      const bounds = await circle.boundingBox();
      expect(bounds?.width).toBeGreaterThan(5);
    }
    for (const sample of geometry) {
      expect(sample.cluster.left, 'Source-bound cluster clipped at map left').toBeGreaterThanOrEqual(sample.map.left);
      expect(sample.cluster.right, 'Source-bound cluster clipped at map right').toBeLessThanOrEqual(sample.map.right);
      expect(sample.cluster.top, 'Source-bound cluster clipped at map top').toBeGreaterThanOrEqual(sample.map.top);
      expect(sample.cluster.bottom, 'Source-bound cluster clipped at map bottom').toBeLessThanOrEqual(sample.map.bottom);
    }
  }
  if (id === 'geofence-status' && width === 1440) {
    const map = panel.locator('.leaflet-container');
    await expect(map).toHaveCount(1);
    await expect(map).toBeVisible();
    const markers = map.locator('.leaflet-marker-pane .leaflet-marker-icon');
    await expect(markers).toHaveCount(1);
    const marker = markers.first();
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAttribute('role', 'button');
    await expect(marker).toHaveAttribute('tabindex', '0');
    await expect(marker).toHaveAccessibleName(/\S/);
    await marker.focus();
    await expect(marker).toBeFocused();
    const circles = map.locator('path.leaflet-interactive');
    await expect(circles).toHaveCount(1);
    await expect(circles.first()).toBeVisible();
    const geometry = await map.evaluate(node => {
      const bounds = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          width: box.width, height: box.height };
      };
      return { map: bounds(node),
        markers: [...node.querySelectorAll('.leaflet-marker-pane .leaflet-marker-icon')].map(element => ({
          tag: element.tagName, bounds: bounds(element),
          image: element instanceof HTMLImageElement
            ? { src: element.currentSrc, complete: element.complete,
              naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight }
            : null,
        })),
        circles: [...node.querySelectorAll('path.leaflet-interactive')].map(bounds) };
    });
    await writeFile(info.outputPath(`${id}-source-geometry.json`), JSON.stringify(geometry, null, 2));
    expect(geometry.map.height, 'Geofence populated map must have visible body allocation').toBeGreaterThan(30);
    for (const bounds of [...geometry.markers.map(sample => sample.bounds), ...geometry.circles]) {
      expect(bounds.width, 'Geofence marker or circle must have visible width').toBeGreaterThan(0);
      expect(bounds.height, 'Geofence marker or circle must have visible height').toBeGreaterThan(0);
      expect(bounds.left, 'Geofence marker or circle clipped at map left').toBeGreaterThanOrEqual(geometry.map.left);
      expect(bounds.right, 'Geofence marker or circle clipped at map right').toBeLessThanOrEqual(geometry.map.right);
      expect(bounds.top, 'Geofence marker or circle clipped at map top').toBeGreaterThanOrEqual(geometry.map.top);
      expect(bounds.bottom, 'Geofence marker or circle clipped at map bottom').toBeLessThanOrEqual(geometry.map.bottom);
    }
    await expect.poll(() => marker.evaluate(node => !(node instanceof HTMLImageElement)
      || (node.complete && node.naturalWidth > 0 && node.naturalHeight > 0)),
    { message: 'Geofence image marker must finish decoding with nonzero intrinsic dimensions' }).toBe(true);
  }
  if (id === 'quick-nav') {
    for (const href of ['/drives', '/charging', '/analytics', '/battery']) {
      const link = panel.locator(`a[href="${href}"]`);
      await expect(link).toBeVisible();
      await link.focus();
      await expect(link).toBeFocused();
    }
  }
  if (id === 'onboarding-checklist') {
    // Shared browser seeding deliberately dismisses the checklist.
    await expect(panel).toContainText('Setup checklist hidden');
    await panel.getByRole('button', { name: 'Restart checklist', exact: true }).click();
    await expect(panel.getByTestId('checklist-task-connect-vehicle')).toHaveAttribute('data-complete', 'true');
    await panel.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(panel).toContainText('Setup checklist hidden');
    await panel.getByRole('button', { name: 'Restart checklist', exact: true }).click();
    await expect(panel.getByTestId('checklist-task-connect-vehicle')).toHaveAttribute('data-complete', 'true');
  }
  if (id === 'location-favorites' && width === 390) {
    await expect(panel.getByRole('img', { name: 'Home', exact: true })).toBeVisible();
  }
  if (id === 'export-status' && width === 1440) {
    await expect(panel.getByText('Running', { exact: true })).toHaveCount(2);
    await expect(panel).toContainText('CSV');
    await expect(panel).toContainText('JSON');
  }
  if (id === 'charging-session-detail') {
    if (width === 1440) {
      const ticks = await assertCatalogueYAxisTickBounds(panel, id, info, 2);
      expect(ticks.filter(tick => tick.text?.includes('%')).length).toBeGreaterThan(2);
      expect(ticks.filter(tick => !tick.text?.includes('%')).length).toBeGreaterThan(2);
    }
    await expect(panel.getByText('AC / home', { exact: true })).toBeVisible();
    await expect(panel).not.toContainText('DC fast');
  }
  if (id === 'charge-history') {
    if (width === 1440) {
      const ticks = await assertCatalogueYAxisTickBounds(panel, id, info);
      for (const tick of ticks) {
        expect(tick.text, 'Charge history axis preserves the full numeric kWh formatter')
          .toMatch(/^-?\d+(?:\.\d+)? kWh$/);
      }
    } else {
      await expect(panel.locator('svg.recharts-surface')).toHaveCount(0);
      await expect(panel).toContainText(/Total\s*42\.00\s*kWh\s*Avg\s*42\.00\s*kWh/);
    }
  }
  if (id === 'command-quick-actions') {
    for (const name of ['Lock', 'Unlock', 'Climate on', 'Climate off', 'Frunk', 'Horn']) {
      const button = panel.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
    }
    // Do not send any command, even against a permissive generic mock route.
    await panel.getByRole('button', { name: 'Lock', exact: true }).focus();
    await expect(panel.getByRole('button', { name: 'Lock', exact: true })).toBeFocused();
  }
  if (id === 'media-now-playing') {
    await expect(panel).toContainText('Synthetic ensemble');
    const progress = panel.getByRole('progressbar', { name: 'Playback progress' });
    if (width === 1440) {
      await expect(progress).toHaveAttribute('aria-valuenow', '25');
      await expect(progress).toHaveAttribute('aria-valuemax', '100');
    }
  }
  if (id === 'live-signal-sparklines') {
    await expect(panel.getByRole('img', { name: 'Increasing', exact: true })).toHaveCount(1);
    await expect(panel.getByRole('img', { name: 'Increasing', exact: true })).toBeVisible();
    await expect(panel.getByRole('img', { name: /Soc trend/i })).toBeVisible();
  }
  if (id === 'fsd-weekly') {
    await expect(panel.getByTestId('fsd-weekly-distance')).toContainText('—');
    await expect(panel.getByTestId('fsd-weekly-distance')).not.toContainText('0.00');
  }
  if (id === 'fleet-posture') {
    await expect(panel.getByText('1 of 1 verified', { exact: true })).toBeVisible();
    await expect(panel.getByTestId('fleet-posture-announcement')).toContainText('All 1 vehicles verified from current telemetry.');
  }
  if (id === 'version-info' && width === 1440) {
    await expect(panel).toContainText(/Signals\/sec\s*—/);
    await expect(panel).toContainText(/Messages today\s*—/);
  }
}
