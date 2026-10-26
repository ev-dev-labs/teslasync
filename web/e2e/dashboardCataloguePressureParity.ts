import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  assertCatalogueQueryScope, catalogueRecordedSources, renderedCatalogueQueryBinding,
} from './dashboardCatalogueChargeHistory';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const unwrap = (value: unknown) => object(value) && 'data' in value ? value.data : value;

export function assertPressurePaParity(latest: Record<string, unknown>, history: Record<string, unknown>) {
  for (const field of ['front_left', 'front_right', 'rear_left', 'rear_right']) {
    expect(Object.hasOwn(latest, field), `Latest pressure must contain ${field}`).toBe(true);
    expect(Object.hasOwn(history, field), `History pressure must contain ${field}`).toBe(true);
    expect(history[field], `Latest history ${field} must preserve the same raw Pa reading`).toBe(latest[field]);
  }
}

export async function assertCataloguePressureParity(page: Page, historyPanel: Locator,
  width: number, theme: string, info: TestInfo) {
  const state = catalogueRecordedSources(page);
  await Promise.all([...state.pending]);
  expect(state.errors, 'Pressure provenance recorder must have no errors').toEqual([]);
  const served = state.responses.filter(response => {
    const url = new URL(response.url);
    return url.pathname === '/api/v1/tire-pressure/latest' && url.searchParams.get('vehicle_id') === '7';
  });
  if (!served.length) throw new Error('Missing actually served vehicle7 tire-pressure source');
  const source = unwrap(served[0].body);
  if (!object(source)) throw new Error('Original pressure source must be an object');
  expect(source).toMatchObject({
    id: 1, vehicle_id: 7, front_left: 280000, front_right: 285000,
    rear_left: 290000, rear_right: 295000,
  });
  for (const response of served) expect(unwrap(response.body), 'Pa fixture must remain unchanged').toEqual(source);
  const settings = unwrap(state.responses.filter(response =>
    new URL(response.url).pathname === '/api/v1/settings').slice(-1)[0]?.body);
  expect(settings, 'Original bar/precision/locale preferences must remain unchanged').toMatchObject({
    unit_of_pressure: 'bar', decimal_precision: 2, locale: 'en-US',
  });
  const visualPanel = page.locator('[data-widget-id="review-tire-pressure-visual"] > .widget-panel');
  const latestKey = ['tire-latest', 7] as const;
  const latestBinding = await renderedCatalogueQueryBinding(
    visualPanel, 'review-tire-pressure-visual', 'Tire pressure', latestKey,
  );
  assertCatalogueQueryScope(latestBinding, 'review-tire-pressure-visual', latestKey);
  expect(latestBinding.data, 'Latest observer must preserve every original source field/null').toMatchObject(source);

  const historyServed = state.responses.filter(response => {
    const url = new URL(response.url);
    return url.pathname === '/api/v1/tire-pressure' && url.searchParams.get('vehicle_id') === '7';
  });
  const historyResponse = historyServed[0];
  if (!historyResponse) throw new Error('Missing actually served vehicle7 pressure history');
  const params = new URL(historyResponse.url).searchParams;
  expect([...params.keys()].sort(), 'Pressure history must preserve exact workspace request keys')
    .toEqual(['end', 'start', 'vehicle_id']);
  const start = params.get('start');
  const end = params.get('end');
  if (!start || !end || !(Date.parse(start) < Date.parse(end))) throw new Error('Missing valid half-open pressure window');
  const history = unwrap(historyResponse.body);
  if (!Array.isArray(history) || history.length !== 2 || !history.every(object)) {
    throw new Error('Pressure history must preserve both original source rows');
  }
  for (const response of historyServed) expect(unwrap(response.body)).toEqual(history);
  for (const point of history) {
    const instant = Date.parse(String(point.created_at));
    expect(instant >= Date.parse(start) && instant < Date.parse(end), 'Every source row must belong to the requested window').toBe(true);
  }
  const latestHistory = history[history.length - 1];
  if (!object(latestHistory)) throw new Error('Missing latest original pressure row');
  assertPressurePaParity(source, latestHistory);
  expect(latestHistory.created_at, 'History and latest must agree on the observation instant').toBe(source.created_at);
  const historyKey = ['tire-pressure', 'analysis-history', '7', 30, start, end] as const;
  const historyBinding = await renderedCatalogueQueryBinding(
    historyPanel, 'review-tire-pressure-history', 'Tire pressure history', historyKey,
  );
  assertCatalogueQueryScope(historyBinding, 'review-tire-pressure-history', historyKey);
  expect(historyBinding.data, 'History observer must preserve every original row, field and null').toMatchObject(history);
  const bindings = [latestBinding, historyBinding];
  const wheels = [
    { label: 'FL', field: 'front_left', pa: 280000, bar: '2.80', column: 0, row: 0, x: '78', y: '28' },
    { label: 'FR', field: 'front_right', pa: 285000, bar: '2.85', column: 2, row: 0, x: '172', y: '28' },
    { label: 'RL', field: 'rear_left', pa: 290000, bar: '2.90', column: 0, row: 1, x: '78', y: '116' },
    { label: 'RR', field: 'rear_right', pa: 295000, bar: '2.95', column: 2, row: 1, x: '172', y: '116' },
  ] as const;
  const diagram = visualPanel.locator('svg[viewBox="-30 0 320 170"]');
  const car = diagram.locator('xpath=../..');
  await expect(diagram).toBeVisible();
  const paired = [];
  for (const [index, wheel] of wheels.entries()) {
    expect(source[wheel.field]).toBe(wheel.pa);
    const tire = diagram.locator('rect').nth(index);
    await expect(tire).toHaveAttribute('x', wheel.x);
    await expect(tire).toHaveAttribute('y', wheel.y);
    const visualValue = car.locator(':scope > div').nth(wheel.column).locator(':scope > span').nth(wheel.row);
    await expect(visualValue).toHaveText(wheel.bar);
    await expect(visualValue).toBeVisible();
    let historyValue: string | null;
    if (width === 390) {
      const row = historyPanel.getByText(wheel.label, { exact: true }).locator('..');
      await expect(row).toHaveText(new RegExp(`^${wheel.label}\\s*${wheel.bar.replace('.', '\\.')}\\s*bar$`));
      await expect(row).toBeVisible();
      historyValue = await row.textContent();
    } else {
      const table = historyPanel.getByRole('table', { name: 'Tire pressure history — data table', exact: true });
      await expect(table.getByRole('columnheader', { name: `${wheel.label} (bar)`, exact: true })).toHaveCount(1);
      const cell = table.getByRole('row').last().getByRole('cell').nth(index + 1);
      historyValue = await cell.textContent();
      expect(Number(historyValue), 'Latest accessible chart value must use the same Pa-to-bar conversion').toBe(Number(wheel.bar));
    }
    paired.push({ ...wheel, history: historyValue, visual: await visualValue.textContent() });
  }
  // The redesigned diagram owns the spatial wheel mapping; the shell owns freshness.
  const caption = visualPanel.getByText('bar', { exact: true });
  await expect(caption).toHaveCount(1);
  await expect(caption).toBeVisible();
  await expect(visualPanel.getByRole('button', { name: /^Refresh data/ })).toHaveCount(1);
  await writeFile(info.outputPath('pressure-native-paired-contract.json'), JSON.stringify({
    width, theme, served, historyServed, source, history, settings, bindings, paired,
    scope: 'Original Pa payloads and observation instant, exact latest/history observers, half-open workspace scope, spatial wheel/value parity.',
  }, null, 2));
}
