import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  assertCatalogueQueryScope, catalogueRecordedSources, renderedCatalogueQueryBinding,
} from './dashboardCatalogueChargeHistory';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const unwrap = (value: unknown) => object(value) && 'data' in value ? value.data : value;

async function boundSource(page: Page, panel: Locator, widgetId: string, title: string,
  path: string, limit: string, key: readonly unknown[]) {
  const state = catalogueRecordedSources(page);
  await Promise.all([...state.pending]);
  expect(state.errors).toEqual([]);
  const served = state.responses.filter(response => {
    const url = new URL(response.url);
    return url.pathname === `/api/v1${path}` && url.searchParams.get('vehicle_id') === '7'
      && url.searchParams.get('limit') === limit;
  });
  if (!served.length) throw new Error(`No actually served ${widgetId} source`);
  const source = unwrap(served[0].body);
  if (!Array.isArray(source) || source.length !== 1 || !object(source[0])) {
    throw new Error(`${widgetId} original fixture must retain its one record`);
  }
  for (const response of served) expect(unwrap(response.body)).toEqual(source);
  const binding = await renderedCatalogueQueryBinding(panel, widgetId, title, key);
  assertCatalogueQueryScope(binding, widgetId, key);
  if (!Array.isArray(binding.data) || binding.data.length !== 1 || !object(binding.data[0])) {
    throw new Error(`${widgetId} native observer must preserve one source record`);
  }
  const rendered = binding.data[0];
  expect(Object.fromEntries(Object.keys(source[0]).map(field => [field, rendered[field]])),
    'Every native source field/null must match the exact served record').toEqual(source[0]);
  return { served, binding, source: source[0] };
}

