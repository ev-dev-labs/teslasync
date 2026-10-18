import { expect, test } from '@playwright/test';
import { prepareCatalogueState } from './dashboardCatalogueStateHarness';
import { assertMockApiComplete, waitForHarnessReady } from './mockApi';
import { positionCataloguePanel } from './dashboardCatalogueCapture';
import { assertCatalogueChargeQueryBinding, type CatalogueChargeQueryBinding } from './dashboardCatalogueChargeHistory';

let chart: CatalogueChargeQueryBinding;
let detail: CatalogueChargeQueryBinding;
let source: Record<string, unknown>;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  // Self-sufficient: collect actual native observer evidence in this worker
  // instead of requiring an E2E_CHARGE_BINDING_EVIDENCE file that no CI job
  // produces. Same collection procedure as the charger-query diagnostic, so
  // every binding below still asserts against real rendered hook state.
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: process.env.E2E_MOCKS === '0' ? 'allow' : 'block',
  });
  const page = await context.newPage();
  try {
    const mocks = await prepareCatalogueState(page, [
      'charge-status', 'charge-status-live', 'charge-history', 'charge-session-chart',
      'charge-cost-tracker', 'charging-session-detail',
    ], 390, 'light');
    const wire: Array<{ url: string; body: unknown }> = [];
    const errors: string[] = [];
    const pending = new Set<Promise<void>>();
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (!['/api/v1/charging', '/api/v1/charging-sessions', '/api/v1/charging/701'].includes(path)) return;
      const task = (async () => {
        if (!response.ok()) throw new Error(`Binding source HTTP ${response.status()}: ${response.url()}`);
        wire.push({ url: response.url(), body: await response.json() });
      })().catch((error: unknown) => { errors.push(error instanceof Error ? error.message : String(error)); });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
    await page.goto('/');
    await waitForHarnessReady(page, mocks);
    const evidence = [];
    for (const id of ['charge-session-chart', 'charging-session-detail']) {
      const panel = page.locator(`[data-widget-id="state-${id}"] > .widget-panel`);
      await positionCataloguePanel(panel);
      const semanticHeadings = panel.getByRole('heading', {
        name: id === 'charge-session-chart' ? 'Charge sessions' : 'Charge session detail', exact: true,
      });
      if (id === 'charge-session-chart') {
        await expect(semanticHeadings).toHaveCount(2);
        await expect(semanticHeadings.and(panel.locator('h3.sr-only'))).toHaveCount(1);
      }
      const heading = semanticHeadings.and(panel.locator('h3:not(.sr-only)'));
      await expect(heading).toHaveCount(1);
      await expect(heading).toBeVisible();
      evidence.push({ widgetId: id, component: await heading.evaluate((element, expectedWidgetId) => {
        const object = (value: unknown): value is Record<string, unknown> =>
          value !== null && typeof value === 'object' && !Array.isArray(value);
        const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
        if (!key) throw new Error('No native source-component fiber');
        const boundary = element.closest('[data-widget-id]');
        if (!boundary || boundary.getAttribute('data-widget-id') !== expectedWidgetId) {
          throw new Error('Binding heading belongs to a different widget boundary');
        }
        let fiber: unknown = Reflect.get(element, key);
        const candidates = [];
        let boundaryReached = false;
        for (let depth = 0; object(fiber) && depth < 80; depth++, fiber = fiber.return) {
          if (fiber.stateNode === boundary) {
            boundaryReached = true;
            break;
          }
          const props = fiber.memoizedProps;
          {
            const hooks = [];
            let hook: unknown = fiber.memoizedState;
            const seen = new Set<unknown>();
            for (let index = 0; object(hook); index++, hook = hook.next) {
              if (seen.has(hook)) throw new Error('Source component hook chain contains a cycle');
              seen.add(hook);
              const state = hook.memoizedState;
              if (!object(state)) {
                hooks.push({ index, shape: Array.isArray(state) ? 'array' : typeof state,
                  length: Array.isArray(state) ? state.length : null });
                continue;
              }
              const getQuery = state.getCurrentQuery;
              const getResult = state.getCurrentResult;
              const publicObserver = typeof getQuery === 'function' && typeof getResult === 'function';
              const currentQuery: unknown = publicObserver ? getQuery.call(state) : null;
              const currentResult: unknown = publicObserver ? getResult.call(state) : null;
              hooks.push({
                index, ownKeys: Object.keys(state).slice(0, 24), publicObserver,
                queryKey: object(currentQuery) ? currentQuery.queryKey : null,
                queryHash: object(currentQuery) ? currentQuery.queryHash : null,
                status: object(currentResult) ? currentResult.status : null,
                data: object(currentResult) ? currentResult.data : null,
              });
            }
            candidates.push({
              depth, fiberTag: fiber.tag,
              propKeys: object(props) ? Object.keys(props) : [],
              vehicleIdPresent: object(props) && Object.prototype.hasOwnProperty.call(props, 'vehicleId'),
              vehicleIdType: object(props) ? typeof props.vehicleId : 'no-props',
              vehicleId: object(props) ? props.vehicleId ?? null : null,
              size: object(props) ? props.size ?? null : null, hooks, hookChainComplete: true,
            });
          }
        }
        if (!boundaryReached) throw new Error('Binding walk did not reach the same widget boundary');
        const barPayloads = [...boundary.querySelectorAll('.recharts-bar-rectangle .recharts-rectangle')].map(node => {
          const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
          let current: unknown = key ? Reflect.get(node, key) : null;
          for (let depth = 0; object(current) && depth < 30; depth++, current = current.return) {
            const props = current.memoizedProps;
            if (object(props) && object(props.payload)) {
              return { depth, dataKey: props.dataKey, payload: props.payload, value: props.value };
            }
          }
          return null;
        });
        return { startingTag: element.tagName, heading: element.textContent,
          closestWidgetId: boundary.getAttribute('data-widget-id'), boundaryReached, candidates, barPayloads };
      }, `state-${id}`) });
    }
    await Promise.all([...pending]);
    expect(errors).toEqual([]);
    await assertMockApiComplete(page, mocks);
    const object = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const session = wire.find(response => {
      const url = new URL(response.url);
      return url.pathname === '/api/v1/charging' && url.searchParams.get('limit') === '10';
    });
    if (!session || !Array.isArray(session.body) || session.body.length !== 1 || !object(session.body[0])) {
      throw new Error('Missing actual native single-session wire evidence');
    }
    source = session.body[0];
    for (const kind of ['chart', 'detail'] as const) {
      const widget = evidence.find(row =>
        row.widgetId === (kind === 'chart' ? 'charge-session-chart' : 'charging-session-detail'));
      if (!widget) throw new Error('Missing native source widget evidence');
      const expected = kind === 'chart' ? ['charging', 7, 'session-chart-10'] : ['charging-session', 701];
      const matches = widget.component.candidates.flatMap(component => component.hooks
        .filter(hook => hook.publicObserver && JSON.stringify(hook.queryKey) === JSON.stringify(expected))
        .map(hook => ({ component, hook })));
      expect(matches).toHaveLength(1);
      const match = matches[0];
      if (!match || !match.component.hookChainComplete) throw new Error('Incomplete source-component hook evidence');
      const list = match.component.hooks.find(hook =>
        JSON.stringify(hook.queryKey) === JSON.stringify(['charging-sessions', 'vehicle', '7']));
      const binding: CatalogueChargeQueryBinding = {
        widgetId: widget.component.closestWidgetId, boundaryReached: widget.component.boundaryReached,
        componentDepth: match.component.depth, vehiclePropType: match.component.vehicleIdType,
        vehicleProp: match.component.vehicleId, hookIndex: match.hook.index,
        queryKey: match.hook.queryKey, status: match.hook.status, data: match.hook.data,
        detailList: kind === 'detail' && list ? {
          widgetId: widget.component.closestWidgetId, componentDepth: match.component.depth,
          queryKey: list.queryKey, status: list.status, data: list.data,
        } : undefined,
      };
      if (kind === 'chart') chart = binding;
      else detail = binding;
    }
  } finally {
    await context.close();
  }
});

