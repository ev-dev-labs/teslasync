import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { DashboardLayoutsPayload } from '../src/api/hooks/useSettings';
import type { RGLLayouts, SavedDashboard } from '../src/features/dashboard/widgets/types';
import { getWidgetDef } from '../src/features/dashboard/widgets/registry';
import {
  assertMockApiComplete, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady,
} from './mockApi';
import { expectNoHorizontalOverflow, expectNoRuntimeFailures, monitorPage } from './qualityAssertions';
import { installDashboardWidgetSources } from './dashboardWidgetFixtures';

test.skip(process.env.E2E_MOCKS === '0', 'Requires synthetic dashboard source fixtures');

const batches = {
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
  'energy-stats': /15(?:\.0)?/,
  'energy-flow-animated': /14\.0\s*kW/,
  'power-flow-history': /3\.9\s*kW/,
  'solar-production': /12\.0/,
  'energy-site-info': /13\.5\s*kWh/,
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
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [390, 1440]) {
      test(`${batch} widgets retain real content and fit at ${width}px in ${theme}`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        await seedBrowserState(page, theme, '/');
        const widgets = ids.map(widgetId => ({ id: `review-${widgetId}`, widgetId }));
        const layouts: RGLLayouts = {};
        for (const [breakpoint, columns] of Object.entries({ lg: 4, md: 3, sm: 2, xs: 1 })) {
          layouts[breakpoint] = widgets.map((widget, index) => {
            const def = getWidgetDef(widget.widgetId);
            if (!def) throw new Error(`Unregistered review widget: ${widget.widgetId}`);
            return {
              i: widget.id, x: 0, y: index * 8,
              w: Math.min(columns, def.defaultSize.cols), h: def.defaultSize.rows,
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
        await installDashboardWidgetSources(page, mocks);
        await page.route('**/api/v1/settings/dashboard-layouts', route => fulfillApiFixture(route, mocks, {
          json: { dashboards: [dashboard], active_id: dashboard.id } satisfies DashboardLayoutsPayload,
        }));
        const diagnostics = monitorPage(page);
        await page.goto('/');
        try {
          await waitForHarnessReady(page, mocks);
        } catch (error) {
          const cdp = await page.context().newCDPSession(page);
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
        for (const widget of widgets) {
          const panel = page.locator(`[data-widget-id="${widget.id}"] > .widget-panel`);
          await panel.scrollIntoViewIfNeeded();
          await panel.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
          await expect(panel).toBeVisible();
          const heading = panel.getByRole('heading').first();
          await expect(heading).toBeVisible();
          const headingBounds = await heading.boundingBox();
          if (!headingBounds) throw new Error(`${widget.widgetId}: missing visible widget title bounds`);
          expect(headingBounds.height, `${widget.widgetId}: widget identity must not be visually hidden`).toBeGreaterThan(10);
          await expect(panel.getByRole('alert')).toHaveCount(0);
          await expect(panel).not.toContainText('failed to load');
          const reading = await panel.evaluate(element => ({
            text: element.textContent?.trim() ?? '',
            clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            height: element.getBoundingClientRect().height,
          }));
          const expected = readings[widget.widgetId];
          if (!expected) throw new Error(`Missing sourced reading assertion: ${widget.widgetId}`);
          await expect(panel).toContainText(expected);
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
          expect(reading.height, widget.widgetId).toBeGreaterThan(60);
          expect(reading.scrollWidth, `${widget.widgetId}: ${JSON.stringify(reading)}`)
            .toBeLessThanOrEqual(reading.clientWidth + 1);
          await panel.screenshot({ path: test.info().outputPath(`${widget.widgetId}-${width}-${theme}.png`) });
        }
        await expectNoHorizontalOverflow(page);
        await expectNoRuntimeFailures(diagnostics);
        await assertMockApiComplete(page, mocks);
      });
    }
  }
}
