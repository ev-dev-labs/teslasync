/**
 * Authored for serialized parent execution: NOTRUN.
 * Real page/cards/stats/forms and canonical data states. Chart doubles capture
 * production export operands; they do not establish chart/browser acceptance.
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChartCardProps } from '@/components/layout';
import { PanelTitle } from '@/components/ui';
import type { StatMetric } from '@/components/data-display';
import { deriveDataState } from '@/api/dataState';
import type { HomeEnergyOrchestration } from '../hooks/useHomeEnergyOrchestration';
import { DEFAULT_SCENARIO } from '../hooks/useOrchestrationScenario';
import { updateScenario, updateVehicleAssumption, resetScenario } from '../hooks/useOrchestrationScenario';
import { optimizeHomeEnergy } from '../lib/optimizer';
import { downloadCanonicalPlan } from '../lib/planExport';
import type { OrchestrationInput } from '../lib/types';
import WholeHomeEnergyPage from './WholeHomeEnergyPage';
import { EnergyFlowChart } from '../components/EnergyFlowChart';
import { PowerwallTrajectoryChart } from '../components/PowerwallTrajectoryChart';

const h = vi.hoisted(() => ({
  model: null as HomeEnergyOrchestration | null,
  charts: [] as ChartCardProps[],
  refresh: vi.fn(),
  commit: vi.fn(),
  retry: vi.fn(),
  metricBands: [] as (readonly StatMetric[])[],
}));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: (...args: Parameters<typeof actual.useOperationalMetrics>) => {
    h.metricBands.push(args[0]);
    return actual.useOperationalMetrics(...args);
  } };
});
vi.mock('../hooks/useHomeEnergyOrchestration', () => ({
  useHomeEnergyOrchestration: () => h.model,
}));
vi.mock('../hooks/useOrchestrationScenario', async importOriginal => {
  const actual = await importOriginal<typeof import('../hooks/useOrchestrationScenario')>();
  return { ...actual, updateScenario: vi.fn(), updateVehicleAssumption: vi.fn(), resetScenario: vi.fn() };
});
vi.mock('../lib/planExport', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/planExport')>();
  return { ...actual, downloadCanonicalPlan: vi.fn() };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});
vi.mock('@/components/layout', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/layout')>();
  return { ...actual, ChartCard: (props: ChartCardProps) => {
    h.charts.push(props);
    return <div role="figure" aria-label={props.title}><PanelTitle>{props.title}</PanelTitle></div>;
  } };
});

const start = '2026-01-01T00:00:00Z';
const vehicleName = 'A very long family vehicle name that must remain available in every vehicle panel';
function inputFixture(): OrchestrationInput {
  return {
    startTimeIso: start, slotMinutes: 30, horizonSlots: 12,
    vehicles: [{
      id: '42', name: vehicleName, currentSocPct: 40, targetSocPct: 80,
      usableCapacityWh: 50_000, maxChargePowerW: 7000, departureSlot: 10, priority: 'high',
    }],
    solarForecastW: Array.from({ length: 12 }, (_, i) => 3000 + i),
    loadForecastW: Array.from({ length: 12 }, () => 1000),
    tariff: Array.from({ length: 12 }, () => ({ importPricePerKwh: 0.2, exportPricePerKwh: 0.05 })),
    powerwall: {
      capacityWh: 13_500, currentSocPct: 70, reservePct: 20,
      maxChargePowerW: 5000, maxDischargePowerW: 5000, roundTripEfficiency: 0.9,
    },
    grid: { maxImportW: 10_000, maxExportW: 5000 },
  };
}
const clients: QueryClient[] = [];
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/home-energy']}>
    <WholeHomeEnergyPage />
  </MemoryRouter></QueryClientProvider>);
}
function assertSections(container: HTMLElement) {
  expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(2);
  expect(screen.getByTestId('home-energy-outcomes').querySelectorAll('[data-operational-metric]')).toHaveLength(6);
  expect(screen.getByTestId('home-energy-forecast-quality').querySelectorAll('[data-operational-metric]')).toHaveLength(2);
  for (const title of [
    'Scenario & assumptions', 'Vehicle assumptions', 'Energy flow schedule',
    'Per-vehicle readiness', 'Powerwall trajectory', 'Tariff & constraint heatmap',
    'Constraint violations', 'Assumptions & forecast quality', 'Export plan',
  ]) expect(screen.getByText(title)).toBeInTheDocument();
}
beforeEach(() => {
  vi.clearAllMocks();
  h.charts = [];
  h.metricBands = [];
  const input = inputFixture();
  const forecast = {
    seriesW: input.solarForecastW, confidence: 0.75, quality: 'medium' as const,
    sourceSampleCount: 123, latestSampleIso: start,
  };
  h.model = {
    isLoading: false, error: null, queries: [],
    sourceStates: [{ id: 'vehicles', state: deriveDataState({ data: [], refetch: h.retry }) }],
    vehicles: [], hasEnergySite: true, siteName: 'The full energy site name',
    scenario: { ...DEFAULT_SCENARIO, slotMinutes: 30, horizonHours: 6 },
    startTimeIso: start, input, result: optimizeHomeEnergy(input),
    solarForecast: forecast, loadForecast: { ...forecast, seriesW: input.loadForecastW },
    refreshNow: h.refresh, commitAsBaseline: h.commit,
  };
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe('whole-home presentation preservation', () => {
  it('keeps all ten sections, six outcomes, full vehicle names, actual planning interval and non-autonomy', () => {
    const { container } = mountPage();
    assertSections(container);
    expect(screen.getAllByText(vehicleName).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/never an autonomous command/).length).toBeGreaterThan(0);
    expect(screen.getByText(/50% model assumption, not a measurement/)).toBeInTheDocument();
    expect(screen.getAllByText('75% confidence from 123 history sample(s)')).toHaveLength(2);
    const brief = screen.getByTestId('home-energy-outcomes');
    expect(brief).toHaveTextContent(`${start} — 2026-01-01T06:00:00.000Z (end exclusive)`);
    expect(brief).toHaveTextContent('30-minute modeled slots · UTC · source coverage not established');
  });
  it('passes every slot and all six energy series to chart tables and CSV without a sample cap', () => {
    mountPage();
    const flow = h.charts.find(chart => chart.title === 'Energy flow schedule')!;
    const battery = h.charts.find(chart => chart.title === 'Powerwall trajectory')!;
    expect(flow.subtitle).toContain('30-minute slot');
    expect(flow.exportable).toBe(true);
    expect(flow.fullscreen).toBe(true);
    expect(flow.exportData).toBe(flow.data);
    expect(flow.exportData).toHaveLength(h.model!.result.slots.length);
    expect(flow.dataColumns?.map(column => column.key)).toEqual([
      'time', 'solarW', 'loadW', 'vehicleChargeW', 'batteryPowerW', 'gridImportW', 'gridExportW',
    ]);
    const last = h.model!.result.slots.at(-1)!;
    expect(flow.exportData?.at(-1)).toEqual({
      time: last.startIso, solarW: Math.round(last.solarW), loadW: Math.round(last.loadW),
      vehicleChargeW: Math.round(last.vehicleChargeW), batteryPowerW: Math.round(last.batteryPowerW),
      gridImportW: Math.round(last.gridImportW), gridExportW: Math.round(-last.gridExportW),
    });
    expect(battery.exportData).toBe(battery.data);
    expect(battery.exportData).toHaveLength(h.model!.result.slots.length);
    expect(battery.exportable).toBe(true);
    expect(battery.fullscreen).toBe(true);
  });
  it('never applies the charging-detail DOM cap to modeled chart exports', () => {
    const first = h.model!.result.slots[0]!;
    const slots = Array.from({ length: 2401 }, (_, slotIndex) => ({
      ...first, slotIndex, startIso: new Date(Date.parse(start) + slotIndex * 30 * 60_000).toISOString(),
    }));
    render(<>
      <EnergyFlowChart slots={slots} slotMinutes={30} />
      <PowerwallTrajectoryChart slots={slots} powerwall={h.model!.input.powerwall} />
    </>);
    for (const chart of h.charts) {
      expect(chart.data).toHaveLength(2401);
      expect(chart.exportData).toHaveLength(2401);
      expect(chart.exportData?.at(-1)?.time).toBe(slots.at(-1)?.startIso);
    }
    expect(h.charts).toHaveLength(2);
  });
  it.each(['stale', 'partial', 'paused'] as const)('keeps the full plan and actions during %s source degradation', mode => {
    const state = deriveDataState(
      { data: [1], error: mode === 'stale' ? new Error('Refresh failed') : null,
        fetchStatus: mode === 'paused' ? 'paused' : 'idle', refetch: h.retry },
      { partial: mode === 'partial' },
    );
    h.model!.sourceStates = [{ id: 'fleet', state }];
    const { container } = mountPage();
    assertSections(container);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Download canonical JSON plan' })).toBeEnabled();
    const brief = screen.getByTestId('home-energy-outcomes');
    expect(brief).toHaveTextContent(mode === 'stale' ? 'Retained source inputs'
      : mode === 'paused' ? 'Source refresh paused' : 'Incomplete source inputs');
    for (const metric of brief.querySelectorAll('[data-operational-metric]')) {
      expect(metric).toHaveAttribute('data-value-state', 'value');
    }
  });
  it.each(['initial-failure', 'initial-paused'] as const)('keeps all sections and honest source recovery for %s', mode => {
    const state = deriveDataState<unknown>({
      error: mode === 'initial-failure' ? new Error('Network unavailable') : null,
      fetchStatus: mode === 'initial-paused' ? 'paused' : 'idle', refetch: h.retry,
    });
    h.model!.sourceStates = [{ id: 'vehicles', state }];
    h.model!.error = state.fatalError;
    const { container } = mountPage();
    assertSections(container);
    if (mode === 'initial-failure') {
      const values = screen.getByTestId('home-energy-outcomes').querySelectorAll('[data-operational-value]');
      expect(values).toHaveLength(6);
      for (const value of values) expect(value).toHaveTextContent('—');
      for (const metric of screen.getByTestId('home-energy-outcomes').querySelectorAll('[data-operational-metric]')) {
        expect(metric).toHaveAttribute('data-value-state', 'missing');
      }
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(h.retry).toHaveBeenCalledTimes(1);
    } else {
      expect(screen.getByText(/This source is waiting for a connection/)).toBeInTheDocument();
    }
  });
  it('preserves explicit scenario commands, full SI patches and the exact vehicle member ID', () => {
    mountPage();
    fireEvent.click(screen.getByRole('button', { name: 'Recompute from now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as stability baseline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect(resetScenario).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Optimization priority' }), { target: { value: 'costFirst' } });
    expect(updateScenario).toHaveBeenLastCalledWith({
      weights: { readiness: 2, cost: 4, selfConsumption: 1.5, peakShaving: 1, reserve: 1, stability: 0.5 },
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(vehicleName) }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Charging priority' }), { target: { value: 'low' } });
    expect(updateVehicleAssumption).toHaveBeenLastCalledWith('42', { priority: 'low' });
    expect(screen.getByText('Current SoC used by model: 40%')).toBeInTheDocument();
  });
  it('exports the entire unchanged optimizer input and result and retains the no-battery prerequisite', () => {
    h.model!.input = { ...h.model!.input, powerwall: null };
    h.model!.result = optimizeHomeEnergy(h.model!.input);
    const { container } = mountPage();
    assertSections(container);
    expect(screen.getByText(/No home battery is modeled in this scenario/)).toBeInTheDocument();
    expect(h.charts.filter(chart => chart.title === 'Powerwall trajectory')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Download canonical JSON plan' }));
    expect(downloadCanonicalPlan).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1, input: h.model!.input, result: h.model!.result,
      disclaimer: expect.stringContaining('does not send any command'),
    }), 'home-energy-plan-2026-01-01.json');
  });
  it('passes genuine numeric SI outcomes through the real bridge, retaining signed net cost and count denominator', () => {
    h.model!.result.scores.overall = 72.6;
    h.model!.result.scores.selfConsumption = 81.25;
    h.model!.result.totals.totalCost = -12.34;
    h.model!.result.totals.peakGridImportW = 1234;
    h.model!.result.vehicles[0].unmetWh = 2500;
    mountPage();
    const band = h.metricBands.find(metrics => metrics.some(metric => metric.occurrenceId === 'overall'))!;
    expect(band.map(({ occurrenceId, metricId, rawValue }) => ({ occurrenceId, metricId, rawValue }))).toEqual([
      { occurrenceId: 'overall', metricId: 'score', rawValue: 72.6 },
      { occurrenceId: 'projected-cost', metricId: 'currency', rawValue: -12.34 },
      { occurrenceId: 'self-consumption', metricId: 'percent', rawValue: 81.25 },
      { occurrenceId: 'peak-grid-import', metricId: 'power', rawValue: 1234 },
      { occurrenceId: 'vehicles-ready', metricId: 'count', rawValue: h.model!.result.vehicles.filter(v => v.readinessAchieved).length },
      { occurrenceId: 'unmet-energy', metricId: 'energy', rawValue: 2500 },
    ]);
    expect(band.find(metric => metric.occurrenceId === 'vehicles-ready')?.display?.countTotal).toBe(1);
    const brief = screen.getByTestId('home-energy-outcomes');
    expect(brief.querySelector('[data-operational-metric="overall"] [data-operational-value]')).toHaveTextContent('73');
    expect(brief.querySelector('[data-operational-metric="projected-cost"] [data-operational-value]')).toHaveTextContent('-12.34');
    expect(brief.querySelector('[data-operational-metric="peak-grid-import"] [data-operational-value]')).toHaveTextContent('1.23 kW');
    expect(brief.querySelector('[data-operational-metric="unmet-energy"] [data-operational-value]')).toHaveTextContent('2.50 kWh');
  });
  it('keeps invalid measurements distinct from genuine zero and a successful empty vehicle plan', () => {
    h.model!.result.scores.overall = Number.NaN;
    h.model!.result.totals.peakGridImportW = Number.POSITIVE_INFINITY;
    h.model!.result.totals.totalCost = 0;
    h.model!.result.vehicles = [];
    mountPage();
    const brief = screen.getByTestId('home-energy-outcomes');
    for (const id of ['overall', 'peak-grid-import']) {
      expect(brief.querySelector(`[data-operational-metric="${id}"]`)).toHaveAttribute('data-value-state', 'invalid');
      expect(brief.querySelector(`[data-operational-metric="${id}"] [data-operational-value]`)).toHaveTextContent('—');
    }
    for (const id of ['projected-cost', 'vehicles-ready', 'unmet-energy']) {
      expect(brief.querySelector(`[data-operational-metric="${id}"]`)).toHaveAttribute('data-value-state', 'value');
    }
    expect(brief.querySelector('[data-operational-metric="vehicles-ready"] [data-operational-value]')).toHaveTextContent('0/0');
  });
  it('keeps loading brief shells and all scenario controls without presenting skeletons as values', () => {
    h.model!.isLoading = true;
    const { container } = mountPage();
    assertSections(container);
    const brief = screen.getByTestId('home-energy-outcomes');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Recompute from now' })).toBeEnabled();
  });
  it('opens the actual outcomes drawer with source assumptions, modeled captions and the exact interval', () => {
    mountPage();
    fireEvent.click(within(screen.getByTestId('home-energy-outcomes')).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Planning outcomes details' });
    expect(drawer).toHaveTextContent('Modeled recommendation score, not source confidence');
    expect(drawer).toHaveTextContent('Projected net cost using editable tariff assumptions');
    expect(drawer).toHaveTextContent('never fabricated as delivered');
    expect(drawer).toHaveTextContent(`${start} — 2026-01-01T06:00:00.000Z (end exclusive)`);
    expect(drawer).toHaveTextContent('Assumed (user-editable): tariff rates');
    expect(drawer).toHaveTextContent('never an autonomous command');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('retains independent forecast evidence and genuine adapter confidence in the real review drawer', () => {
    h.model!.loadForecast = { ...h.model!.loadForecast, confidence: 0.5, sourceSampleCount: 12,
      quality: 'low', latestSampleIso: '2025-12-31T23:00:00Z' };
    h.model!.sourceStates = [...h.model!.sourceStates, { id: 'history', state: deriveDataState({
      data: [1], error: new Error('History refresh failed'), dataUpdatedAt: Date.parse(start),
    }) }];
    mountPage();
    const brief = screen.getByTestId('home-energy-forecast-quality');
    expect(brief).toHaveTextContent('Retained source inputs');
    expect(brief).toHaveTextContent('75% confidence from 123 history sample(s)');
    expect(brief).toHaveTextContent('50% confidence from 12 history sample(s)');
    expect(brief).toHaveTextContent('Latest source history sample: 2025-12-31T23:00:00Z');
    const band = h.metricBands.find(metrics => metrics.some(metric => metric.occurrenceId === 'solar-confidence'))!;
    expect(band.map(metric => metric.rawValue)).toEqual([75, 50]);
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Assumptions & forecast quality details' });
    expect(drawer).toHaveTextContent('75% confidence from 123 history sample(s)');
    expect(drawer).toHaveTextContent('50% confidence from 12 history sample(s)');
    expect(drawer).toHaveTextContent('Forecast-adapter confidence is derived from available energy history');
    expect(drawer).toHaveTextContent('not confidence in measured vehicle or battery state');
  });
  it('discloses absent forecast history without inventing positive confidence or a source timestamp', () => {
    for (const forecast of [h.model!.solarForecast, h.model!.loadForecast]) {
      forecast.confidence = 0;
      forecast.sourceSampleCount = 0;
      forecast.latestSampleIso = null;
      forecast.quality = 'none';
    }
    mountPage();
    const brief = screen.getByTestId('home-energy-forecast-quality');
    expect(within(brief).getAllByText('0% confidence from 0 history sample(s)')).toHaveLength(2);
    expect(within(brief).getAllByText('No source history sample timestamp is available.')).toHaveLength(2);
    for (const metric of brief.querySelectorAll('[data-operational-metric]')) {
      expect(metric).toHaveAttribute('data-value-state', 'value');
    }
  });
});