test('actual native chart observer binds exact widget/key/session/full wire source', () => {
  assertCatalogueChargeQueryBinding(chart, 'state-charge-session-chart', 'chart', source);
});

test('actual native detail/list observers bind same source component and selected vehicle7', () => {
  assertCatalogueChargeQueryBinding(detail, 'state-charging-session-detail', 'detail', source);
});

test('undefined vehicle prop policy permits only exact observer-proven fallback scope7', () => {
  const binding = structuredClone(chart);
  binding.vehiclePropType = 'undefined';
  binding.vehicleProp = null;
  assertCatalogueChargeQueryBinding(binding, 'state-charge-session-chart', 'chart', source);
});

for (const [mode, error] of [
  ['widget', /exact same widget/], ['boundary', /own widget boundary/],
  ['key', /exact charge query key/], ['vehicle', /Explicit source vehicle prop/],
  ['session', /session order\/identity/], ['source', /every wire source field/],
  ['energy', /every wire source field/],
] as const) {
  test(`native-derived exact charge binding rejects ${mode}`, () => {
    const binding = structuredClone(chart);
    if (mode === 'widget') binding.widgetId = 'state-charging-session-detail';
    if (mode === 'boundary') binding.boundaryReached = false;
    if (mode === 'key') binding.queryKey = ['charging', 8, 'session-chart-10'];
    if (mode === 'vehicle') binding.vehicleProp = 8;
    if (['session', 'source', 'energy'].includes(mode)) {
      if (!Array.isArray(binding.data) || !binding.data[0]) throw new Error('Native source array missing');
      const session: Record<string, unknown> = binding.data[0];
      if (mode === 'session') session.id = 702;
      if (mode === 'source') session.charger_type = 'DC';
      if (mode === 'energy') session.total_energy_added_wh = 42001;
    }
    expect(() => assertCatalogueChargeQueryBinding(binding, 'state-charge-session-chart', 'chart', source)).toThrow(error);
  });
}

for (const [mode, error] of [
  ['list-key', /selected vehicle7/], ['list-widget', /another widget/], ['list-component', /SAME source component/],
] as const) {
  test(`native-derived detail binding rejects ${mode}`, () => {
    const binding = structuredClone(detail);
    if (!binding.detailList) throw new Error('Native detail list evidence missing');
    if (mode === 'list-key') binding.detailList.queryKey = ['charging-sessions', 'vehicle', '8'];
    if (mode === 'list-widget') binding.detailList.widgetId = 'state-charge-session-chart';
    if (mode === 'list-component') binding.detailList.componentDepth++;
    expect(() => assertCatalogueChargeQueryBinding(binding, 'state-charging-session-detail', 'detail', source)).toThrow(error);
  });
}
