import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { captureCataloguePanel, positionCataloguePanel } from './dashboardCatalogueCapture';
import { assertCatalogueYAxisTickBounds } from './dashboardCatalogueGeometry';

const records = new WeakMap<Page, { pending: Set<Promise<void>>; responses: Array<{ url: string; body: unknown }>; errors: string[] }>();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const data = (value: unknown) => object(value) && 'data' in value ? value.data : value;

export function recordCatalogueChargeHistorySources(page: Page) {
  const state = { pending: new Set<Promise<void>>(), responses: [] as Array<{ url: string; body: unknown }>, errors: [] as string[] };
  records.set(page, state);
  page.on('response', response => {
    if (!['/api/v1/charging', '/api/v1/charging-sessions', '/api/v1/charging/701',
      '/api/v1/settings', '/api/v1/vehicles', '/api/v1/drives',
      '/api/v1/tire-pressure/latest'].includes(new URL(response.url()).pathname)) return;
    const task = (async () => {
      if (!response.ok()) throw new Error(`Charge source HTTP ${response.status()}: ${response.url()}`);
      state.responses.push({ url: response.url(), body: await response.json() });
    })().catch((error: unknown) => {
      state.errors.push(error instanceof Error ? error.message : String(error));
    });
    state.pending.add(task);
    void task.finally(() => state.pending.delete(task));
  });
  return state;
}

export function catalogueRecordedSources(page: Page) {
  const state = records.get(page);
  if (!state) throw new Error('Missing pre-navigation catalogue source recorder');
  return state;
}

export interface CatalogueChargeQueryBinding {
  widgetId: string;
  boundaryReached: boolean;
  componentDepth: number;
  vehiclePropType: string;
  vehicleProp: unknown;
  hookIndex: number;
  queryKey: unknown;
  status: unknown;
  data: unknown;
  detailList?: { widgetId: string; componentDepth: number; queryKey: unknown; status: unknown; data: unknown };
}

export function assertCatalogueChargeQueryBinding(binding: CatalogueChargeQueryBinding,
  widgetId: string, kind: 'chart' | 'detail', source: Record<string, unknown>) {
  assertCatalogueQueryScope(binding, widgetId,
    kind === 'chart' ? ['charging', 7, 'session-chart-10'] : ['charging-session', 701]);
  const sessions = kind === 'chart' ? binding.data : [binding.data];
  if (!Array.isArray(sessions) || sessions.length !== 1 || !object(sessions[0])) {
    throw new Error('Native source observer must preserve the original single session');
  }
  const rendered = sessions[0];
  expect(sessions.map(row => object(row) ? row.id : null), 'Native source session order/identity must remain701').toEqual([701]);
  expect(Object.fromEntries(Object.keys(source).map(key => [key, rendered[key]])),
    'Native observer must preserve every wire source field/null').toEqual(source);
  if (kind === 'detail') {
    if (!binding.detailList) throw new Error('Detail source component must also own its vehicle7 list observer');
    expect(binding.detailList.widgetId, 'Detail list observer cannot come from another widget').toBe(widgetId);
    expect(binding.detailList.componentDepth, 'Detail list and detail observers must belong to SAME source component')
      .toBe(binding.componentDepth);
    expect(binding.detailList.queryKey, 'Detail list must prove selected vehicle7').toEqual(['charging-sessions', 'vehicle', '7']);
    expect(binding.detailList.status).toBe('success');
    if (!Array.isArray(binding.detailList.data) || binding.detailList.data.length !== 1
      || !object(binding.detailList.data[0])) throw new Error('Detail list source must preserve single session701');
    const listed = binding.detailList.data[0];
    expect(Object.fromEntries(Object.keys(source).map(key => [key, listed[key]])),
      'Detail list must preserve every wire field/null').toEqual(source);
  }
}

