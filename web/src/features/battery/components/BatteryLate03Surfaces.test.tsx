import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveDataState, type DataState } from '@/api/dataState';
import type { RangeProjection } from '@/api/hooks/useAnalytics';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { analyzePackCapacity } from '../lib/packCapacity';
import EnergyLedgerPage from '../pages/EnergyLedgerPage';
import { PackCapacityMethodology } from './pack-capacity/PackCapacityMethodology';
import { RangeCalculator } from './projected-range-modernization/RangeCalculator';
import { RangeFactors } from './projected-range-modernization/RangeFactors';
import { RangeMatrix } from './projected-range-modernization/RangeMatrix';
import { RangeScenarios } from './projected-range-modernization/RangeScenarios';
import { RangeTips } from './projected-range-modernization/RangeTips';
import { TOUSettingsModal } from './TOUSettingsModal';

const h = vi.hoisted(() => ({
  update: vi.fn(), refresh: vi.fn(), close: vi.fn(), retry: vi.fn(),
  speed: vi.fn(), temperature: vi.fn(), distance: 'km',
}));
vi.mock('@/api/hooks/useEnergy', () => ({
  useUpdateTOUSettings: () => ({ mutate: h.update, isPending: false }),
  useRefreshTeslaEnergySiteInfo: () => ({ mutate: h.refresh }),
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessions: () => ({
    isSuccess: true, dataUpdatedAt: Date.now(), refetch: h.retry,
    data: [
      { started_at: '2026-01-02T10:00:00Z', ended_at: '2026-01-02T11:00:00Z',
        total_energy_added_wh: 36_000, start_soc_pct: 20, end_soc_pct: 80 },
      { started_at: '2026-02-02T10:00:00Z', ended_at: '2026-02-02T11:00:00Z',
        total_energy_added_wh: 12_000, start_soc_pct: 20, end_soc_pct: 40 },
    ],
  }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => ({
    isSuccess: true, dataUpdatedAt: Date.now(), refetch: h.retry,
    data: [{ startTs: '2026-01-03T10:00:00Z', endTs: '2026-01-03T11:00:00Z',
      energyUsedWh: 9_000, startBatteryPct: 75, endBatteryPct: 60, distanceM: 50_000 }],
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7, vehicle: null, vehicles: [], setVehicleId: vi.fn() }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: h.distance, energy: 'Wh', locale: 'en-US' },
    formatDistance: (meters: number) => h.distance === 'mi' ? `${meters / 1609.344} mi` : `${meters / 1000} km`,
    formatSpeed: (mps: number) => `${mps * 3.6} km/h`,
    formatTemperature: (value: number | null) => value == null ? '—' : `${value} °C`,
    formatEnergy: (value: number) => `${value} Wh`,
    formatPower: (value: number) => `${value} W`,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => String(value) }),
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''),
      ),
  }),
}));

function cssRules(name: string) {
  const result: Rule[] = [];
  postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', name), 'utf8'))
    .walkRules(rule => { result.push(rule); });
  return result;
}
const baseRules = cssRules('base.css');
const dataRules = cssRules('feedback.css');
const chartRules = cssRules('charts.css');
function selectors(rule: Rule): string[] {
  if (rule.parent?.type !== 'rule') return rule.selectors;
  return selectors(rule.parent).flatMap(parent => rule.selectors.map(selector =>
    selector.includes('&') ? selector.replaceAll('&', parent) : `${parent} ${selector}`));
}
function consumes(node: Element, rules: readonly Rule[], contract: string, property: string) {
  return rules.some(rule => rule.nodes.some(part => part.type === 'decl' && part.prop === property)
    && selectors(rule).some(selector => selector.includes(contract) && node.matches(selector)));
}

