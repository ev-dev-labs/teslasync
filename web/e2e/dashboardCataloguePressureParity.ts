import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  assertCatalogueQueryScope, catalogueRecordedSources, renderedCatalogueQueryBinding,
} from './dashboardCatalogueChargeHistory';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const unwrap = (value: unknown) => object(value) && 'data' in value ? value.data : value;

export async function assertCataloguePressureParity(page: Page, livePanel: Locator,
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
  const key = ['tire-latest', 7] as const;
  const bindings = [];
  for (const [panel, widgetId, title] of [
    [livePanel, 'review-live-signals', 'Live signals'],
    [visualPanel, 'review-tire-pressure-visual', 'Tire pressure'],
  ] as const) {
    const binding = await renderedCatalogueQueryBinding(panel, widgetId, title, key);
    assertCatalogueQueryScope(binding, widgetId, key);
    const rendered = binding.data;
    if (!object(rendered)) throw new Error(`${widgetId} has no successful native pressure object`);
    expect(Object.fromEntries(Object.keys(source).map(field => [field, rendered[field]])),
      'Each same-widget observer must preserve every original Pa source field/null').toEqual(source);
    bindings.push(binding);
  }
  const wheels = [
    { label: 'FL', field: 'front_left', pa: 280000, bar: '2.80' },
    { label: 'FR', field: 'front_right', pa: 285000, bar: '2.85' },
    { label: 'RL', field: 'rear_left', pa: 290000, bar: '2.90' },
    { label: 'RR', field: 'rear_right', pa: 295000, bar: '2.95' },
  ] as const;
  const paired = [];
  for (const wheel of wheels) {
    expect(source[wheel.field]).toBe(wheel.pa);
    const liveLabel = livePanel.getByText(wheel.label, { exact: true });
    const visualLabel = visualPanel.getByText(wheel.label, { exact: true });
    await expect(liveLabel).toHaveCount(1);
    await expect(visualLabel).toHaveCount(1);
    const liveRow = liveLabel.locator('..');
    const visualMetric = visualLabel.locator('..');
    const liveValue = liveRow.getByText(`${wheel.bar} bar`, { exact: true });
    const visualValue = visualMetric.getByText(wheel.bar, { exact: true });
    await expect(liveValue).toHaveCount(1);
    await expect(visualValue).toHaveCount(1);
    await expect(liveLabel).toBeVisible();
    await expect(visualLabel).toBeVisible();
    await expect(liveValue).toBeVisible();
    await expect(visualValue).toBeVisible();
    paired.push({ ...wheel, live: await liveRow.textContent(), visual: await visualMetric.textContent() });
  }
  await expect(visualPanel.getByText(/^bar\s*·/)).toHaveCount(1);
  await expect(visualPanel.getByText(/^bar\s*·/)).toBeVisible();
  await writeFile(info.outputPath('pressure-native-paired-contract.json'), JSON.stringify({
    width, theme, served, source, settings, bindings, paired,
    scope: 'Original Pa payload, same exact tire-latest7 source observers, exact wheel/value pairings in both widgets.',
  }, null, 2));
}
