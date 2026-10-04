import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { DashboardLayoutsPayload } from '../src/api/hooks/useSettings';
import type { RGLLayouts, SavedDashboard } from '../src/features/dashboard/widgets/types';
import { getWidgetDef } from '../src/features/dashboard/widgets/registry';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady,
  waitForNoVisibleActivity,
} from './mockApi';
import {
  attachDiagnostics, expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage,
} from './qualityAssertions';
import { installDashboardWidgetSources } from './dashboardWidgetFixtures';
import { compactVehicleReadings, vehicleReadings } from './dashboardCatalogueVehicleFixtures';
import { batteryReadings } from './dashboardCatalogueBatteryFixtures';
import { assertCatalogueHeroMigration } from './dashboardCatalogueHeroRegression';
import { captureCatalogueTwinFrames } from './dashboardCatalogueTwinFrames';
import { captureCataloguePanel, positionCataloguePanel } from './dashboardCatalogueCapture';
import { recordCatalogueObservationSources } from './dashboardCatalogueObservationAge';
import { assertCatalogueChargeCategories, assertCatalogueChargeHistory, recordCatalogueChargeHistorySources } from './dashboardCatalogueChargeHistory';
import { assertCatalogueCountReference } from './dashboardCatalogueCountReference';
import { drivingReadings } from './dashboardCatalogueDrivingFixtures';
import { assertCatalogueAffectedAxes, assertCatalogueAllocation, assertSpeedProfileTickBounds, assertTwinWheelAndPhotoGeometry, installCataloguePhotoSource } from './dashboardCatalogueGeometry';
import {
  assertRemainingContent, geometrySourceIDs, installRemainingCatalogueSources,
  remainingBatches, remainingCompactReadings, remainingReadings,
} from './dashboardCatalogueRemainingFixtures';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic dashboard source fixtures');
test.beforeEach(({ page }) => {
  recordCatalogueObservationSources(page);
  recordCatalogueChargeHistorySources(page);
});

const batches = {
  ...remainingBatches,
  'axis-wide-dynamics': ['driving-dynamics'],
  driving: ['recent-drives', 'drive-score', 'recent-drives-list', 'drive-score-gauge',
    'drive-efficiency-chart', 'speed-heatmap', 'driving-dynamics', 'speed-profile',
    'regen-efficiency', 'route-efficiency', 'driving-coach', 'trip-summary', 'drive-telemetry'],
  battery: [
    'battery-gauge', 'battery-radial-gauge', 'range-estimate', 'range-bar',
    'battery-degradation-trend', 'energy-flow', 'projected-range', 'battery-cells',
    'battery-degradation-forecast', 'battery-health-analytics',
  ],
  'energy-remaining': ['vampire-drain', 'sleep-efficiency', 'live-power-flow', 'backup-history'],
  vehicle: [
    'vehicle-hero', 'vehicle-hero-card',
    'software-update-status', 'software-update-history', 'odometer-counter',
    'drivetrain-health', 'motor-performance', 'vehicle-specs',
    'watch-summary', 'maintenance-tracker', 'warranty-status', 'subscriptions', 'vehicle-upgrades',
  ],
  'vehicle-twin': ['vehicle-twin', 'digital-twin-mini'],
  'vehicle-twin-svg': ['vehicle-twin', 'digital-twin-mini'],
  'vehicle-twin-charging': ['vehicle-twin', 'digital-twin-mini'],
  'vehicle-motor-history': ['motor-history'],
  'vehicle-repaired-headings': ['watch-summary', 'drivetrain-health'],
  energy: [
    'energy-stats', 'energy-flow-animated', 'power-flow-history', 'solar-production',
    'energy-site-info', 'wall-connector', 'cost-breakdown', 'cost-forecast',
  ],
  security: [
    'security-status', 'door-window-status', 'sentry-event-log', 'safety-features',
    'safety-history', 'guard-mode', 'vehicle-access',
  ],
  telemetry: [
    'api-usage', 'system-health', 'mqtt-status', 'telemetry-errors',
    'signal-health', 'signal-log', 'signal-catalog', 'uptime-monitor',
  ],
};