function projection(): RangeProjection {
  return {
    current_range_km: 300, projected_range_km: 280, battery_level: 50,
    current_battery_pct: 50, usable_capacity_wh: 60_000, health_factor: 0.95,
    efficiency_factor: 0.92, projection_curve: [], tesla_estimate_km: 300,
    your_estimate_km: 280, accuracy_note: '',
    factors: [
      { name: 'temperature', impact_pct: -8, description: 'Measured cold-weather impact' },
      { name: 'speed', impact_pct: 0, description: 'Measured zero speed impact' },
      { name: 'elevation', impact_pct: NaN, description: 'Unresolved elevation impact' },
    ],
    scenarios: [
      { name: 'Zero range', range_km: 0, speed_kmh: 0, temp_c: 0,
        efficiency_wh_km: 0, sample_count: 2, extras: ['sentry', 'preheat'], is_current: true },
      { name: 'Unknown range', range_km: NaN, speed_kmh: NaN, temp_c: NaN,
        efficiency_wh_km: NaN, sample_count: 0, extras: [] },
    ],
    efficiency_matrix: [
      { temp_bucket: 'freezing', speed_bucket: 'city', wh_km: 0, samples: 0 },
      { temp_bucket: 'cold', speed_bucket: 'suburban', wh_km: 160, samples: 2 },
      { temp_bucket: 'mild', speed_bucket: 'suburban', wh_km: 200, samples: 3 },
      { temp_bucket: 'hot', speed_bucket: 'highway', wh_km: 250, samples: 4 },
      { temp_bucket: 'hot', speed_bucket: 'city', wh_km: NaN, samples: NaN },
    ],
  };
}
const capacity = analyzePackCapacity([], Date.parse('2026-08-08T12:00:00Z'), 'UTC');
function RangeSections({ source, loading = false }: { source: DataState<RangeProjection>; loading?: boolean }) {
  return <>
    <div data-testid="scenarios"><RangeScenarios source={source} loading={loading} /></div>
    <div data-testid="factors"><RangeFactors source={source} loading={loading} /></div>
    <div data-testid="matrix"><RangeMatrix source={source} loading={loading} /></div>
    <div data-testid="calculator"><RangeCalculator source={source} loading={loading} speed={80} temperature={20}
      onSpeedChange={h.speed} onTemperatureChange={h.temperature} /></div>
    <div data-testid="tips"><RangeTips /></div>
  </>;
}
function mountAll(data = projection()) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}>
    <RangeSections source={deriveDataState({ data, isSuccess: true })} />
    <PackCapacityMethodology result={capacity} />
    <div data-testid="ledger"><EnergyLedgerPage /></div>
    <TOUSettingsModal open siteId={7} onClose={h.close} />
  </QueryClientProvider></MemoryRouter>);
}
let release = () => {};
beforeEach(() => {
  vi.clearAllMocks();
  h.distance = 'km';
});
afterEach(() => {
  release();
  release = () => {};
  cleanup();
  for (const name of Object.keys(getAppDesignAttributes('classic'))) document.documentElement.removeAttribute(name);
});

