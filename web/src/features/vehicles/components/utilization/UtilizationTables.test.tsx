import type { ComponentProps, ReactElement } from 'react';
import { render as renderWithProviders, screen, within, type RenderOptions } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { objectsToCSV } from '@/lib/csvExport';
import { summarizeUtilization, type UtilizationSummary } from '../../lib/utilization';
import { BusiestDays } from './BusiestDays';
import { UtilizationMethodology } from './UtilizationMethodology';
import { WeekdayProfile } from './WeekdayProfile';
import { TimeCostOverview } from './TimeCostOverview';

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false, isError: false, error: null }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const chartBoundary = vi.hoisted(() => vi.fn());

vi.mock('@/components/charts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/charts')>();
  return {
    ...original,
    ChartContainer: (props: ComponentProps<typeof original.ChartContainer>) => {
      chartBoundary(props);
      return <original.ChartContainer {...props} />;
    },
  };
});

const display = vi.hoisted(() => ({
  formatDay: (day: string) => day,
  formatDistance: vi.fn((meters: number) => `${meters / 1000} km`),
  formatDuration: vi.fn((seconds: number) => `${seconds / 60} min`),
  formatEnergy: vi.fn((wh: number) => `${wh / 1000} kWh`),
  distanceUnit: 'km',
  toDisplayDistance: vi.fn((meters: number) => meters / 1000),
}));