export function assertCatalogueQueryScope(binding: CatalogueChargeQueryBinding,
  widgetId: string, queryKey: readonly unknown[]) {
  expect(binding.widgetId, 'Charge observer must belong to the exact same widget').toBe(widgetId);
  expect(binding.boundaryReached, 'Charge observer traversal must end at its own widget boundary').toBe(true);
  expect(binding.queryKey, 'Source component must own the exact charge query key')
    .toEqual(queryKey);
  if (binding.vehiclePropType === 'undefined') {
    expect(binding.vehicleProp, 'Undefined vehicle prop is allowed only with exact observer-proven scope7').toBeNull();
  } else {
    expect(binding.vehiclePropType).toBe('number');
    expect(binding.vehicleProp, 'Explicit source vehicle prop must be7').toBe(7);
  }
  expect(binding.status, 'Native source observer must have successful data').toBe('success');
}

export async function renderedChargeBinding(panel: Locator, widgetId: string, kind: 'chart' | 'detail') {
  return renderedCatalogueQueryBinding(panel, widgetId,
    kind === 'chart' ? 'Charge sessions' : 'Charge session detail',
    kind === 'chart' ? ['charging', 7, 'session-chart-10'] : ['charging-session', 701],
    kind === 'detail' ? ['charging-sessions', 'vehicle', '7'] : undefined);
}

export async function renderedCatalogueQueryBinding(panel: Locator, widgetId: string, title: string,
  expectedKey: readonly unknown[], detailListKey?: readonly unknown[]) {
  const heading = panel.getByRole('heading', { name: title, exact: true }).and(panel.locator('h3:not(.sr-only)'));
  await expect(heading).toHaveCount(1);
  await expect(heading).toBeVisible();
  const measured = await heading.evaluate((element, { widgetId, expectedKey, detailListKey }) => {
    const object = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    if (!key) throw new Error('Charge widget has no native React source binding');
    const boundary = element.closest('[data-widget-id]');
    if (!boundary || boundary.getAttribute('data-widget-id') !== widgetId) {
      throw new Error('Native charge heading belongs to a different widget boundary');
    }
    let fiber: unknown = Reflect.get(element, key);
    let boundaryReached = false;
    const bindings: CatalogueChargeQueryBinding[] = [];
    for (let depth = 0; object(fiber) && depth < 80; depth++, fiber = fiber.return) {
      if (fiber.stateNode === boundary) {
        boundaryReached = true;
        break;
      }
      const props = fiber.memoizedProps;
      if (fiber.tag !== 0 || !object(props) || !object(props.size)
        || !Object.prototype.hasOwnProperty.call(props, 'vehicleId')) continue;
      let hook: unknown = fiber.memoizedState;
      const seen = new Set<unknown>();
      const observers = [];
      for (let index = 0; object(hook); index++, hook = hook.next) {
        if (seen.has(hook)) throw new Error('Native charge source hook chain contains a cycle');
        seen.add(hook);
        const state = hook.memoizedState;
        if (!object(state) || typeof state.getCurrentQuery !== 'function'
          || typeof state.getCurrentResult !== 'function') continue;
        const query: unknown = state.getCurrentQuery.call(state);
        const result: unknown = state.getCurrentResult.call(state);
        if (!object(query) || !object(result)) throw new Error('Malformed native public charge observer');
        observers.push({ hookIndex: index, queryKey: query.queryKey, status: result.status, data: result.data });
      }
      const matched = observers.filter(observer => JSON.stringify(observer.queryKey) === JSON.stringify(expectedKey));
      for (const observer of matched) {
        const list = observers.find(observer =>
          detailListKey && JSON.stringify(observer.queryKey) === JSON.stringify(detailListKey));
        bindings.push({
          widgetId, boundaryReached: false, componentDepth: depth,
          vehiclePropType: typeof props.vehicleId, vehicleProp: props.vehicleId ?? null,
          ...observer,
          detailList: list ? { widgetId, componentDepth: depth, ...list } : undefined,
        });
      }
    }
    return { boundaryReached, bindings };
  }, { widgetId, expectedKey, detailListKey });
  expect(measured.boundaryReached, 'Source observer walk must never cross its own widget boundary').toBe(true);
  expect(measured.bindings, 'Exactly one source component must own the exact charge observer key').toHaveLength(1);
  const binding = measured.bindings[0];
  if (!binding) throw new Error('Missing exact native charge source observer');
  return { ...binding, boundaryReached: measured.boundaryReached };
}