describe('battery-late-03 native source ownership', () => {
  it.each(PACK_IDS)('%s activates the real records/readings and preserves all native matrix cells', pack => {
    const data = projection();
    const evidence = JSON.stringify({ data, capacity });
    for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) document.documentElement.setAttribute(name, value);
    mountAll(data);
    fireEvent.change(screen.getByLabelText('Rate Plan'), { target: { value: 'pge-ev2a' } });
    release = observeAppDesignScopes(document.documentElement);
    const design = APPLICATION_DESIGNS[pack];

    const methods = screen.getByTestId('pack-capacity-methodology').querySelectorAll('article');
    const factors = screen.getByTestId('factors').querySelectorAll('[data-app-card-kind="record"]');
    const tips = screen.getByTestId('tips').querySelectorAll('li');
    const months = screen.getByTestId('ledger').querySelectorAll('li[data-app-card-kind="record"]');
    const preview = document.body.querySelector('pre')!;
    const previewCard = preview.closest('[data-app-card-kind="record"]')!;
    expect(methods).toHaveLength(10);
    expect(factors).toHaveLength(3);
    expect(tips).toHaveLength(4);
    expect(months).toHaveLength(2);
    for (const card of [...methods, ...factors, ...tips, ...months, previewCard]) {
      expect(consumes(card, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
      expect(consumes(card, dataRules, `[data-app-data="${design.data}"]`, 'flex-direction')).toBe(true);
      const body = card.querySelector(':scope > [data-app-part~="record-body"]')!;
      expect(body).not.toBeEmptyDOMElement();
      expect(consumes(body, dataRules, '[data-app-card-kind="record"]', 'max-inline-size')).toBe(true);
    }
    for (const month of months) {
      const rows = month.querySelectorAll('[data-app-list="definitions"] > [data-app-part~="list-row"]');
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(consumes(row, dataRules, `[data-app-data="${design.data}"]`, 'display')).toBe(true);
        expect(row.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
        const reading = row.querySelector('[data-app-part~="metric-reading"]')!;
        expect(reading).not.toBeEmptyDOMElement();
        expect(consumes(reading, dataRules, '[data-app-part~="metric-reading"]', 'font-variant-numeric')).toBe(true);
      }
    }
    expect([...months].map(month => month.querySelector('[data-app-part~="record-title"]')?.textContent))
      .toEqual(['2026-01', '2026-02']);
    expect(screen.getByText('Weakest month')).toBeInTheDocument();

    const tiles = screen.getByTestId('scenarios').querySelectorAll('[data-app-metric="tile"]');
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(consumes(tile, dataRules, `[data-app-data="${design.data}"]`, 'padding')).toBe(true);
      expect(tile.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
      expect(tile.querySelector('[data-app-part~="metric-context"]')).not.toBeEmptyDOMElement();
    }
    expect(tiles[0].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent(/^0 km$/);
    expect(tiles[1].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent(/^—$/);
    expect(within(tiles[0] as HTMLElement).getByText('sentry')).toBeInTheDocument();
    expect(within(tiles[0] as HTMLElement).getByText('preheat')).toBeInTheDocument();
    expect(within(tiles[0] as HTMLElement).getByText('2 drives')).toBeInTheDocument();
    expect(within(tiles[1] as HTMLElement).queryByText(/drives/)).not.toBeInTheDocument();
    expect(screen.getByTestId('factors')).toHaveTextContent('-8%');
    expect(screen.getByTestId('factors')).toHaveTextContent('+0%');
    expect(screen.getByTestId('factors')).toHaveTextContent('—');

    const calculator = screen.getByTestId('calculator');
    const headline = calculator.querySelector('[data-app-metric="headline"]')!;
    expect(consumes(headline, dataRules, `[data-app-data="${design.data}"]`, 'display')).toBe(true);
    expect(headline.querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent(/^150 km$/);
    expect(headline.querySelector('[data-app-part~="metric-label"]')).toHaveTextContent('at 80 km/h, 20 °C');
    expect(headline.querySelector('[data-app-part~="metric-context"]')).toHaveTextContent('200 Wh/km');
    expect(within(headline as HTMLElement).getByText('200 Wh/km')).toBeInTheDocument();
    fireEvent.change(within(calculator).getByRole('slider', { name: 'Speed' }), { target: { value: '100' } });
    fireEvent.change(within(calculator).getByRole('slider', { name: 'Temperature' }), { target: { value: '-5' } });
    expect(h.speed).toHaveBeenCalledWith(100);
    expect(h.temperature).toHaveBeenCalledWith(-5);

    const matrix = screen.getByTestId('matrix');
    const rows = matrix.querySelectorAll('[data-chart-matrix-row]');
    expect(rows).toHaveLength(4);
    expect([...rows].map(row => row.querySelector('[data-chart-matrix-label]')?.textContent))
      .toEqual(['Freezing', 'Cold', 'Mild', 'Hot']);
    for (const row of rows) {
      expect(row.querySelectorAll('[data-chart-matrix-cell]')).toHaveLength(3);
      expect(consumes(row, chartRules, '[data-chart-family="condition-matrix"]', 'border-color')).toBe(true);
    }
    const cells = matrix.querySelectorAll('[data-chart-matrix-cell]');
    expect(cells).toHaveLength(12);
    expect(cells[0]).toHaveTextContent('0(0)');
    expect(cells[0].className).toContain('bg-[var(--semantic-success-bg)]');
    expect(cells[1]).toHaveTextContent(/^—$/);
    expect(cells[4].className).toContain('bg-[var(--semantic-info-bg)]');
    expect(cells[7].className).toContain('bg-[var(--semantic-warning-bg)]');
    expect(cells[9]).toHaveTextContent('—(—)');
    expect(cells[11].className).toContain('bg-[var(--semantic-danger-bg)]');
    expect(matrix.querySelectorAll('[style]')).toHaveLength(0);
    expect([...cells].every(cell => cell.parentElement?.className.includes('grid-cols-3'))).toBe(true);
    expect(JSON.stringify({ data, capacity })).toBe(evidence);

    const payload = JSON.parse(preview.textContent!);
    expect(payload.tou_settings.tariff_content_v2.name).toBe('PG&E EV2-A');
    expect(preview).toHaveClass('overflow-auto', 'max-h-48');
    fireEvent.click(screen.getByRole('button', { name: /^Update Rate Plan$/ }));
    expect(h.update).toHaveBeenCalledWith({ siteId: 7, settings: payload }, expect.any(Object));
  });

  it('retains the four original always-visible tips and every methodology limitation', () => {
    mountAll();
    expect([...screen.getByTestId('tips').querySelectorAll('li')].map(tip => tip.textContent)).toEqual([
      'Keep speed under 110 km/h for optimal efficiency.',
      'Pre-condition the cabin while still plugged in.',
      'Use seat heaters instead of cabin heat in cold weather.',
      'Plan routes to minimize elevation changes.',
    ]);
    const method = screen.getByTestId('pack-capacity-methodology');
    expect(method).toHaveTextContent('Duration never substitutes for a missing completion.');
    expect(method).toHaveTextContent('Prior, innovation, gain, and posterior are retained for inspection.');
    expect(method).toHaveTextContent('chart and directory caps never change summary calculations.');
    expect(method).toHaveTextContent('Gross-versus-usable buffers, thermal conditioning, charging losses, balancing, firmware changes, cell chemistry, calibration drift, and laboratory capacity tests are not modeled.');
    expect(method).toHaveTextContent('It does not measure battery health, damage, degradation, safety, warranty condition, or remaining life, and it does not prescribe charging behavior.');
    expect(document.querySelector('[data-app-design-owner]')).toBeNull();
  });

  it.each([
    ['learned bucket', 200, 150],
    ['safety default for zero efficiency', 0, 176.5],
    ['safety default for invalid efficiency', NaN, 176.5],
  ] as const)('preserves the calculator %s without inventing a gauge', (_label, efficiency, expectedRange) => {
    const data = projection();
    data.efficiency_matrix[2].wh_km = efficiency;
    render(<RangeSections source={deriveDataState({ data, isSuccess: true })} />);
    const calculator = screen.getByTestId('calculator');
    expect(calculator.querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent(`${expectedRange} km`);
    expect(calculator.querySelector('[data-chart-gauge-fill], [role="meter"], [role="progressbar"]')).toBeNull();
  });

  it('keeps unknown JSON readings distinct from true zero and retains the heuristic branch', () => {
    const data = JSON.parse(JSON.stringify(projection())) as RangeProjection;
    data.efficiency_matrix = [];
    const view = render(<RangeSections source={deriveDataState({ data, isSuccess: true })} />);
    expect(screen.getByTestId('calculator').querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('169 km');
    data.current_battery_pct = 0;
    view.rerender(<RangeSections source={deriveDataState({ data: { ...data }, isSuccess: true })} />);
    expect(screen.getByTestId('calculator').querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent(/^0 km$/);
    const missing = JSON.parse(JSON.stringify({ ...data, current_battery_pct: null, battery_level: null })) as RangeProjection;
    view.rerender(<RangeSections source={deriveDataState({ data: missing, isSuccess: true })} />);
    const calculator = screen.getByTestId('calculator');
    expect(calculator.querySelector('[data-app-part~="card"]')).toHaveTextContent('Measured battery level and usable capacity are required');
    expect(calculator.querySelector('[data-app-part~="metric-reading"]')).toBeNull();
    expect(within(calculator).getAllByRole('slider')).toHaveLength(2);
  });

  it('keeps loading, empty, failed and retained source states independent from always-visible tips', () => {
    const view = render(<RangeSections source={deriveDataState<RangeProjection>({ isLoading: true })} loading />);
    expect(document.querySelectorAll('[data-app-part~="skeleton"]')).toHaveLength(4);
    expect(screen.getByTestId('tips').querySelectorAll('li')).toHaveLength(4);
    view.rerender(<RangeSections source={deriveDataState<RangeProjection>({ error: new Error('range offline'), isError: true, refetch: h.retry })} />);
    const retries = screen.getAllByRole('button', { name: /retry/i });
    expect(retries).toHaveLength(4);
    fireEvent.click(retries[0]);
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('tips').querySelectorAll('li')).toHaveLength(4);
    view.rerender(<RangeSections source={deriveDataState<RangeProjection>({ isSuccess: true })} />);
    expect(screen.getByText('Drive more to see personalized scenario projections.')).toBeInTheDocument();
    expect(screen.getByText('Efficiency data requires drives in different conditions.')).toBeInTheDocument();
    view.rerender(<RangeSections source={deriveDataState({ data: projection(), isError: true, error: new Error('refresh failed') })} />);
    expect(screen.getByTestId('scenarios').querySelectorAll('[data-app-metric="tile"]')).toHaveLength(2);
    expect(screen.getByTestId('matrix').querySelectorAll('[data-chart-matrix-cell]')).toHaveLength(12);
    expect(screen.getByTestId('tips').querySelectorAll('li')).toHaveLength(4);
  });
});
