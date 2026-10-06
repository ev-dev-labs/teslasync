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
}));
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
  expect(container.querySelectorAll('[data-stat]')).toHaveLength(6);
  for (const title of [
    'Scenario & assumptions', 'Vehicle assumptions', 'Energy flow schedule',
    'Per-vehicle readiness', 'Powerwall trajectory', 'Tariff & constraint heatmap',
    'Constraint violations', 'Assumptions & forecast quality', 'Export plan',
  ]) expect(screen.getByText(title)).toBeInTheDocument();
}
beforeEach(() => {
  vi.clearAllMocks();
  h.charts = [];
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
    const strip = container.querySelector('[data-stat-strip]');
    expect(strip).toHaveAttribute('data-period-kind', 'analysis');
    expect(strip).toHaveTextContent(`${start} — 2026-01-01T06:00:00.000Z (end exclusive)`);
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
      expect(container.querySelectorAll('[data-stat-value]')).toHaveLength(0);
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
});
