import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { assertCatalogueChargeQueryBinding, type CatalogueChargeQueryBinding } from './dashboardCatalogueChargeHistory';

let chart: CatalogueChargeQueryBinding;
let detail: CatalogueChargeQueryBinding;
let source: Record<string, unknown>;

test.beforeAll(async () => {
  const path = process.env.E2E_CHARGE_BINDING_EVIDENCE;
  if (!path) throw new Error('Binding controls require actual completed native observer evidence');
  const native: {
    evidence: Array<{ widgetId: string; component: {
      closestWidgetId: string; boundaryReached: boolean;
      candidates: Array<{ depth: number; vehicleIdType: string; vehicleId: unknown; hookChainComplete: boolean;
        hooks: Array<{ index: number; publicObserver?: boolean; queryKey?: unknown; status?: unknown; data?: unknown }> }>;
    } }>;
    wire: Array<{ url: string; body: unknown }>;
  } = JSON.parse(await readFile(path, 'utf8'));
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const wire = native.wire.find(response => {
    const url = new URL(response.url);
    return url.pathname === '/api/v1/charging' && url.searchParams.get('limit') === '10';
  });
  if (!wire || !Array.isArray(wire.body) || wire.body.length !== 1 || !object(wire.body[0])) {
    throw new Error('Missing actual native single-session wire evidence');
  }
  source = wire.body[0];
  for (const kind of ['chart', 'detail'] as const) {
    const widget = native.evidence.find(row =>
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