export async function assertCatalogueChargeCategories(page: Page, chart: Locator, detail: Locator,
  width: number, theme: string, info: TestInfo) {
  const state = records.get(page);
  if (!state) throw new Error('Missing pre-navigation charge category recorder');
  await Promise.all([...state.pending]);
  if (state.errors.length) throw new Error(`Charge category provenance failed: ${state.errors.join('; ')}`);
  const served = state.responses.filter(response => new URL(response.url).pathname === '/api/v1/charging');
  if (!served.length) throw new Error('No actually served charge category session source');
  const original = data(served[0].body);
  if (!Array.isArray(original) || original.length !== 1 || !object(original[0])) {
    throw new Error('Charge category requires original single-session source');
  }
  const session = original[0];
  expect(session.id).toBe(701);
  expect(session.vehicle_id).toBe(7);
  expect(session.charger_type).toBe('AC');
  expect(session.total_energy_added_wh).toBe(42000);
  for (const response of served) {
    expect(data(response.body), 'Every actual charging source preserves same session/order/payload').toEqual(original);
  }
  const chartBinding = await renderedChargeBinding(chart, 'review-charge-session-chart', 'chart');
  const detailBinding = await renderedChargeBinding(detail, 'review-charging-session-detail', 'detail');
  assertCatalogueChargeQueryBinding(chartBinding, 'review-charge-session-chart', 'chart', session);
  assertCatalogueChargeQueryBinding(detailBinding, 'review-charging-session-detail', 'detail', session);
  await expect(detail.getByText('AC / home', { exact: true })).toHaveCount(1);
  await positionCataloguePanel(chart);
  await assertCatalogueYAxisTickBounds(chart, 'charge-session-chart', info);
  await expect(chart).toContainText('42.00');
  await expect(chart.getByText('Unknown', { exact: true })).toHaveCount(0);
  const paths = chart.locator('.recharts-bar-rectangle .recharts-rectangle');
  const bars = await paths.evaluateAll(nodes => nodes.map(node => {
    const object = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
    let fiber: unknown = key ? Reflect.get(node, key) : null;
    const box = node.getBoundingClientRect();
    for (let depth = 0; object(fiber) && depth < 30; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (object(props) && object(props.payload) && props.dataKey === 'energy') {
        return { dataKey: props.dataKey, payload: props.payload, value: props.value,
          point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
          width: box.width, height: box.height };
      }
    }
    return null;
  }));
  const home = bars.filter(bar => bar !== null && bar.height > 0 && bar.width > 0);
  expect(home, 'Actual nonzero rendered source bar must be home, never DC guess').toHaveLength(1);
  const bar = home[0];
  if (!bar) throw new Error('Missing actually rendered home bar');
  expect(bar.payload.type).toBe('home');
  expect(bar.payload.energy).toBe(42);
  expect(bar.value).toBe(42);
  await page.mouse.move(bar.point.x, bar.point.y);
  const tooltip = chart.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  const homeLabel = tooltip.getByText('Home / AC:', { exact: true });
  await expect(homeLabel).toBeVisible();
  const homeRow = homeLabel.locator('..');
  await expect(homeRow).toContainText('42');
  await expect(homeRow).toContainText('kWh');
  const tooltipText = await tooltip.textContent();
  await captureCataloguePanel(page, chart, info, `charge-session-category-tooltip-${width}-${theme}.png`);
  await expect(homeRow).toContainText('42');
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
  await writeFile(info.outputPath('charge-session-category-contract.json'), JSON.stringify({
    served, originalSessionOrder: [701], unchangedOriginalEnergyWh: 42000,
    chartBinding, detailBinding, actualHomeBar: bar, tooltipText, width, theme,
    unknownBrowserCoverage: 'NOT_EXERCISED_ORIGINAL_AC_SOURCE_ONLY; parent91 source tests retained, not browser acceptance',
    noFixturePayloadMutation: true,
  }, null, 2));
}

