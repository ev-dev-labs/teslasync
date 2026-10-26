import type { ComponentProps, ReactElement } from 'react';
import { act, render as renderWithProviders, renderHook, screen, within, type RenderOptions } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { objectsToCSV } from '@/lib/csvExport';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { summarizeUtilization, type UtilizationSummary } from '../../lib/utilization';
import { BusiestDays } from './BusiestDays';
import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { UtilizationMethodology } from './UtilizationMethodology';
import { WeekdayProfile } from './WeekdayProfile';
import { TimeCostOverview } from './TimeCostOverview';
import { UtilizationTrend } from './UtilizationTrend';

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
  formatDayShort: (day: string) => day,
  formatDistance: vi.fn((meters: number) => `${meters / 1000} km`),
  formatDuration: vi.fn((seconds: number) => `${seconds / 60} min`),
  formatEnergy: vi.fn((wh: number) => `${wh / 1000} kWh`),
  distanceUnit: 'km',
  toDisplayDistance: vi.fn((meters: number) => meters / 1000),
}));

const datePreferences = vi.hoisted(() => ({ locale: 'de-DE', tz: 'America/Los_Angeles' }));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => datePreferences,
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', locale: 'en-US' },
    formatDistance: display.formatDistance,
    formatEnergy: display.formatEnergy,
  }),
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
    timezone: 'UTC',
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
  it('refreshes both calendar labels when the effective saved locale changes', async () => {
    const { useUtilizationDisplay } = await vi.importActual<typeof import('./useUtilizationDisplay')>('./useUtilizationDisplay');
    datePreferences.locale = 'de-DE';
    const { result, rerender } = renderHook(useUtilizationDisplay);
    const previous = result.current;
    expect(previous.formatDay('2026-01-01')).toBe('1. Jan. 2026');
    expect(previous.formatDayShort('2026-01-01')).toBe('1. Jan.');
    datePreferences.locale = 'fr-FR';
    rerender();
    expect(result.current.formatDay).not.toBe(previous.formatDay);
    expect(result.current.formatDayShort).not.toBe(previous.formatDayShort);
    expect(result.current.formatDay('2026-01-01')).toBe('1 janv. 2026');
    expect(result.current.formatDayShort('2026-01-01')).toBe('1 janv.');
  });

  it.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
    'preserves calendar day identity at year, leap-day and DST boundaries in %s',
    async (tz) => {
      const { useUtilizationDisplay } = await vi.importActual<typeof import('./useUtilizationDisplay')>('./useUtilizationDisplay');
      datePreferences.locale = 'de-DE';
      datePreferences.tz = tz;
      const { result, rerender } = renderHook(useUtilizationDisplay);
      for (const [day, long, short] of [
        ['2026-01-01', '1. Jan. 2026', '1. Jan.'],
        ['2024-02-29', '29. Feb. 2024', '29. Feb.'],
        ['2026-03-08', '8. März 2026', '8. März'],
        ['2026-11-01', '1. Nov. 2026', '1. Nov.'],
        ['2026-12-31', '31. Dez. 2026', '31. Dez.'],
      ]) {
        expect(result.current.formatDay(day)).toBe(long);
        expect(result.current.formatDayShort(day)).toBe(short);
      }
      const previous = result.current;
      datePreferences.tz = 'UTC';
      rerender();
      expect(result.current.formatDay).toBe(previous.formatDay);
      expect(result.current.formatDayShort).toBe(previous.formatDayShort);
    },
  );

  it.each([null, undefined, '', 'invalid', '2026-02-29', '2026-13-01', '2026-01-01T00:00:00Z'])(
    'uses the shared placeholder for invalid or missing calendar keys: %s',
    async (day) => {
      const { useUtilizationDisplay } = await vi.importActual<typeof import('./useUtilizationDisplay')>('./useUtilizationDisplay');
      datePreferences.locale = 'de-DE';
      const { result } = renderHook(useUtilizationDisplay);
      expect(result.current.formatDay(day)).toBe('—');
      expect(result.current.formatDayShort(day)).toBe('—');
    },
  );

  it.each([
    ['en-US', 3, '12.346', '2.346', '1.235'],
    ['de-DE', 2, '12,35', '2,35', '1,23'],
  ])('preserves monthly operands until formatting with %s precision %s', (locale, precision, distance, observedDays, drivingHours) => {
    const preferences = getFormatterPreferences();
    const data = summary();
    data.months = [{
      month: '2026-09', monthStartMs: Date.parse('2026-09-01'),
      distanceM: 12_345.678, observedDays: 2.345678, drivingS: 4444.444,
      activeDays: 2, driveCount: 3, drivingShare: 0.1, energyWh: 1000,
    }];
    try {
      act(() => {
        setGlobalLocale(locale);
        setGlobalPrecision(precision);
      });
      render(<UtilizationTrend summary={data} state={state} />);
      const props = chartBoundary.mock.calls.at(-1)![0];
      const row = props.data[0];
      expect(row).toEqual({
        month: '2026-09-01', monthKey: '2026-09',
        distance: 12.345678, observedDays: 2.345678,
        drivingHours: 4444.444 / 3600, activeDays: 2, drives: 3,
      });
      expect(props.exportData).toBe(props.data);
      expect(objectsToCSV(props.exportData).split('\r\n')[1]).toBe(
        `2026-09-01,2026-09,12.345678,2,2.345678,3,${4444.444 / 3600}`,
      );
      expect(props.dataColumns[1].format(row.distance)).toBe(distance);
      expect(props.dataColumns[2].format(row.activeDays)).toBe('2');
      expect(props.dataColumns[3].format(row.observedDays)).toBe(observedDays);
      expect(props.dataColumns[4].format(row.drives)).toBe('3');
      expect(props.dataColumns[5].format(row.drivingHours)).toBe(drivingHours);
      const table = screen.getByRole('table');
      for (const value of [distance, observedDays, drivingHours]) {
        expect(within(table).getByRole('cell', { name: value })).toBeInTheDocument();
      }
    } finally {
      act(() => {
        setGlobalLocale(preferences.locale);
        setGlobalPrecision(preferences.precision);
      });
    }
  });

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
    const empty = summarizeUtilization([], null, { timezone: 'UTC', rangeStart: '2026-09-01', rangeEnd: '2026-09-30', asOfMs: Date.parse('2026-10-01') });
    view.rerender(<TimeCostOverview summary={empty} state={state} />);
    expect(screen.getAllByText('No drives in this period yet.')).toHaveLength(2);
  });

  it('distinguishes paused without a source from a successful empty result', () => {
    const empty = summarizeUtilization([], null, { timezone: 'UTC', rangeStart: '2026-09-01', rangeEnd: '2026-09-30', asOfMs: Date.parse('2026-10-01') });
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
      timezone: 'UTC', rangeStart: '2026-09-01', rangeEnd: '2026-09-02', asOfMs: Date.parse('2026-10-01'),
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

  it.each([false, true])('uses neutral methodology chrome while preserving cap warnings: capped=%s', (historyCapReached) => {
    const data = summary();
    data.accounting.historyCapReached = historyCapReached;
    render(<UtilizationMethodology summary={data} historyLimit={1000} state={state} />);
    const panel = screen.getByTestId('utilization-method');
    const titleIcon = panel.querySelector('svg.lucide-database');
    expect(titleIcon).toHaveClass('text-[var(--text-secondary)]');
    expect(titleIcon).toHaveAttribute('aria-hidden', 'true');
    const notes = screen.getByRole('list', { name: 'Methodology notes' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(6);
    for (const icon of notes.querySelectorAll('svg')) {
      expect(icon.parentElement).toHaveClass('text-[var(--text-secondary)]');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    const badge = screen.getByText(historyCapReached ? '1,000-drive cap reached' : 'Ranged response below API cap');
    const callout = screen.getByText(historyCapReached
      ? 'The request returned 1,000 rows. Results describe that capped ranged response; additional matching drives may exist.'
      : 'The ranged response returned 3 rows below the 1,000-drive API limit.').parentElement;
    if (historyCapReached) {
      expect(badge).toHaveClass('text-[var(--semantic-warning)]');
      expect(callout).toHaveClass('border-[var(--semantic-warning-border)]', 'bg-[var(--semantic-warning-bg)]');
      assertOperationalBriefDisclosure(screen.getByTestId('utilization-coverage-summary'), 'Partial source coverage');
    } else {
      expect(badge).toHaveClass('text-[var(--text-secondary)]');
      expect(callout).toHaveClass('border-[var(--border-default)]', 'bg-[var(--surface-2)]');
      expect(callout).not.toHaveClass('bg-[var(--semantic-warning-bg)]');
    }
    expect(screen.getByRole('table', { name: 'Timestamp eligibility' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Metric field coverage' })).toHaveTextContent('2 usable · 0 excluded');
  });

  it('keeps the ranked section shell while loading', () => {
    render(<BusiestDays summary={summary()} state={{ ...state, isLoading: true }} />);
    expect(screen.getByTestId('utilization-busiest')).toHaveTextContent('Busiest observed days');
    expect(screen.getByRole('status', { name: 'Loading utilization analysis' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