export async function assertCatalogueCountReference(page: Page, panel: Locator,
  id: string, width: number, theme: string, info: TestInfo) {
  const widgetId = `review-${id}`;
  if (id === 'charge-cost-tracker') {
    const state = catalogueRecordedSources(page);
    await Promise.all([...state.pending]);
    const response = state.responses.find(value => {
      const url = new URL(value.url);
      return url.pathname === '/api/v1/charging' && url.searchParams.get('limit') === '100'
        && url.searchParams.get('vehicle_id') === '7' && url.searchParams.has('start');
    });
    if (!response) throw new Error('Missing actual cost-tracker timestamped source');
    const start = new URL(response.url).searchParams.get('start');
    if (!start || !Number.isFinite(Date.parse(start))) throw new Error('Invalid actual cost-tracker start');
    const source = await boundSource(page, panel, widgetId, 'Charge cost tracker',
      '/charging', '100', ['charging', 7, 'cost-tracker-30d', start]);
    expect(source.source).toMatchObject({ id: 701, vehicle_id: 7, charger_type: 'AC', total_energy_added_wh: 42000 });
    await expect(panel.getByText('1 session', { exact: true })).toHaveCount(1);
    await expect(panel.getByText('1 session', { exact: true })).toBeVisible();
    await expect(panel.getByText('1 sessions', { exact: true })).toHaveCount(0);
    await writeFile(info.outputPath('cost-count-native-contract.json'), JSON.stringify({ ...source, width, theme }, null, 2));
    return;
  }
  const speed = id === 'speed-heatmap';
  const source = await boundSource(page, panel, widgetId, speed ? 'Speed heatmap' : 'Drive efficiency',
    '/drives', speed ? '200' : '60', ['drives', 7, speed ? 'speed-heatmap' : 'efficiency-chart-60']);
  expect(source.source).toMatchObject({ id: 101, vehicle_id: 7, distance_m: 17400, energy_used_wh: 4200, avg_speed_mps: 18 });
  if (speed) {
    if (width === 1440) {
      await expect(panel.getByText('1 drive', { exact: true })).toHaveCount(1);
      await expect(panel.getByText('1 drive', { exact: true })).toBeVisible();
      await expect(panel.getByText('1 drives', { exact: true })).toHaveCount(0);
    } else {
      await expect(panel.getByText('64.80', { exact: true })).toBeVisible();
    }
    await writeFile(info.outputPath('speed-count-native-contract.json'), JSON.stringify({
      ...source, width, theme, copyVisible: width === 1440,
      compactLimit: 'Original compact layout exposes peak speed, not drive-count caption; no fixture/layout mutation.',
    }, null, 2));
    return;
  }
  const settings = unwrap(catalogueRecordedSources(page).responses
    .filter(response => new URL(response.url).pathname === '/api/v1/settings').slice(-1)[0]?.body);
  if (!object(settings) || typeof settings.locale !== 'string' || settings.unit_of_length !== 'km'
    || settings.decimal_precision !== 2) throw new Error('Unproved original metric/locale preferences');
  if (typeof source.source.start_ts !== 'string') throw new Error('Missing original measured date');
  const expectedDate = source.source.start_ts.slice(0, 10);
  const expectedAverage = 4200 / (17400 / 1000);
  const formatted = new Intl.NumberFormat(settings.locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(expectedAverage);
  const table = panel.getByRole('table', { name: 'Drive efficiency — data table', exact: true });
  await expect(table.getByRole('columnheader', { name: '7-day avg (Wh/km)', exact: true })).toHaveCount(1);
  await expect(table.getByRole('cell', { name: '—', exact: true })).toHaveCount(1);
  await expect(table.getByRole('cell', { name: String(expectedAverage), exact: true })).toHaveCount(1);
  const svg = panel.locator('svg.recharts-surface');
  await expect(svg).toHaveCount(1);
  const rendered = await svg.evaluate(element => {
    const object = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    const boundary = element.closest('[data-widget-id]');
    let fiber: unknown = key ? Reflect.get(element, key) : null;
    for (let depth = 0; object(fiber) && depth < 80; depth++, fiber = fiber.return) {
      if (fiber.stateNode === boundary) break;
      const props = fiber.memoizedProps;
      if (object(props) && Array.isArray(props.data) && props.data.length
        && props.data.every(point => object(point) && 'efficiency' in point && 'rollingAvg' in point && 'date' in point)) {
        return props.data;
      }
    }
    throw new Error('No same-widget rendered efficiency chart data');
  });
  expect(rendered).toEqual([{
    date: expectedDate, label: expect.any(String), efficiency: expectedAverage, rollingAvg: null,
  }]);
  const reference = panel.locator('.recharts-reference-line');
  await expect(reference).toHaveCount(1);
  const nativeReference = await reference.evaluate(element => {
    const object = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    const boundary = element.closest('[data-widget-id]');
    let fiber: unknown = key ? Reflect.get(element, key) : null;
    for (let depth = 0; object(fiber) && depth < 30; depth++, fiber = fiber.return) {
      if (fiber.stateNode === boundary) break;
      const props = fiber.memoizedProps;
      if (object(props) && typeof props.y === 'number' && object(props.label)) {
        return { y: props.y, stroke: props.stroke, label: props.label };
      }
    }
    throw new Error('No same-widget native reference-line y/label source');
  });
  expect(nativeReference.y).toBe(expectedAverage);
  expect(nativeReference.stroke).toBe('#6b7280');
  expect(nativeReference.label.value).toBe(`Avg: ${formatted} Wh/km`);
  await expect(reference.locator('.recharts-label')).toHaveText(`Avg: ${formatted} Wh/km`);
  await expect(reference.locator('.recharts-label')).toBeVisible();
  await expect(reference.locator('.recharts-reference-line-line')).toHaveAttribute('stroke', '#6b7280');
  await expect(panel.locator('.recharts-legend-wrapper')).not.toContainText('7-day avg');
  await expect(panel.locator('.recharts-area')).toHaveCount(1);
  await writeFile(info.outputPath('drive-reference-native-contract.json'), JSON.stringify({
    ...source, settings, expectedDate, expectedAverage, rendered, nativeReference, width, theme,
    accessibleRollingNullRetained: true, unsupportedRollingLegendAbsent: true,
    fixtureMutation: false, validRollingSeries: 'Original one-date source contains none; production94 unit evidence is not native coverage of multi-date rolling data.',
  }, null, 2));
}