export async function assertCatalogueChargeHistory(page: Page, panel: Locator, width: number, theme: string, info: TestInfo) {
  const state = records.get(page);
  if (!state) throw new Error('Missing pre-navigation charge source recorder');
  await Promise.all([...state.pending]);
  if (state.errors.length) throw new Error(`Charge source provenance failed: ${state.errors.join('; ')}`);
  const charge = state.responses.filter(response => {
    const url = new URL(response.url);
    return url.pathname === '/api/v1/charging' && url.searchParams.get('limit') === '10'
      && url.searchParams.get('vehicle_id') === '7';
  }).slice(-1)[0];
  const settings = data(state.responses.filter(response => new URL(response.url).pathname === '/api/v1/settings').slice(-1)[0]?.body);
  const vehicles = data(state.responses.filter(response => new URL(response.url).pathname === '/api/v1/vehicles').slice(-1)[0]?.body);
  const sessions = data(charge?.body);
  if (!Array.isArray(sessions) || sessions.length !== 1 || !object(sessions[0])
    || !object(settings) || !Array.isArray(vehicles)) throw new Error('Missing original single-session/date preference source');
  const session: Record<string, unknown> = sessions[0];
  const vehicle: unknown = vehicles.find(value => object(value) && value.id === 7);
  if (!object(vehicle) || typeof session.started_at !== 'string' || typeof settings.locale !== 'string'
    || typeof vehicle.timezone !== 'string' || settings.tz_display_default !== 'vehicle') {
    throw new Error('Unproved charge timestamp/selected date preferences');
  }
  expect(session.total_energy_added_wh, 'Original42000Wh source must not change').toBe(42000);
  const locale = settings.locale;
  const timezone = vehicle.timezone;
  const expectedDate = await page.evaluate(({ instant, locale, timezone }) => new Date(instant).toLocaleString(locale, {
    timeZone: timezone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }), { instant: session.started_at, locale, timezone });
  await expect(panel).toContainText('42.00');
  const contract: Record<string, unknown> = { source: charge, settings, vehicle, locale, timezone,
    expectedDate, width, theme, compact: width === 390, originalSessionCount: 1,
    nullZeroSemantics: 'Payload untouched; no synthetic zero/null replacement; existing state contracts retained' };
  if (width === 390) {
    await expect(panel.locator('svg.recharts-surface')).toHaveCount(0);
    contract.axisTooltip = 'NOT_APPLICABLE_COMPACT_SUMMARY_NO_CHART';
  } else {
    await positionCataloguePanel(panel);
    await assertCatalogueYAxisTickBounds(panel, 'charge-history', info);
    const tick = panel.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value');
    await expect(tick).toHaveText([expectedDate]);
    await expect(panel.getByRole('img', { name: 'Energy added per recent charge session, in kilowatt-hours', exact: true })).toBeVisible();
    const point = await tick.evaluate(node => {
      const svg = node.closest('svg');
      if (!svg) throw new Error('Date tick has no real SVG');
      const glyph = node.getBoundingClientRect();
      const chart = svg.getBoundingClientRect();
      return { x: glyph.left + glyph.width / 2, y: chart.top + chart.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    const tooltip = panel.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('p').first()).toHaveText(expectedDate);
    await expect(tooltip).toContainText('42');
    await expect(tooltip).toHaveAttribute('aria-live', 'polite');
    contract.tickTexts = await tick.allTextContents();
    contract.tooltipText = await tooltip.textContent();
    contract.accessibilitySnapshot = await panel.ariaSnapshot();
    contract.nativeHoverPoint = point;
    await captureCataloguePanel(page, panel, info, `charge-history-date-tooltip-${width}-${theme}.png`);
    await expect(tooltip.locator('p').first()).toHaveText(expectedDate);
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
    contract.axisTooltip = 'ACTUAL_DATE_TICK_AND_NATIVE_MOUSE_TOOLTIP_PASSED';
  }
  await writeFile(info.outputPath('charge-history-date-contract.json'), JSON.stringify(contract, null, 2));
}