const readings: Record<string, RegExp> = {
  ...remainingReadings,
  ...vehicleReadings,
  ...batteryReadings,
  ...drivingReadings,
  'energy-stats': /15(?:\.0)?/,
  'energy-flow-animated': /14\.00\s*kW/,
  'power-flow-history': /3\.85\s*kW/,
  'solar-production': /12\.0/,
  'energy-site-info': /13\.50\s*kWh/,
  'wall-connector': /14\.0/,
  'cost-breakdown': /\$110\.00/,
  'cost-forecast': /\$120/,
  'security-status': /Locked/,
  'door-window-status': /Closed/,
  'sentry-event-log': /Sentry mode activated/,
  'safety-features': /(?:Active features|Blind spot)/i,
  'safety-history': /(?:1 events|FCW: Medium)/,
  'guard-mode': /Armed/,
  'vehicle-access': /(?:1 drivers|Review driver)/,
  'api-usage': /180/,
  'system-health': /(?:4\/4|2\.4 GB)/,
  'mqtt-status': /3\.5/,
  'telemetry-errors': /(?:Healthy|Recovered historical connection interruption)/,
  'signal-health': /(?:1\/1|Active1With gaps0)/,
  'signal-log': /(?:Signals\/sec|Soc)/,
  'signal-catalog': /(?:Signals available|Soc)/,
  'uptime-monitor': /(?:4\/4|All OK)/,
};