vi.mock('./useUtilizationDisplay', () => ({
  useUtilizationDisplay: () => display,
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

const state = { isLoading: false, error: null, onRetry: vi.fn() };

function render(ui: ReactElement, options?: Omit<RenderOptions, 'queries'>) {
  return renderWithProviders(ui, { wrapper: MemoryRouter, ...options });
}

function summary(): UtilizationSummary {
  const empty = summarizeUtilization([], null, {
    rangeStart: '2026-09-01',
    rangeEnd: '2026-09-30',
    asOfMs: Date.parse('2026-10-01T00:00:00Z'),
    historyLimit: 1000,
  });
  return {
    ...empty,
    busiestDays: [
      { day: '2026-09-05', dayStartMs: 0, observedS: 86_400, driveCount: 2, drivingS: 3600, distanceM: 50_000, energyWh: 10_000, active: true },
      { day: '2026-09-04', dayStartMs: 0, observedS: 86_400, driveCount: 1, drivingS: 1800, distanceM: 10_000, energyWh: 0, active: true },
    ],
    accounting: { ...empty.accounting, returnedRows: 3, eligibleRows: 2, invalidTimestampRows: 1, usableDurationRows: 2 },
  };
}

describe('Shared utilization tables', () => {
  it.each([null, undefined, Number.NaN, Infinity, -Infinity])(
    'guards every time/cost display operand: %s', (value) => {
      const data = summary();
      data.accounting = { ...data.accounting, usableDurationRows: 1, usableDistanceRows: 1, usableEnergyRows: 1 };
      for (const key of ['drivingHours', 'drivingShare', 'distanceM', 'energyWh', 'ratePerKwh', 'totalEnergyCost', 'costPerKm', 'costPerDrivingHour', 'pricedDistanceM', 'pricedDrivingS']) {
        Reflect.set(data, key, value);
      }
      Reflect.set(data.window, 'observedDurationS', value);
      display.formatDistance.mockClear();
      display.formatEnergy.mockClear();
      render(<TimeCostOverview summary={data} state={state} />);
      expect(screen.getByTestId('utilization-time-cost')).not.toHaveTextContent(/NaN|Infinity|undefined|null/);
      expect(screen.getAllByRole('progressbar')).toHaveLength(2);
      for (const bar of screen.getAllByRole('progressbar')) {
        expect(bar).not.toHaveAttribute('aria-valuenow');
        expect(bar).toHaveTextContent('—');
      }
      expect(display.formatDistance).not.toHaveBeenCalled();
      expect(display.formatEnergy).not.toHaveBeenCalled();
    },
  );

  it('retains coverage counts and unknown time/distance when all measurements are missing', () => {
    const data = summary();
    data.accounting = {
      ...data.accounting, usableDurationRows: 0, usableDistanceRows: 0, usableEnergyRows: 0,
      excludedDurationRows: 2, excludedDistanceRows: 2, excludedEnergyRows: 2,
    };
    render(<TimeCostOverview summary={data} state={state} />);
    expect(screen.getByText('0 of 2 eligible drives')).toBeInTheDocument();
    expect(screen.getAllByText('Partial source coverage')).toHaveLength(2);
    for (const bar of screen.getAllByRole('progressbar')) expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText(/covered —/)).toBeInTheDocument();
    expect(screen.getByText('No eligible drives include usable energy measurements for this period.')).toBeInTheDocument();
  });

  it('keeps measured partial time but does not infer a complementary unrecorded duration', () => {
    const data = summary();
    data.window.observedDurationS = 7200;
    data.drivingHours = 0.5;
    data.drivingShare = 0.25;
    data.accounting.excludedDurationRows = 1;
    render(<TimeCostOverview summary={data} state={state} />);
    expect(screen.getByRole('progressbar', { name: 'Driving hours' })).toHaveAttribute('aria-valuenow', '0.5');
    expect(screen.getByRole('progressbar', { name: 'Time without a recorded drive' })).not.toHaveAttribute('aria-valuenow');
  });

  it('preserves measured zeros and zero-priced energy without inventing ratio denominators', () => {
    const data = summary();
    data.window.observedDurationS = 7200;
    data.accounting = { ...data.accounting, usableDurationRows: 2, usableDistanceRows: 2, usableEnergyRows: 2 };
    data.drivingHours = 0;
    data.drivingShare = 0;
    data.totalEnergyCost = 0;
    data.ratePerKwh = 0;
    render(<TimeCostOverview summary={data} state={state} />);
    expect(screen.getByRole('progressbar', { name: 'Driving hours' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar', { name: 'Time without a recorded drive' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText(/covered 0 km/)).toBeInTheDocument();
    expect(screen.getByText('0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('keeps both shells through loading, failure and empty recovery', () => {
    const view = render(<TimeCostOverview summary={summary()} state={{ ...state, isLoading: true }} />, { wrapper: MemoryRouter });
    expect(screen.getAllByRole('status', { name: 'Loading utilization analysis' })).toHaveLength(2);
    view.rerender(<TimeCostOverview summary={summary()} state={{ ...state, error: new Error('history unavailable') }} />);
    expect(screen.getByTestId('utilization-time-cost')).toHaveTextContent('Where the hours go');
    expect(screen.getByTestId('utilization-time-cost')).toHaveTextContent('Cost of motion');
    const empty = summarizeUtilization([], null, { rangeStart: '2026-09-01', rangeEnd: '2026-09-30', asOfMs: Date.parse('2026-10-01') });
    view.rerender(<TimeCostOverview summary={empty} state={state} />);
    expect(screen.getAllByText('No drives in this period yet.')).toHaveLength(2);
  });

  it('distinguishes paused without a source from a successful empty result', () => {
    const empty = summarizeUtilization([], null, { rangeStart: '2026-09-01', rangeEnd: '2026-09-30', asOfMs: Date.parse('2026-10-01') });
    const view = render(<TimeCostOverview summary={empty} state={state} hasSource={false} />);
    expect(screen.getAllByText('No source data')).toHaveLength(2);
    expect(screen.queryByText('No drives in this period yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    view.rerender(<TimeCostOverview summary={empty} state={state} hasSource />);
    expect(screen.getAllByText('No drives in this period yet.')).toHaveLength(2);
  });

  it('exports a missing weekday distance as blank while preserving real observed inactive counts', () => {
    const data = summarizeUtilization([{
      id: 1, vehicleId: 1, startTs: '2026-09-01T08:00:00Z',
      durationS: null, distanceM: null, energyUsedWh: null,
      endTs: null, startAddress: null, endAddress: null,
      startLat: null, startLon: null, endLat: null, endLon: null,
      startBatteryPct: null, endBatteryPct: null, regenEnergyWh: null,
      avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
      outsideTempAvgC: null, insideTempAvgC: null, score: null,
      endedStatus: null, createdAt: '', updatedAt: '',
    }], null, {
      rangeStart: '2026-09-01', rangeEnd: '2026-09-02', asOfMs: Date.parse('2026-10-01'),
    });
    render(<WeekdayProfile summary={data} state={state} />);
    const props = chartBoundary.mock.calls.at(-1)![0];
    expect(props.data[2]).toMatchObject({ activeRate: 100, averageDistance: null, drives: 1, observedDays: 1 });
    expect(props.data[3]).toMatchObject({ activeRate: 0, averageDistance: null, drives: 0, observedDays: 1 });
    expect(objectsToCSV(props.exportData).split('\r\n')).toContain('Wed,0,,0,1');
  });

  it.each([null, undefined, Number.NaN, Infinity, -Infinity])(
    'retains unknown weekday metrics at chart, table and export boundaries: %s',
    (value) => {
      const data = summary();
      data.weekdays = [{
        ...data.weekdays[0]!,
        observedDays: 1,
        activeDays: 1,
        activeDayShare: null,
        averageDistancePerActiveDayM: null,
      }];
      Reflect.set(data.weekdays[0]!, 'activeDayShare', value);
      Reflect.set(data.weekdays[0]!, 'averageDistancePerActiveDayM', value);
      render(<WeekdayProfile summary={data} state={state} />);
      const props = chartBoundary.mock.calls.at(-1)![0];
      expect(props.data).toEqual([expect.objectContaining({
        activeRate: null, averageDistance: null,
      })]);
      expect(props.exportData).toBe(props.data);
      expect(objectsToCSV(props.exportData).split('\r\n')[1]).toBe('Sun,,,0,1');
      expect(props.dataColumns[1].format(null)).toBe('—');
      expect(props.dataColumns[2].format(null)).toBe('—');
      const table = screen.getByRole('table');
      expect(within(table).getAllByRole('cell').filter((cell) => cell.textContent === '—')).toHaveLength(2);
    },
  );

  it.each([
    [0, 0],
    [-0.125, -1234.567],
    [0.00125, 12.345],
  ])('preserves observed zero, signed and fractional weekday values: %s / %s', (share, meters) => {
    const data = summary();
    data.weekdays = [{
      ...data.weekdays[0]!,
      observedDays: 2, activeDays: 1,
      activeDayShare: share, averageDistancePerActiveDayM: meters,
    }];
    render(<WeekdayProfile summary={data} state={state} />);
    const props = chartBoundary.mock.calls.at(-1)![0];
    expect(props.data[0].activeRate).toBe(share * 100);
    expect(props.data[0].averageDistance).toBe(meters / 1000);
    expect(props.exportData).toBe(props.data);
    expect(objectsToCSV(props.exportData).split('\r\n')[1]).toBe(`Sun,${share * 100},${meters / 1000},0,2`);
    expect(props.dataColumns[1].format(0)).not.toBe('—');
    expect(props.dataColumns[2].format(0)).not.toBe('—');
  });

  it.each([0, Number.NaN, Infinity, -1])('does not present zero without valid weekday denominators: %s', (denominator) => {
    const data = summary();
    data.weekdays = [{
      ...data.weekdays[0]!,
      observedDays: denominator, activeDays: denominator,
      activeDayShare: 0, averageDistancePerActiveDayM: 0,
    }];
    render(<WeekdayProfile summary={data} state={state} />);
    const props = chartBoundary.mock.calls.at(-1)![0];
    expect(props.data[0]).toMatchObject({ activeRate: null, averageDistance: null });
    expect(props.exportData).toBe(props.data);
  });

  it('retains desktop ranking and all mobile fields without claiming a complete filter universe', () => {
    render(<BusiestDays summary={summary()} state={state} />);
    const table = screen.getByRole('table', { name: 'Ranked busiest observed days' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('#1');
    expect(rows[1]).toHaveTextContent('2026-09-05');
    expect(rows[1]).toHaveTextContent('50 km');
    expect(rows[1]).toHaveTextContent('10 kWh');
    expect(rows[2]).toHaveTextContent('—');
    expect(table.closest('.hidden')).toHaveClass('sm:block');
    const mobile = screen.getByRole('list');
    expect(mobile).toHaveClass('sm:hidden');
    expect(within(mobile).getAllByRole('listitem')).toHaveLength(2);
    expect(within(mobile).getByText('50 km')).toBeInTheDocument();
    expect(display.formatDistance).toHaveBeenCalledWith(50_000);
    expect(display.formatEnergy).toHaveBeenCalledWith(10_000);
    expect(within(table).queryByRole('button', { name: /filter/i })).not.toBeInTheDocument();
  });

  it('retains timestamp and field accounting, zero counts, and methodology notes', () => {
    render(<UtilizationMethodology summary={summary()} historyLimit={1000} state={state} />);
    const exclusions = screen.getByRole('table', { name: 'Timestamp eligibility' });
    expect(within(exclusions).getAllByRole('rowheader')).toHaveLength(4);
    const invalid = within(exclusions).getByRole('rowheader', { name: 'Invalid or missing timestamp' }).closest('tr')!;
    expect(within(invalid).getByRole('cell')).toHaveTextContent('1');
    const future = within(exclusions).getByRole('rowheader', { name: 'At or after frozen as-of time' }).closest('tr')!;
    expect(within(future).getByRole('cell')).toHaveTextContent('0');
    const coverage = screen.getByRole('table', { name: 'Metric field coverage' });
    expect(within(coverage).getAllByRole('rowheader')).toHaveLength(3);
    expect(coverage).toHaveTextContent('2 usable · 0 excluded');
    expect(screen.getByRole('list', { name: 'Methodology notes' })).toHaveTextContent('display units are applied only while rendering');
  });

  it('keeps the ranked section shell while loading', () => {
    render(<BusiestDays summary={summary()} state={{ ...state, isLoading: true }} />);
    expect(screen.getByTestId('utilization-busiest')).toHaveTextContent('Busiest observed days');
    expect(screen.getByRole('status', { name: 'Loading utilization analysis' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
