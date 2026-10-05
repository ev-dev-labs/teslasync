import type { ComponentProps, PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { ChartContainerProps } from '@/components/charts';
import { ToastProvider } from '@/components/feedback';
import type { DataTable } from '@/components/ui';
import type { Drive, RegenEfficiencyData } from '@/types/driving';
import type { RankedRegenDrive } from '../../lib/regenEfficiency';

type TableProps = ComponentProps<typeof DataTable<RankedRegenDrive>>;
const h = vi.hoisted(() => ({
  aggregate: {} as DataStateSource<RegenEfficiencyData>,
  detail: {} as DataStateSource<Drive[]>,
  aggregateHook: vi.fn(),
  drivesHook: vi.fn(),
  table: undefined as TableProps | undefined,
  gauges: [] as number[],
  bars: [] as number[],
  charts: [] as ChartContainerProps[],
  energyUnit: 'kWh' as 'kWh' | 'Wh',
}));
vi.mock('@/api/hooks/useDriving', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useDriving')>(),
  useRegenEfficiency: (...args: unknown[]) => { h.aggregateHook(...args); return h.aggregate; },
  useDrives: (...args: unknown[]) => { h.drivesHook(...args); return h.detail; },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-01-01T08:00:00Z',
    endInstantExclusive: '2026-02-01T08:00:00Z',
    timezone: 'America/Los_Angeles',
  }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => 'America/Los_Angeles',
}));
// Keep motion and every other real export for shared chart/error providers.
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: PropsWithChildren) => <>{children}</>,
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { energy: h.energyUnit, distance: 'km', speed: 'km/h', temperature: '°C', duration: 'h', pressure: 'bar', power: 'kW', precision: 1, locale: 'en-US' },
    formatEnergy: (v: unknown) => v == null ? '—' : `energy[${v}]`,
    formatDistance: (v: unknown) => v == null ? '—' : `distance[${v}]`,
    formatDuration: (v: unknown) => v == null ? '—' : `duration[${v}]`,
    formatSpeed: (v: unknown) => v == null ? '—' : `speed[${v}]`,
    formatTemperature: (v: unknown) => v == null ? '—' : `temperature[${v}]`,
  }),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...actual,
    ChartContainer: (props: ChartContainerProps) => {
      h.charts.push(props);
      return <actual.ChartContainer {...props} />;
    },
    LinearGauge: ({ value }: { value: number }) => {
      h.gauges.push(value);
      return <span data-testid="known-gauge">{value}</span>;
    },
  };
});
vi.mock('@/components/data-display', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/data-display')>(),
  MetricBar: ({ value, label }: { value: number; label: string }) => {
    h.bars.push(value);
    return <span>{label}: {value}</span>;
  },
}));
vi.mock('@/components/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui')>(),
  DataTable: (props: TableProps) => {
    h.table = props;
    return <div data-testid="captured-table">
      {props.columns.map(column => <div key={column.key}>{column.header}{props.data.map(row =>
        <div key={props.keyExtractor(row)}>{column.render(row)}</div>,
      )}</div>)}
    </div>;
  },
}));

import RegenEfficiencyPage from '../../pages/RegenEfficiencyPage';

const aggregate: RegenEfficiencyData = {
  vehicleId: 7, totalRegenWh: 50_000, totalDriveWh: 200_000,
  regenRatio: 25, freeCharges: 0.7, monthlyAvgRegen: 7_000,
  monthlySummary: [], drives: [], batteryCapacityWh: 75_000, capacitySource: 'vin_estimate',
};
const drive: Drive = {
  id: 1, vehicleId: 7, startTs: '2026-01-15T12:00:00Z', endTs: '2026-01-15T12:30:00Z',
  durationS: 1_800, distanceM: 25_000, startAddress: null, endAddress: null,
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: 70, endBatteryPct: 60, energyUsedWh: 8_000,
  regenEnergyWh: 2_000, avgSpeedMps: 15, maxSpeedMps: 30, avgPowerW: 4_000,
  outsideTempAvgC: 15, insideTempAvgC: 21, score: null, endedStatus: 'completed',
  createdAt: '2026-01-15T12:00:00Z', updatedAt: '2026-01-15T12:30:00Z',
};
const retryAggregate = vi.fn();
const retryDetail = vi.fn();
function query<T>(data?: T, overrides: Partial<DataStateSource<T>> = {}): DataStateSource<T> {
  return {
    data, isSuccess: data !== undefined, isLoading: false, isPending: data === undefined,
    isError: false, isFetching: false, error: null, fetchStatus: 'idle',
    dataUpdatedAt: data === undefined ? 0 : Date.now(), ...overrides,
  };
}
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // wrapper also owns rerenders: never rerender the real shared providers bare.
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}><ToastProvider>
      <MemoryRouter initialEntries={['/driving/regen']}>{children}</MemoryRouter>
    </ToastProvider></QueryClientProvider>;
  }
  return render(<RegenEfficiencyPage />, { wrapper: Wrapper });
}
const sections = [
  'regen-kpis', 'regen-overview', 'regen-monthly', 'regen-distribution',
  'regen-temperature', 'regen-soc', 'regen-evidence', 'regen-methodology',
];
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  h.gauges = [];
  h.bars = [];
  h.charts = [];
  h.energyUnit = 'kWh';
  h.table = undefined;
  h.aggregate = query(aggregate, { refetch: retryAggregate });
  h.detail = query([drive], { refetch: retryDetail });
});