for (const [batch, ids] of Object.entries(batches)) {
  for (const motion of batch.startsWith('vehicle') ? ['reduce', 'no-preference'] as const : ['no-preference'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [390, 1440]) {
      test(`${batch} widgets retain real content and fit at ${width}px in ${theme} (${motion})`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: motion });
        await seedBrowserState(page, theme, '/');
        const widgets = ids.map(widgetId => ({ id: `review-${widgetId}`, widgetId, vehicleId: 7 }));
        const layouts: RGLLayouts = {};
        for (const [breakpoint, columns] of Object.entries({ lg: 4, md: 3, sm: 2, xs: 1 })) {
          let row = 0;
          layouts[breakpoint] = widgets.map(widget => {
            const def = getWidgetDef(widget.widgetId);
            if (!def) throw new Error(`Unregistered review widget: ${widget.widgetId}`);
            const y = row;
            row += def.defaultSize.rows;
            return {
              i: widget.id, x: 0, y,
              w: Math.min(columns, batch === 'axis-wide-dynamics' ? 3 : def.defaultSize.cols), h: def.defaultSize.rows,
            };
          });
        }
        const dashboard: SavedDashboard = {
          id: `review-${batch}`, name: `Review ${batch}`, widgets, layouts,
          createdAt: '2026-08-26T16:00:00.000Z', updatedAt: '2026-08-26T16:00:00.000Z',
          isDefault: true,
        };
        await page.addInitScript(saved => {
          localStorage.setItem('teslasync-dashboards', JSON.stringify([saved]));
          localStorage.setItem('teslasync-active-dashboard', saved.id);
        }, dashboard);
        const mocks = await installApiMocks(page, 'populated', theme);
        if (!mocks) throw new Error('Dashboard widget acceptance requires API fixtures');
        await installDashboardWidgetSources(page, mocks, batch === 'vehicle-twin-charging');
        if (batch.startsWith('catalogue-')) await installRemainingCatalogueSources(page, mocks);
        await installCataloguePhotoSource(page, batch === 'vehicle-twin-svg');
        await page.route('**/api/v1/settings/dashboard-layouts', route => fulfillApiFixture(route, mocks, {
          json: { dashboards: [dashboard], active_id: dashboard.id } satisfies DashboardLayoutsPayload,
        }));
        const diagnostics = monitorPage(page);
        try {
        await page.goto('/');
        if (batch === 'vehicle-twin' && motion === 'reduce') {
          const panel = page.locator('[data-widget-id="review-vehicle-twin"] > .widget-panel');
          await expect(panel.locator('ellipse[cx="320"][cy="91"]')).toBeVisible();
          const samples = await panel.evaluate(async element => {
            const frames: { tag: string; className: string; style: string }[][] = [];
            for (let frame = 0; frame < 60; frame++) {
              await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
              frames.push([...element.querySelectorAll('[style*="transform"]')].map(node => ({
                tag: node.tagName, className: node.getAttribute('class') ?? '',
                style: node.getAttribute('style') ?? '',
              })));
            }
            return frames;
          });
          await writeFile(test.info().outputPath('reduced-twin-animation.json'), JSON.stringify(samples, null, 2));
        }
        try {
          if (batch.startsWith('vehicle-twin') && motion === 'no-preference') {
            await expect(page.locator('main')).toBeVisible();
            await expect.poll(() => ({
              pending: mocks.pending, quiet: Date.now() - mocks.lastActivityAt >= 750,
            }), { message: 'animated widget API requests did not settle', timeout: 10_000 })
              .toEqual({ pending: 0, quiet: true });
            await waitForNoVisibleActivity(page);
            await page.evaluate(async () => { await document.fonts.ready; });
            let previous = '';
            let stableSamples = 0;
            await expect.poll(async () => {
              // Ambient transforms intentionally mutate markup; layout and content must still settle.
              const signature = await page.evaluate(() => JSON.stringify(
                [...document.querySelectorAll('[data-widget-id]')].map(element => {
                  const bounds = element.getBoundingClientRect();
                  return [element.textContent, bounds.x, bounds.y, bounds.width, bounds.height];
                }),
              ));
              stableSamples = signature === previous ? stableSamples + 1 : 0;
              previous = signature;
              return stableSamples;
            }, { message: 'animated widget content/layout did not settle',
              intervals: [150, 150, 150, 150, 150, 150, 150, 150] }).toBeGreaterThanOrEqual(5);
          } else {
            await waitForHarnessReady(page, mocks);
          }
        } catch (error) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.start');
          await new Promise(resolve => setTimeout(resolve, 500));
          interface ProfileNode {
            id: number;
            hitCount?: number;
            callFrame: {
              functionName: string;
              url: string;
              lineNumber: number;
              columnNumber: number;
            };
          }
          const profile: { profile: { nodes: ProfileNode[]; samples?: number[] } } = await cdp.send('Profiler.stop');
          const sampleCounts = new Map<number, number>();
          for (const sample of profile.profile.samples ?? []) {
            sampleCounts.set(sample, (sampleCounts.get(sample) ?? 0) + 1);
          }
          await test.info().attach('dashboard-stall-cpu.json', {
            body: Buffer.from(JSON.stringify(profile.profile.nodes
              .map(node => ({ ...node, hitCount: sampleCounts.get(node.id) ?? node.hitCount ?? 0 }))
              .filter(node => (node.hitCount ?? 0) > 0)
              .sort((left, right) => (right.hitCount ?? 0) - (left.hitCount ?? 0))
              .slice(0, 40), null, 2)),
            contentType: 'application/json',
          });
          const retryCache: { result: { objectId?: string } } = await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const element = document.getElementById('root');
              const key = Object.keys(element).find(name => name.startsWith('__reactContainer$'));
              const root = element[key].stateNode.current;
              function find(fiber) {
                if (!fiber) return null;
                if (fiber.tag === 13 && fiber.memoizedState !== null) return fiber.stateNode;
                return find(fiber.child) || find(fiber.sibling);
              }
              return find(root);
            })()`,
          });
          interface RemoteProperties {
            result: { name: string; value?: { objectId?: string; description?: string; value?: unknown } }[];
            internalProperties?: { name: string; value?: { objectId?: string; description?: string; value?: unknown } }[];
          }
          const retries: RemoteProperties[] = [];
          if (retryCache.result.objectId) {
            const cache: RemoteProperties = await cdp.send('Runtime.getProperties', { objectId: retryCache.result.objectId });
            retries.push(cache);
            const entries = cache.internalProperties?.find(property => property.name === '[[Entries]]')?.value?.objectId;
            if (entries) {
              const items: RemoteProperties = await cdp.send('Runtime.getProperties', { objectId: entries });
              for (const item of items.result.filter(property => /^\d+$/.test(property.name))) {
                if (!item.value?.objectId) continue;
                const entry: RemoteProperties = await cdp.send('Runtime.getProperties', { objectId: item.value.objectId });
                const promise = entry.result.find(property => property.name === 'value')?.value?.objectId;
                if (promise) retries.push(await cdp.send('Runtime.getProperties', { objectId: promise }));
              }
            }
          }
          await cdp.detach();
          const path = test.info().outputPath('dashboard-settlement.json');
          await writeFile(path, JSON.stringify({
            seen: [...mocks.seen], unmatched: [...mocks.unmatched],
            pending: mocks.pending, requests: mocks.requests,
            diagnostics,
            retries,
            resources: await page.evaluate(() => performance.getEntriesByType('resource')
              .map(entry => ({ name: entry.name, start: entry.startTime, duration: entry.duration }))),
            react: await page.evaluate(() => {
              const record = (value: unknown): value is Record<string, unknown> =>
                typeof value === 'object' && value !== null;
              const element = document.getElementById('root');
              if (!element) return { error: 'Missing React root element' };
              const key = Object.keys(element).find(name => name.startsWith('__reactContainer$'));
              if (!key) return { error: 'Missing React root container' };
              const container: unknown = Reflect.get(element, key);
              if (!record(container) || !record(container.stateNode)) {
                return { error: 'Invalid React root container' };
              }
              const root = container.stateNode;
              const suspensions: Record<string, unknown>[] = [];
              const pendingLazy: Record<string, unknown>[] = [];
              const visited = new Set<object>();
              const walk = (value: unknown, ancestors: string[]) => {
                if (!record(value) || visited.has(value)) return;
                visited.add(value);
                const name = typeof value.type === 'function' ? value.type.name
                  : typeof value.type === 'string' ? value.type : `tag:${String(value.tag)}`;
                if (value.tag === 13 && value.memoizedState !== null) {
                  suspensions.push({
                    ancestors, state: value.memoizedState,
                    retryCache: Object.prototype.toString.call(value.stateNode),
                    queue: Object.prototype.toString.call(value.updateQueue),
                    childTag: record(value.child) ? value.child.tag : null,
                  });
                }
                if (record(value.elementType) && record(value.elementType._payload)
                  && value.elementType._payload._status === 0) {
                  pendingLazy.push({ ancestors, name, tag: value.tag });
                }
                walk(value.child, [...ancestors, name]);
                walk(value.sibling, ancestors);
              };
              walk(root.current, []);
              if (record(root.current)) walk(root.current.alternate, ['alternate']);
              return {
                pendingLanes: root.pendingLanes, suspendedLanes: root.suspendedLanes,
                callbackPriority: root.callbackPriority, suspensions, pendingLazy,
                callback: record(root.callbackNode) ? {
                  id: root.callbackNode.id,
                  priorityLevel: root.callbackNode.priorityLevel,
                  startTime: root.callbackNode.startTime,
                  expirationTime: root.callbackNode.expirationTime,
                  callbackType: typeof root.callbackNode.callback,
                } : null,
                now: performance.now(), visibility: document.visibilityState,
                focused: document.hasFocus(),
              };
            }),
            locale: await page.evaluate(async () => {
              const record = (value: unknown): value is Record<string, unknown> =>
                typeof value === 'object' && value !== null;
              const asset = performance.getEntriesByType('resource')
                .find(entry => entry.name.includes('/vendor-i18n-'));
              if (!asset) return { error: 'Missing loaded i18n module' };
              const exports: unknown = await import(asset.name);
              if (!record(exports)) return { error: 'Invalid i18n module' };
              const instance = Object.values(exports).find(value => record(value) && value.isInitialized === true);
              if (!record(instance) || typeof instance.hasLoadedNamespace !== 'function') {
                return { error: 'Missing initialized i18n instance' };
              }
              return {
                language: instance.language, languages: instance.languages,
                changingTo: instance.isLanguageChangingTo,
                dashboardReady: Boolean(instance.hasLoadedNamespace('dashboard')),
                translationReady: Boolean(instance.hasLoadedNamespace('translation')),
                namespaces: record(instance.options) ? instance.options.ns : null,
                backend: record(instance.services) && record(instance.services.backendConnector)
                  ? Boolean(instance.services.backendConnector.backend) : null,
              };
            }),
          }, null, 2));
          await test.info().attach('dashboard-settlement.json', {
            path,
            contentType: 'application/json',
          });
          throw error;
        }
        await test.info().attach('widget-source-contracts.json', {
          body: Buffer.from(JSON.stringify({
            seen: [...mocks.seen].sort(), unmatched: [...mocks.unmatched].sort(),
          }, null, 2)),
          contentType: 'application/json',
        });
        await assertMockApiComplete(page, mocks);
        await expect(page.getByRole('button', { name: 'Switch dashboard layout' })).toContainText(dashboard.name);
        const catalogueAudit = batch.startsWith('catalogue-') || ['battery', 'energy-remaining', 'driving', 'vehicle'].includes(batch);
        const check = catalogueAudit ? expect.soft : expect;
        for (const widget of widgets) {
          const panel = page.locator(`[data-widget-id="${widget.id}"] > .widget-panel`);
          const heroMigrationRegression = batch === 'vehicle' && width === 1440 && widget.widgetId === 'vehicle-hero';
          if (heroMigrationRegression) {
            await assertCatalogueHeroMigration(page, panel, test.info(), `${widget.widgetId}-${width}-${theme}.png`);
          } else {
            await positionCataloguePanel(panel);
          }
          await expect(panel).toBeVisible();
          const heading = panel.getByRole('heading').first();
          const hasHeading = await heading.isVisible();
          if (catalogueAudit) {
            check(hasHeading, `${widget.widgetId}: visible widget heading`).toBe(true);
          } else {
            await expect(heading).toBeVisible();
          }
          if (hasHeading || !catalogueAudit) {
            const headingBounds = await heading.boundingBox();
            if (!headingBounds) throw new Error(`${widget.widgetId}: missing visible widget title bounds`);
            check(headingBounds.height, `${widget.widgetId}: widget identity must not be visually hidden`).toBeGreaterThan(10);
          }
          await check(panel.getByRole('alert')).toHaveCount(0);
          await check(panel).not.toContainText('failed to load');
          const reading = await panel.evaluate(element => ({
            text: element.textContent?.trim() ?? '',
            clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            height: element.getBoundingClientRect().height,
          }));
          if (batch.startsWith('catalogue-')) await assertRemainingContent(panel, widget.widgetId, width, test.info());
          if (widget.widgetId === 'charge-history') {
            await assertCatalogueChargeHistory(page, panel, width, theme, test.info());
          }
          if (widget.widgetId === 'charge-session-chart') {
            const detail = page.locator('[data-widget-id="review-charging-session-detail"] > .widget-panel');
            await assertCatalogueChargeCategories(page, panel, detail, width, theme, test.info());
          }
          if (['charge-cost-tracker', 'speed-heatmap', 'drive-efficiency-chart'].includes(widget.widgetId)) {
            await assertCatalogueCountReference(page, panel, widget.widgetId, width, theme, test.info());
          }
          if (widget.widgetId === 'fleet-stats-bar') {
            await expect(panel.getByText('1', { exact: true })).toHaveCount(2);
            await expect(panel.getByText('1 online', { exact: true })).toBeVisible();
            await expect(panel.getByText('100.00%', { exact: true })).toBeVisible();
            await expect(panel).not.toContainText(/\bno change\b/i);
            const labels = await panel.locator('[aria-label], [aria-valuetext]').evaluateAll(elements =>
              elements.map(element => ({
                label: element.getAttribute('aria-label'), valueText: element.getAttribute('aria-valuetext'),
              })));
            expect(JSON.stringify(labels), 'Current fleet counts must not announce invented comparison').not.toMatch(/\bno change\b/i);
            await writeFile(test.info().outputPath('fleet-current-caption-contract.json'), JSON.stringify({
              currentCount: 1, currentOnlinePercentage: 100, text: await panel.textContent(), labels,
            }, null, 2));
          }
          const expected = (width === 390 ? remainingCompactReadings[widget.widgetId] ?? compactVehicleReadings[widget.widgetId] : undefined)
            ?? readings[widget.widgetId];
          const geometryContract = geometrySourceIDs.has(widget.widgetId);
          if (!expected && !geometryContract) throw new Error(`Missing sourced reading assertion: ${widget.widgetId}`);
          if (expected) await check(panel).toContainText(expected);
          {
            await writeFile(test.info().outputPath(`${widget.widgetId}-content.json`), JSON.stringify({
              widgetId: widget.widgetId, expected: expected?.source ?? 'Explicit source-bound map geometry; see source-geometry.json',
              actual: await panel.textContent(),
              readingMatched: geometryContract || expected?.test(await panel.textContent() ?? ''), hasHeading,
              alerts: await panel.getByRole('alert').count(), batch, motion, theme, width,
            }, null, 2));
          }
          if (batch === 'battery' || batch === 'energy-remaining' || batch === 'driving' || widget.widgetId === 'motor-performance') {
            await assertCatalogueAllocation(panel, widget.widgetId, test.info());
          }
          const def = getWidgetDef(widget.widgetId);
          if (!def) throw new Error(`Missing axis contract registry entry: ${widget.widgetId}`);
          await assertCatalogueAffectedAxes(panel, widget.widgetId, {
            cols: Math.min(width === 390 ? 1 : 4, batch === 'axis-wide-dynamics' ? 3 : def.defaultSize.cols),
            rows: def.defaultSize.rows,
          }, test.info());
          if (widget.widgetId === 'speed-profile' && width === 1440) {
            await assertSpeedProfileTickBounds(panel, test.info());
          }
          if (widget.widgetId === 'motor-history' && width === 1440) {
            await expect(panel.locator('.recharts-yAxis')).toHaveCount(2);
            await expect(panel.locator('.recharts-line-curve')).toHaveCount(2);
            await expect(panel).toContainText('Torque');
            await expect(panel).toContainText('Stator');
            await expect(panel).toContainText('65.00');
            for (const curve of await panel.locator('.recharts-line-curve').all()) {
              expect(await curve.getAttribute('d'), 'Motor torque/temperature curve must contain real points').toMatch(/^M.+/);
            }
          }
          if (batch.startsWith('vehicle-twin')) {
            if (widget.widgetId === 'vehicle-twin') {
              await expect(panel).toContainText(batch === 'vehicle-twin-charging' ? 'Charging' : 'Driving');
            }
            await assertTwinWheelAndPhotoGeometry(panel, widget.widgetId, motion, batch !== 'vehicle-twin-charging',
              batch === 'vehicle-twin-svg', test.info());
            await expect(panel).toContainText('Sentry');
            const captured = await captureCatalogueTwinFrames(panel, batch === 'vehicle-twin-charging');
            const geometry = captured.geometry;
            await writeFile(test.info().outputPath(`${widget.widgetId}-frames.json`), JSON.stringify(captured, null, 2));
            await writeFile(test.info().outputPath(`${widget.widgetId}-geometry.json`), JSON.stringify(geometry, null, 2));
            await test.info().attach(`${widget.widgetId}-frames.json`, {
              path: test.info().outputPath(`${widget.widgetId}-frames.json`), contentType: 'application/json',
            });
            await test.info().attach(`${widget.widgetId}-geometry.json`, {
              body: Buffer.from(JSON.stringify(geometry)), contentType: 'application/json',
            });
            for (let index = 0; index < geometry[0].length; index++) {
              const frames = geometry.map(sample => sample[index]);
              for (const frame of frames) {
                expect(Number.isFinite(frame.rx) && Number.isFinite(frame.ry)).toBe(true);
                expect(frame.rx).toBe(index === 0 ? 16 : 190);
                expect(frame.ry).toBe(index === 0 ? 7 : 16);
                expect(Number.isFinite(frame.x) && Number.isFinite(frame.y)).toBe(true);
                for (const radius of frame.circles) {
                  expect(Number.isFinite(radius) && radius >= 0, 'SVG circle radius must stay finite').toBe(true);
                }
              }
              expect(Math.max(...frames.map(frame => frame.x)) - Math.min(...frames.map(frame => frame.x)),
                'Animated geometry must retain its horizontal center').toBeLessThanOrEqual(1);
              expect(Math.max(...frames.map(frame => frame.y)) - Math.min(...frames.map(frame => frame.y)),
                'Animated geometry must retain its vertical center').toBeLessThanOrEqual(1);
              if (motion === 'no-preference') {
                expect(new Set(frames.map(frame => frame.transform)).size, 'Actual animation frames must change').toBeGreaterThan(1);
              }
            }
          }
          if (width === 1440 && widget.widgetId === 'system-health') {
            await expect(panel.getByText('Healthy', { exact: true })).toHaveCount(4);
          }
          if (width === 1440 && widget.widgetId === 'uptime-monitor') {
            await expect(panel.getByText('OK', { exact: true })).toHaveCount(4);
          }
          if (width === 1440 && widget.widgetId === 'energy-stats') {
            await expect.poll(async () => {
              const chartBounds = await panel.locator('svg.recharts-surface').boundingBox();
              const metricBounds = await panel.getByText('Total used', { exact: true }).boundingBox();
              if (!chartBounds || !metricBounds) throw new Error('Energy chart and summary must both render');
              return chartBounds.y + chartBounds.height - metricBounds.y;
            }, { message: 'Energy chart must not overlap summary metrics' }).toBeLessThanOrEqual(1);
          }
          check(reading.height, widget.widgetId).toBeGreaterThan(60);
          check(reading.scrollWidth, `${widget.widgetId}: ${JSON.stringify(reading)}`)
            .toBeLessThanOrEqual(reading.clientWidth + 1);
          if (!heroMigrationRegression) {
            await captureCataloguePanel(page, panel, test.info(), `${widget.widgetId}-${width}-${theme}.png`);
          }
        }
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
        } finally {
          await writeFile(test.info().outputPath('page-diagnostics.json'), JSON.stringify(diagnostics, null, 2));
          await attachDiagnostics(test.info(), diagnostics);
        }
      });
    }
    }
  }
}