describe('live regen presentation preservation', () => {
  it('keeps exact query operands, all sections and specialist formatter output', () => {
    harness();
    sections.forEach(id => expect(screen.getByTestId(id)).toBeInTheDocument());
    expect(h.aggregateHook).toHaveBeenCalledWith('7', '2026-01-01T08:00:00Z', '2026-02-01T08:00:00Z');
    expect(h.drivesHook).toHaveBeenCalledWith('7', {
      start: '2026-01-01T08:00:00Z', end: '2026-02-01T08:00:00Z', limit: 1000,
    });
    expect(within(screen.getByTestId('regen-kpis')).getByText('energy[50000]')).toBeInTheDocument();
    expect(h.gauges).toContain(25);
    expect(h.table?.tableId).toBe('driving:regen-ranked-evidence');
    expect(h.table?.keyExtractor(h.table.data[0]!)).toBe('1:1');
    expect(h.table?.columns.map(column => column.key)).toEqual([
      'rank', 'date', 'recovered', 'ratio', 'driveEnergy', 'distance', 'duration', 'speed', 'soc', 'temperature',
    ]);
    const row = h.table!.data[0]!;
    expect(h.table!.mobilePresentation?.displayValue(row, 'distance')).toBe('distance[25000]');
    expect(h.table!.mobilePresentation?.displayValue(row, 'duration')).toBe('duration[1800]');
    expect(h.table!.mobilePresentation?.displayValue(row, 'speed')).toBe('speed[15]');
    expect(h.table!.mobilePresentation?.displayValue(row, 'temperature')).toBe('temperature[15]');
    expect(h.table!.mobilePresentation?.canShowField).toBeUndefined();
    expect(h.table!.mobilePresentation?.onOpenRow).toBeUndefined(); // shared all-fields modal
    expect(h.table!.exportable).toBeUndefined(); // existing shared export default
    expect(h.table!.density).toBe('compact');
    const monthly = h.charts.find(chart => chart.chartKey === 'regen-monthly-recovery')!;
    expect(monthly.exportable).toBe(true);
    expect(monthly.fullscreen).toBeUndefined(); // preserve original default, not invented enablement
    expect(monthly.exportFilename).toBe('regen-monthly-recovery');
    expect(monthly.dataColumns?.map(column => column.key)).toEqual([
      'month', 'recoveredEnergy', 'driveEnergy', 'recoveryRatio', 'eligible', 'returned',
    ]);
    expect(monthly.data).toEqual([{
      month: '2026-01', recoveredEnergy: 2, driveEnergy: 8, recoveryRatio: 25, eligible: 1, returned: 1,
    }]);
    expect(monthly.exportData).toEqual([{
      Month: '2026-01', 'Recovered energy (kWh)': 2, 'Drive energy (kWh)': 8,
      'Weighted recovery share': 25, 'Eligible drives': 1, 'Returned drives': 1,
    }]);
    const distribution = h.charts.find(chart => chart.exportFilename === 'regen-ratio-distribution')!;
    expect(distribution.data).toHaveLength(6);
    expect(distribution.dataColumns?.map(column => column.key)).toEqual(['bucket', 'drives', 'share']);
  });
  it('keeps all shells for pending, failed, resolved-empty and retained rerenders', () => {
    h.aggregate = query(undefined, { isLoading: true });
    h.detail = query(undefined, { isLoading: true });
    const view = harness();
    sections.forEach(id => expect(screen.getByTestId(id)).toBeInTheDocument());
    h.aggregate = query(undefined, { error: new Error('aggregate failure'), isError: true, refetch: retryAggregate });
    h.detail = query([drive], { refetch: retryDetail });
    view.rerender(<RegenEfficiencyPage />);
    sections.forEach(id => expect(screen.getByTestId(id)).toBeInTheDocument());
    expect(screen.getByTestId('captured-table')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('regen-kpis-aggregate-error')).getByRole('button'));
    expect(retryAggregate).toHaveBeenCalledTimes(1);
    h.aggregate = query(aggregate, { error: new Error('refresh failed'), isError: true, isSuccess: false, refetch: retryAggregate });
    h.detail = query([drive], { error: new Error('detail refresh failed'), isError: true, isSuccess: false, refetch: retryDetail });
    view.rerender(<RegenEfficiencyPage />);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(within(screen.getByTestId('regen-kpis')).getByText('energy[50000]')).toBeInTheDocument();
    expect(screen.getByTestId('captured-table')).toBeInTheDocument();
    h.aggregate = query({ ...aggregate, totalRegenWh: 0, totalDriveWh: 0, regenRatio: 0 });
    h.detail = query([]);
    view.rerender(<RegenEfficiencyPage />);
    sections.forEach(id => expect(screen.getByTestId(id)).toBeInTheDocument());
    expect(screen.queryByTestId('captured-table')).not.toBeInTheDocument();
  });
  it('does not turn disabled/unresolved data into observed zeros or success', () => {
    h.aggregate = query(undefined);
    h.detail = query(undefined);
    harness();
    expect(h.gauges).toHaveLength(0);
    expect(h.bars).toHaveLength(0);
    expect(screen.queryByText('Complete aggregate loaded')).not.toBeInTheDocument();
    expect(screen.queryByTestId('captured-table')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('regen-kpis')).queryByText('0 / 0')).not.toBeInTheDocument();
  });
  it('distinguishes invalid aggregate ratios, unknown buckets and legitimate measured zero', () => {
    h.aggregate = query({ ...aggregate, regenRatio: Number.NaN, freeCharges: Number.POSITIVE_INFINITY });
    h.detail = query([{ ...drive, regenEnergyWh: 0 }]);
    const view = harness();
    expect(h.gauges).toHaveLength(0);
    expect(h.bars).toEqual([0, 0]);
    expect(screen.getByText('Recovery share is unavailable; no zero value is inferred.')).toBeInTheDocument();
    expect(h.table!.data[0]!.recoveryRatioPct).toBe(0);
    expect(h.table!.mobilePresentation?.displayValue(h.table!.data[0]!, 'recovered')).toBe('energy[0]');
    h.bars = [];
    h.detail = query([{ ...drive, regenEnergyWh: null }]);
    view.rerender(<RegenEfficiencyPage />);
    expect(h.bars).toHaveLength(0);
    expect(screen.queryByTestId('captured-table')).not.toBeInTheDocument();
  });
  it('retains cap accounting and flags contradictory aggregate zero totals', () => {
    h.aggregate = query({ ...aggregate, totalRegenWh: 0, totalDriveWh: 0, regenRatio: 0 });
    h.detail = query(Array.from({ length: 1000 }, (_, index) => ({ ...drive, id: index + 1 })));
    harness();
    expect(screen.getByText('Aggregate totals unavailable')).toBeInTheDocument();
    expect(h.gauges).toHaveLength(0);
    expect(h.table!.data).toHaveLength(10);
    expect(h.table!.data.map(row => row.driveId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(within(screen.getByTestId('regen-kpis')).getByText(/row cap reached/)).toBeInTheDocument();
  });
  it('changes display units on rerender without rewriting raw rows, ratios or query operands', () => {
    const view = harness();
    h.energyUnit = 'Wh';
    h.charts = [];
    view.rerender(<RegenEfficiencyPage />);
    const monthly = h.charts.find(chart => chart.chartKey === 'regen-monthly-recovery')!;
    expect(monthly.data).toEqual([{
      month: '2026-01', recoveredEnergy: 2000, driveEnergy: 8000, recoveryRatio: 25, eligible: 1, returned: 1,
    }]);
    expect(h.table!.data[0]!.regenEnergyWh).toBe(2000);
    expect(h.table!.data[0]!.driveEnergyWh).toBe(8000);
    expect(h.detail.data?.[0]).toBe(drive);
    expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
      start: '2026-01-01T08:00:00Z', end: '2026-02-01T08:00:00Z', limit: 1000,
    });
  });
});
