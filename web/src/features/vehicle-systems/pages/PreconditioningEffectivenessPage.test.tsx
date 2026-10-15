import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { Drive } from '@/types/driving';
import type { ClimateState } from '@/types/vehicle-systems';
import { formatDateTime } from '@/lib/dateFormat';
import {
  getFormatterPreferences,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat';

const BASE = Date.UTC(2026, 7, 8, 12);
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  climateQuery: undefined as unknown,
  driveQuery: undefined as unknown,
  climateHook: vi.fn(),
  driveHook: vi.fn(),
  climateRefetch: vi.fn(),
  driveRefetch: vi.fn(),
  range: {
    startInstant: '2026-08-01T00:00:00Z',
    endInstantExclusive: '2026-08-09T00:00:00Z',
  },
  temperature: '°C' as '°C' | '°F',
  dateLocale: 'en-US',
  dateTimezone: 'UTC',
}));

vi.mock('@/hooks/useDateFormat', async (importOriginal) => {
  // wrapped-real-hook: keep every real formatter, override only what this file controls.
  const actual = await importOriginal<typeof import('@/hooks/useDateFormat')>();
  const overrides = await (() => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | Date | null | undefined) =>
      formatDateTime(value, { locale: h.dateLocale, tz: h.dateTimezone }),
  }),
}))();
  return {
    ...actual,
    ...overrides,
    useDateFormat: (...args: Parameters<typeof actual.useDateFormat>) => ({
      ...actual.useDateFormat(...args),
      ...overrides.useDateFormat(...args),
    }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      const values =
        options && typeof options === 'object'
          ? (options as Record<string, unknown>)
          : {};
      return text.replace(
        /\{\{\s*(\w+)\s*\}\}/g,
        (_match, name: string) =>
          values[name] != null ? String(values[name]) : '',
      );
    },
    i18n: { language: 'en-US', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: (vehicleId: string | undefined, limit: number, range?: { start?: string; end?: string }) => {
    h.driveHook(vehicleId, limit, range);
    return h.driveQuery;
  },
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: (vehicleId: string, range?: { start?: string; end?: string }) => {
    h.climateHook(vehicleId, range);
    return h.climateQuery;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => h.range,
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      temperature: h.temperature,
      duration: 'min',
      locale: 'en-US',
      precision: 1,
    },
    formatDuration: (
      value: number | null | undefined,
      options?: { precision?: number },
    ) =>
      value == null || !Number.isFinite(value)
        ? '—'
        : `${(value / 60).toFixed(options?.precision ?? 1)} min`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select">Vehicle picker</div>,
}));

vi.mock('@/components/charts', () => {
  const hiddenSeries = {
    isHidden: () => false,
    toggle: vi.fn(),
  };
  return {
    Bar: () => null,
    BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    CartesianGrid: () => null,
    ChartLegend: () => null,
    ChartTooltip: () => null,
    EmbeddedChart: ({
      children,
      title,
      ariaLabel,
    }: {
      children:
        | ReactNode
        | ((context: {
            annotations: [];
            hidden: false;
            hiddenSeries: typeof hiddenSeries;
          }) => ReactNode);
      title: string;
      ariaLabel: string;
    }) => (
      <div>
        <h4>{title}</h4>
        <div role="img" aria-label={ariaLabel}>
          {typeof children === 'function'
            ? children({ annotations: [], hidden: false, hiddenSeries })
            : children}
        </div>
      </div>
    ),
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

import PreconditioningEffectivenessPage from './PreconditioningEffectivenessPage';
import { summarizePreconditioningEffectiveness } from '../lib/preconditioningEffectiveness';
import { PreconditioningThresholdConfidence } from '../components/preconditioning-effectiveness/PreconditioningThresholdConfidence';
import { PreconditioningEvidenceLedger } from '../components/preconditioning-effectiveness/PreconditioningEvidenceLedger';
import { PreconditioningJoinSupport } from '../components/preconditioning-effectiveness/PreconditioningJoinSupport';
import { PreconditioningHourlyProfile } from '../components/preconditioning-effectiveness/PreconditioningHourlyProfile';
import type { PreconditioningQueryState } from '../components/preconditioning-effectiveness/types';

interface QueryStub<T> {
  data: T | undefined;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function query<T>(
  refetch: () => void,
  overrides: Partial<QueryStub<T>> = {},
): QueryStub<T> {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isPending: overrides.isPending ?? isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    isFetching: isLoading,
    fetchStatus: overrides.fetchStatus ?? (isLoading ? 'fetching' : 'idle'),
    isStale: false,
    dataUpdatedAt: BASE,
    refetch,
    ...overrides,
  };
}

function drive(id: number, departureMs: number): Drive {
  return {
    id,
    vehicleId: 7,
    startTs: new Date(departureMs).toISOString(),
    endTs: null,
    durationS: 600,
    distanceM: 1_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    energyUsedWh: null,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

function climateAt(
  departureMs: number,
  minutesBefore: number,
  insideTemp: number | null,
  hvacPower: boolean | null,
  overrides: Partial<ClimateState> = {},
): ClimateState {
  return {
    timestamp: new Date(
      departureMs - minutesBefore * 60_000,
    ).toISOString(),
    insideTemp,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower,
    ...overrides,
  };
}

function comparisonEvidence(): {
  climate: ClimateState[];
  drives: Drive[];
} {
  const second = BASE + 2 * 60 * 60_000;
  return {
    climate: [
      climateAt(BASE, 30, 35, false),
      climateAt(BASE, 5, 24, true),
      climateAt(second, 30, 34, false),
      climateAt(second, 5, 33, false),
    ],
    drives: [drive(1, BASE), drive(2, second)],
  };
}

function excludedEvidence(): {
  climate: ClimateState[];
  drives: Drive[];
} {
  const targetDeparture = BASE + 2 * 60 * 60_000;
  const ambiguousDeparture = BASE + 4 * 60 * 60_000;
  return {
    climate: [
      climateAt(BASE, 40, 35, true),
      climateAt(BASE, 20, 25, true),
      climateAt(targetDeparture, 30, 35, true),
      climateAt(targetDeparture, 5, 25, true, {
        driverTempSetting: 24,
        passengerTempSetting: 24,
      }),
      climateAt(ambiguousDeparture, 30, 35, false),
      climateAt(ambiguousDeparture, 20, null, null),
      climateAt(ambiguousDeparture, 5, 24, false),
    ],
    drives: [
      drive(1, BASE),
      drive(2, targetDeparture),
      drive(3, ambiguousDeparture),
    ],
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/preconditioning-effectiveness']}>
      <PreconditioningEffectivenessPage />
    </MemoryRouter>,
  );
}

const sectionIds = [
  'preconditioning-kpis',
  'preconditioning-source-coverage',
  'preconditioning-climate-disposition',
  'preconditioning-departure-disposition',
  'preconditioning-join-support',
  'preconditioning-hourly-profile',
  'preconditioning-readiness-comparison',
  'preconditioning-improvement-comparison',
  'preconditioning-strata',
  'preconditioning-improvement-distribution',
  'preconditioning-threshold-confidence',
  'preconditioning-departure-directory',
  'preconditioning-accounting',
  'preconditioning-availability',
  'preconditioning-methodology',
] as const;

function expectEverySection(): void {
  for (const id of sectionIds) {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  }
}

function expectDispositionCount(label: string, count: string): void {
  const section = screen.getByTestId('preconditioning-departure-disposition');
  const labelNode = within(section).getByText(label);
  expect(within(labelNode.parentElement!).getByText(count)).toBeInTheDocument();
}

let originalFormatterPreferences = getFormatterPreferences();

beforeEach(() => {
  originalFormatterPreferences = getFormatterPreferences();
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.range = {
    startInstant: '2026-08-01T00:00:00Z',
    endInstantExclusive: '2026-08-09T00:00:00Z',
  };
  h.temperature = '°C';
  h.dateLocale = 'en-US';
  h.dateTimezone = 'UTC';
  const evidence = comparisonEvidence();
  h.climateQuery = query(h.climateRefetch, { data: evidence.climate });
  h.driveQuery = query(h.driveRefetch, { data: evidence.drives });
});

afterEach(() => {
  setGlobalPrecision(originalFormatterPreferences.precision);
  setGlobalLocale(originalFormatterPreferences.locale);
});

describe('PreconditioningEffectivenessPage', () => {
  it('passes shared rolling and timezone-aware custom bounds to both sources without another picker', () => {
    const view = renderPage();
    for (const range of [
      h.range,
      { startInstant: '2026-08-08T12:42:19.125Z', endInstantExclusive: '2026-08-09T12:42:19.125Z' },
      { startInstant: '2024-03-09T00:00:00-08:00', endInstantExclusive: '2024-03-11T00:00:00-07:00' },
    ]) {
      h.range = range;
      view.rerender(
        <MemoryRouter initialEntries={['/preconditioning-effectiveness']}>
          <PreconditioningEffectivenessPage />
        </MemoryRouter>,
      );
      const window = { start: range.startInstant, end: range.endInstantExclusive };
      expect(h.climateHook).toHaveBeenLastCalledWith('7', window);
      expect(h.driveHook).toHaveBeenLastCalledWith('7', 1000, window);
      expectEverySection();
      expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /date range|view settings/i })).not.toBeInTheDocument();
    }
  });
  it.each([
    ['missing null', null, '—'],
    ['missing undefined', undefined, '—'],
    ['invalid NaN', NaN, '—'],
    ['invalid positive infinity', Infinity, '—'],
    ['invalid negative infinity', -Infinity, '—'],
    ['invalid string', '1234', '—'],
    ['measured zero', 0, '0'],
    ['positive integer', 1234, '1,234'],
    ['negative integer', -1234, '-1,234'],
    ['positive fraction', 1234.6, '1,235'],
    ['negative fraction', -1234.6, '-1,235'],
  ])('formats caption counts for %s without changing source metrics', (_name, raw, display) => {
    setGlobalLocale('en-US');
    setGlobalPrecision(3);
    const evidence = comparisonEvidence();
    const summary = summarizePreconditioningEffectiveness(evidence.climate, evidence.drives);
    Object.assign(summary, { conditionedDepartures: raw });
    Object.assign(summary.driveRows, { uniqueValidDrives: raw });
    summary.hourlyProfile = [{
      ...summary.hourlyProfile[0]!,
      hour: 12,
      classifiedDepartures: 2,
    }];
    Object.assign(summary.hourlyProfile[0]!, {
      conditionedDepartures: raw,
      unconditionedDepartures: raw,
    });
    Object.assign(summary.windowSupport, { climateRowsReused: raw });
    const original = structuredClone(summary);
    const source = {
      hasData: true, isLoading: false, isResolved: true, isFetching: false,
      isPaused: false, error: null, refreshError: null, onRetry: vi.fn(),
    };
    const state: PreconditioningQueryState = {
      vehicleSelected: true, climate: source, drives: source, onRefresh: vi.fn(),
    };
    const formatDelta = () => 'delta';
    render(
      <>
        <PreconditioningThresholdConfidence summary={summary} state={state}
          formatDuration={() => 'duration'} formatDelta={formatDelta} />
        <PreconditioningEvidenceLedger summary={summary} state={state} formatDelta={formatDelta} />
        <PreconditioningJoinSupport summary={summary} state={state} formatDuration={() => 'duration'} />
        <PreconditioningHourlyProfile summary={summary} state={state} formatDelta={formatDelta} />
      </>,
    );

    const thresholds = within(screen.getByTestId('preconditioning-threshold-confidence'));
    const windowLabel = thresholds.getByText('Pre-drive window');
    expect(within(windowLabel.parentElement!).getByText(
      `${display} applicable or excluded`,
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('preconditioning-kpis')).getByText(
      `${display} classified departures`,
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('preconditioning-hourly-profile')).getByText(
      `${display} active · ${display} control`,
    )).toBeInTheDocument();
    const join = within(screen.getByTestId('preconditioning-join-support'));
    if (typeof raw === 'number' && raw > 0) {
      expect(join.getByText(
        `${display} unique climate rows are referenced by more than one overlapping departure window; departures are therefore not row-independent.`,
      )).toBeInTheDocument();
    } else {
      expect(join.getByText(
        'No climate-row reuse is observed in the returned windows, but the method permits reuse whenever departure windows overlap.',
      )).toBeInTheDocument();
    }
    expect(summary).toEqual(original);

    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(1);
    });
    const localized = display.replace(',', '.');
    expect(within(windowLabel.parentElement!).getByText(
      `${localized} applicable or excluded`,
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('preconditioning-kpis')).getByText(
      `${localized} classified departures`,
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('preconditioning-hourly-profile')).getByText(
      `${localized} active · ${localized} control`,
    )).toBeInTheDocument();
    expect(summary).toEqual(original);
  });

  it('uses saved numeric precision for join medians without changing counts or durations', () => {
    const evidence = comparisonEvidence();
    evidence.climate.splice(3, 0, climateAt(BASE + 2 * 60 * 60_000, 20, 33.5, false));
    h.climateQuery = query(h.climateRefetch, { data: evidence.climate });
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    renderPage();

    const assertMetric = (label: string, value: string) => {
      const section = within(screen.getByTestId('preconditioning-join-support'));
      const labelNode = section.getByText(label);
      expect(within(labelNode.parentElement!).getByText(value)).toBeInTheDocument();
    };
    const assertCountsAndDurations = () => {
      assertMetric('Departures with window rows', '2');
      assertMetric('Window-row references', '5');
      assertMetric('Unique climate rows used', '5');
      assertMetric('Climate rows reused', '0');
      assertMetric('Median observation span', '25.0 min');
      assertMetric('Median final-state lead', '5.0 min');
      assertMetric('P90 final-state lead', '5.0 min');
    };
    assertMetric('Median window rows', '2.50');
    assertMetric('Median distinct cabin states', '2.50');
    assertCountsAndDurations();

    act(() => {
      setGlobalPrecision(1);
      setGlobalLocale('de-DE');
    });
    assertMetric('Median window rows', '2,5');
    assertMetric('Median distinct cabin states', '2,5');
    assertCountsAndDurations();
    expectEverySection();
  });

  it('updates coverage and departure labels with date preferences without changing spans or ordering', () => {
    const view = renderPage();
    const assertDates = () => {
      const label = (instant: number) => formatDateTime(new Date(instant), {
        locale: h.dateLocale,
        tz: h.dateTimezone,
      });
      const coverage = within(screen.getByTestId('preconditioning-source-coverage'));
      expect(coverage.getByText(
        `${label(BASE - 30 * 60_000)} to ${label(BASE + 115 * 60_000)} · span 145.0 min · median gap 25.0 min`,
      )).toBeInTheDocument();
      expect(coverage.getByText(
        `${label(BASE)} to ${label(BASE + 120 * 60_000)} · endpoint limit 1,000 rows`,
      )).toBeInTheDocument();
      const entries = within(screen.getByTestId('preconditioning-departure-directory'))
        .getAllByRole('listitem');
      expect(within(entries[0]!).getByText('Drive 2')).toBeInTheDocument();
      expect(within(entries[0]!).getByText(label(BASE + 120 * 60_000))).toBeInTheDocument();
      expect(within(entries[1]!).getByText('Drive 1')).toBeInTheDocument();
      expect(within(entries[1]!).getByText(label(BASE))).toBeInTheDocument();
    };
    assertDates();
    const hourlyBefore = screen.getByTestId('preconditioning-hourly-profile').textContent;
    h.dateLocale = 'de-DE';
    h.dateTimezone = 'Asia/Tokyo';
    view.rerender(
      <MemoryRouter initialEntries={['/preconditioning-effectiveness']}>
        <PreconditioningEffectivenessPage />
      </MemoryRouter>,
    );
    assertDates();
    expect(screen.getByTestId('preconditioning-hourly-profile').textContent).toBe(hourlyBefore);
    expectEverySection();
  });

  it('renders all fifteen persistent evidence sections and the bounded hooks', () => {
    renderPage();

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Preconditioning effectiveness',
    })).toBeInTheDocument();
    expectEverySection();
    const window = { start: h.range.startInstant, end: h.range.endInstantExclusive };
    expect(h.climateHook).toHaveBeenLastCalledWith('7', window);
    expect(h.driveHook).toHaveBeenLastCalledWith('7', 1000, window);
  });

  it('retains every shell without a selected vehicle or redundant control', () => {
    h.vehicleId = null;
    h.climateQuery = query(h.climateRefetch, { isSuccess: false });
    h.driveQuery = query(h.driveRefetch, { isSuccess: false });
    renderPage();

    expectEverySection();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh evidence' })).toBeDisabled();
    const window = { start: h.range.startInstant, end: h.range.endInstantExclusive };
    expect(h.climateHook).toHaveBeenLastCalledWith('', window);
    expect(h.driveHook).toHaveBeenLastCalledWith(undefined, 1000, window);
    expect(screen.getByText(
      'Select a vehicle to query climate history and up to 1,000 recent drives.',
    )).toBeInTheDocument();
  });

  it('retains every shell while both sources are loading', () => {
    h.climateQuery = query(h.climateRefetch, {
      isLoading: true,
      isSuccess: false,
    });
    h.driveQuery = query(h.driveRefetch, {
      isLoading: true,
      isSuccess: false,
    });
    renderPage();

    expectEverySection();
    expect(screen.getAllByRole('status', {
      name: 'Loading preconditioning evidence',
    })).toHaveLength(2);
    expect(within(screen.getByTestId('preconditioning-source-coverage'))
      .getAllByText('Loading')).toHaveLength(2);
    expect(within(screen.getByTestId('preconditioning-availability'))
      .getAllByText('Initial load')).toHaveLength(2);
    expect(screen.queryByTestId('preconditioning-availability-summary')).not.toBeInTheDocument();
  });

  it('does not infer an empty response while initial queries are paused offline', () => {
    h.climateQuery = query(h.climateRefetch, {
      isPending: true,
      isSuccess: false,
      fetchStatus: 'paused',
    });
    h.driveQuery = query(h.driveRefetch, {
      isPending: true,
      isSuccess: false,
      fetchStatus: 'paused',
    });
    renderPage();

    expectEverySection();
    expect(screen.getAllByText('Refresh paused')).toHaveLength(2);
    expect(screen.queryByText(
      'Both endpoints returned valid empty responses, so no readiness comparison is published.',
    )).not.toBeInTheDocument();
    for (const id of ['preconditioning-source-coverage', 'preconditioning-availability']) {
      expect(within(screen.getByTestId(id)).getAllByText('Paused offline')).toHaveLength(2);
      expect(within(screen.getByTestId(id)).queryByText('Retained evidence')).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId('preconditioning-availability-summary')).not.toBeInTheDocument();
  });

  it('shows a one-source failure with one retry and all shells retained', () => {
    h.climateQuery = query(h.climateRefetch, {
      isError: true,
      isSuccess: false,
      error: new Error('climate unavailable'),
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText('Climate-history query failed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.climateRefetch).toHaveBeenCalledTimes(1);
    expect(h.driveRefetch).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('preconditioning-source-coverage'))
      .getByText('Unavailable')).toBeInTheDocument();
  });

  it('refreshes both sources from the page action', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh evidence' }));
    expect(h.climateRefetch).toHaveBeenCalledTimes(1);
    expect(h.driveRefetch).toHaveBeenCalledTimes(1);
  });

  it('retains cached comparisons and discloses a refresh failure', () => {
    const evidence = comparisonEvidence();
    h.climateQuery = query(h.climateRefetch, {
      data: evidence.climate,
      isError: true,
      isSuccess: false,
      error: new Error('refresh unavailable'),
    });
    const view = renderPage();

    expectEverySection();
    expect(screen.getByText(
      'One or more sources could not refresh. The most recently loaded evidence remains visible.',
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('preconditioning-readiness-comparison'))
      .getByText('Median departure gap by observational group')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    expect(h.climateRefetch).toHaveBeenCalledTimes(1);
    expect(h.driveRefetch).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('preconditioning-source-coverage'))
      .getByText('Cached; refresh failed')).toBeInTheDocument();
    expect(within(screen.getByTestId('preconditioning-availability'))
      .getByText('Refresh failed; cached data retained')).toBeInTheDocument();

    h.climateQuery = query(h.climateRefetch, { data: evidence.climate });
    view.rerender(
      <MemoryRouter initialEntries={['/preconditioning-effectiveness']}>
        <PreconditioningEffectivenessPage />
      </MemoryRouter>,
    );
    expectEverySection();
    expect(screen.queryByText(
      'One or more sources could not refresh. The most recently loaded evidence remains visible.',
    )).not.toBeInTheDocument();
    expect(within(screen.getByTestId('preconditioning-availability'))
      .getAllByText('Resolved')).toHaveLength(2);
    expect(within(screen.getByTestId('preconditioning-availability'))
      .queryByText('Retained evidence')).not.toBeInTheDocument();
    expect(screen.getAllByText('+9.0 °C').length).toBeGreaterThan(0);
  });

  it('renders valid empty responses with exact zero accounting', () => {
    h.climateQuery = query<ClimateState[]>(h.climateRefetch, { data: [] });
    h.driveQuery = query<Drive[]>(h.driveRefetch, { data: [] });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Both endpoints returned valid empty responses, so no readiness comparison is published.',
    )).toBeInTheDocument();
    expect(
      within(screen.getByTestId('preconditioning-accounting'))
        .getAllByText('Balances'),
    ).toHaveLength(7);
    expect(within(screen.getByTestId('preconditioning-source-coverage'))
      .getAllByText('Loaded')).toHaveLength(2);
    const coverage = within(screen.getByTestId('preconditioning-source-coverage'));
    expect(coverage.getByText('— to — · span — · median gap —')).toBeInTheDocument();
    expect(coverage.getByText('— to — · endpoint limit 1,000 rows')).toBeInTheDocument();
    const availability = within(screen.getByTestId('preconditioning-availability'));
    expect(availability.getAllByText('Resolved')).toHaveLength(2);
    expect(availability.getAllByText('0')).toHaveLength(9);
  });

  it('keeps stale, target-shift, and unknown-HVAC exclusions distinct', () => {
    const evidence = excludedEvidence();
    h.climateQuery = query(h.climateRefetch, { data: evidence.climate });
    h.driveQuery = query(h.driveRefetch, { data: evidence.drives });
    renderPage();

    expectEverySection();
    expectDispositionCount('Stale final sample', '1');
    expectDispositionCount('Material target shift', '1');
    expectDispositionCount('Ambiguous HVAC evidence', '1');
    expect(screen.getByText(
      'No departure is currently classified. Review the disposition ledger for distinct coverage, window, thermal, freshness, target, and HVAC exclusions.',
    )).toBeInTheDocument();
  });

  it('publishes comparison values only when active and explicit-off groups exist', () => {
    renderPage();

    const readiness = screen.getByTestId('preconditioning-readiness-comparison');
    expect(within(readiness)
      .getByText('Median departure gap by observational group')).toBeInTheDocument();
    expect(within(readiness).getByRole('img', {
      name: /observed HVAC-active and explicitly HVAC-off control departures/i,
    })).toBeInTheDocument();
    expect(within(readiness).getAllByText('HVAC-active').length).toBeGreaterThan(0);
    expect(within(readiness)
      .getAllByText('Explicit-off control').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+9.0 °C').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+10.0 °C').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('preconditioning-availability'))
      .getByText('Within-stratum overlap present')).toBeInTheDocument();

    const directory = screen.getByTestId('preconditioning-departure-directory');
    const entries = within(directory).getAllByRole('listitem');
    expect(within(entries[0]!).getByText('Drive 2')).toBeInTheDocument();
    expect(within(entries[1]!).getByText('Drive 1')).toBeInTheDocument();
  });

  it('formats temperature deltas in the selected Fahrenheit unit', () => {
    h.temperature = '°F';
    renderPage();

    expect(screen.getAllByText('+18.0 °F').length).toBeGreaterThan(0);
  });


  it.each(['climate', 'drives', 'both'] as const)(
    'retains comparisons and discloses a paused %s refresh',
    (source) => {
      const evidence = comparisonEvidence();
      if (source !== 'drives') {
        h.climateQuery = query(h.climateRefetch, {
          data: evidence.climate,
          fetchStatus: 'paused',
        });
      }
      if (source !== 'climate') {
        h.driveQuery = query(h.driveRefetch, {
          data: evidence.drives,
          fetchStatus: 'paused',
        });
      }
      renderPage();

      expectEverySection();
      const pausedCount = source === 'both' ? 2 : 1;
      expect(screen.getAllByText(/Previously loaded data remains visible while affected sources recover\. Refresh paused/))
        .toHaveLength(pausedCount);
      expect(within(screen.getByTestId('preconditioning-readiness-comparison'))
        .getByText('Median departure gap by observational group')).toBeInTheDocument();
      expect(screen.getAllByText('+9.0 °C').length).toBeGreaterThan(0);
      expect(within(screen.getByTestId('preconditioning-source-coverage'))
        .getAllByText('Paused offline')).toHaveLength(pausedCount);
      const availability = within(screen.getByTestId('preconditioning-availability'));
      expect(availability.getAllByText('Paused offline')).toHaveLength(pausedCount);
      expect(availability.getByText('Retained evidence')).toBeInTheDocument();
      expect(availability.getByText('Within-stratum overlap present')).toBeInTheDocument();
      expect(within(screen.getByTestId('preconditioning-departure-disposition'))
        .getByText('Retained evidence')).toBeInTheDocument();
      if (source !== 'drives') {
        expect(within(screen.getByTestId('preconditioning-climate-disposition'))
          .getByText('Retained evidence')).toBeInTheDocument();
      }
      expect(screen.queryByText('Climate-history query failed')).not.toBeInTheDocument();
      expect(screen.queryByText('Drive-history query failed')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh evidence' }));
      expect(h.climateRefetch).toHaveBeenCalledTimes(1);
      expect(h.driveRefetch).toHaveBeenCalledTimes(1);
    },
  );

  it('retains exact zero accounting when empty evidence has a paused refresh', () => {
    h.climateQuery = query<ClimateState[]>(h.climateRefetch, {
      data: [],
      fetchStatus: 'paused',
    });
    h.driveQuery = query<Drive[]>(h.driveRefetch, {
      data: [],
      fetchStatus: 'paused',
    });
    renderPage();

    expectEverySection();
    expect(screen.getAllByText(/Previously loaded data remains visible while affected sources recover\. Refresh paused/))
      .toHaveLength(2);
    expect(within(screen.getByTestId('preconditioning-accounting'))
      .getAllByText('Balances')).toHaveLength(7);
    const availability = within(screen.getByTestId('preconditioning-availability'));
    expect(availability.getAllByText('Paused offline')).toHaveLength(2);
    expect(availability.getAllByText('0')).toHaveLength(9);
    expect(availability.getByText('Retained evidence')).toBeInTheDocument();
  });

  it('clears the paused notice after sources resume without losing sections', () => {
    const evidence = comparisonEvidence();
    h.climateQuery = query(h.climateRefetch, {
      data: evidence.climate,
      fetchStatus: 'paused',
    });
    const view = renderPage();
    expect(screen.getByText(/Previously loaded data remains visible while affected sources recover\. Refresh paused/))
      .toBeInTheDocument();

    h.climateQuery = query(h.climateRefetch, { data: evidence.climate });
    view.rerender(
      <MemoryRouter initialEntries={['/preconditioning-effectiveness']}>
        <PreconditioningEffectivenessPage />
      </MemoryRouter>,
    );

    expectEverySection();
    expect(screen.queryByText(/Refresh paused/)).not.toBeInTheDocument();
    expect(screen.getAllByText('+9.0 °C').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('preconditioning-source-coverage'))
      .getAllByText('Loaded')).toHaveLength(2);
    const availability = within(screen.getByTestId('preconditioning-availability'));
    expect(availability.getAllByText('Resolved')).toHaveLength(2);
    expect(availability.queryByText('Retained evidence')).not.toBeInTheDocument();
  });

  it('preserves negative observational temperature differences in Fahrenheit', () => {
    const evidence = comparisonEvidence();
    evidence.climate[1] = { ...evidence.climate[1]!, insideTemp: 37 };
    h.climateQuery = query(h.climateRefetch, { data: evidence.climate });
    h.temperature = '°F';
    renderPage();

    expectEverySection();
    expect(screen.getAllByText('-5.4 °F').length).toBeGreaterThan(0);
    expect(screen.getAllByText('-7.2 °F').length).toBeGreaterThan(0);
    expect(evidence.climate[1]!.insideTemp).toBe(37);
  });

  it.each(['climate', 'drives'] as const)(
    'keeps a %s initial failure visible while the other source loads or pauses',
    (failedSource) => {
      const climateFailed = failedSource === 'climate';
      const failed = {
        isError: true, isSuccess: false, error: new Error('history unavailable'),
      };
      const loading = { isLoading: true, isSuccess: false };
      h.climateQuery = query(h.climateRefetch, climateFailed ? failed : loading);
      h.driveQuery = query(h.driveRefetch, climateFailed ? loading : failed);
      const view = renderPage();
      const failureNotice = screen.getByTestId(`preconditioning-${failedSource}-notice`);
      const otherSource = climateFailed ? 'drives' : 'climate';
      expectEverySection();
      expect(within(failureNotice).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(within(screen.getByTestId(`preconditioning-${otherSource}-notice`))
        .getByRole('status', { name: 'Loading preconditioning evidence' })).toBeInTheDocument();
      fireEvent.click(within(failureNotice).getByRole('button', { name: 'Retry' }));
      expect(climateFailed ? h.climateRefetch : h.driveRefetch).toHaveBeenCalledTimes(1);
      expect(climateFailed ? h.driveRefetch : h.climateRefetch).not.toHaveBeenCalled();

      const paused = {
        isLoading: true, isPending: true, isSuccess: false,
        isFetching: false, fetchStatus: 'paused' as const,
      };
      if (climateFailed) h.driveQuery = query(h.driveRefetch, paused);
      else h.climateQuery = query(h.climateRefetch, paused);
      view.rerender(<MemoryRouter><PreconditioningEffectivenessPage /></MemoryRouter>);
      expectEverySection();
      expect(within(screen.getByTestId(`preconditioning-${failedSource}-notice`))
        .getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      const pausedNotice = within(screen.getByTestId(`preconditioning-${otherSource}-notice`));
      expect(pausedNotice.getByText('Refresh paused')).toBeInTheDocument();
      expect(pausedNotice.queryByRole('status', { name: 'Loading preconditioning evidence' }))
        .not.toBeInTheDocument();
      fireEvent.click(pausedNotice.getByRole('button', { name: 'Retry' }));
      expect(h.climateRefetch).toHaveBeenCalledTimes(1);
      expect(h.driveRefetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(
        'Both endpoints returned valid empty responses, so no readiness comparison is published.',
      )).not.toBeInTheDocument();
    },
  );

  it.each(['climate', 'drives'] as const)(
    'independently retries a retained %s failure while the other source refreshes',
    (failedSource) => {
      const evidence = comparisonEvidence();
      const climateFailed = failedSource === 'climate';
      const failed = {
        isError: true, isSuccess: false, error: new Error('refresh unavailable'),
      };
      const refreshing = { isFetching: true, fetchStatus: 'fetching' as const };
      h.climateQuery = query(h.climateRefetch, {
        data: evidence.climate, ...(climateFailed ? failed : refreshing),
      });
      h.driveQuery = query(h.driveRefetch, {
        data: evidence.drives, ...(climateFailed ? refreshing : failed),
      });
      const view = renderPage();
      expectEverySection();
      expect(screen.getAllByText('+9.0 °C').length).toBeGreaterThan(0);
      const failedNotice = within(screen.getByTestId(`preconditioning-${failedSource}-notice`));
      const otherSource = climateFailed ? 'drives' : 'climate';
      expect(within(screen.getByTestId(`preconditioning-${otherSource}-notice`))
        .getByText('Refreshing')).toBeInTheDocument();
      fireEvent.click(failedNotice.getByRole('button', { name: 'Retry refresh' }));
      expect(climateFailed ? h.climateRefetch : h.driveRefetch).toHaveBeenCalledTimes(1);
      expect(climateFailed ? h.driveRefetch : h.climateRefetch).not.toHaveBeenCalled();

      h.climateQuery = query(h.climateRefetch, { data: evidence.climate });
      h.driveQuery = query(h.driveRefetch, { data: evidence.drives });
      view.rerender(<MemoryRouter><PreconditioningEffectivenessPage /></MemoryRouter>);
      expectEverySection();
      expect(screen.queryByTestId(`preconditioning-${failedSource}-notice`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`preconditioning-${otherSource}-notice`)).not.toBeInTheDocument();
      expect(screen.getAllByText('+9.0 °C').length).toBeGreaterThan(0);
    },
  );

  it('offers independent retries for both initial failures', () => {
    const failed = {
      isError: true, isSuccess: false, error: new Error('history unavailable'),
    };
    h.climateQuery = query(h.climateRefetch, failed);
    h.driveQuery = query(h.driveRefetch, failed);
    renderPage();
    expectEverySection();
    fireEvent.click(within(screen.getByTestId('preconditioning-climate-notice'))
      .getByRole('button', { name: 'Retry' }));
    expect(h.climateRefetch).toHaveBeenCalledTimes(1);
    expect(h.driveRefetch).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId('preconditioning-drives-notice'))
      .getByRole('button', { name: 'Retry' }));
    expect(h.climateRefetch).toHaveBeenCalledTimes(1);
    expect(h.driveRefetch).toHaveBeenCalledTimes(1);
  });

  it('retains successful zero evidence after a failed refresh and recovery', () => {
    h.climateQuery = query<ClimateState[]>(h.climateRefetch, {
      data: [], isError: true, isSuccess: false, error: new Error('refresh unavailable'),
    });
    h.driveQuery = query<Drive[]>(h.driveRefetch, { data: [] });
    const view = renderPage();
    expectEverySection();
    expect(within(screen.getByTestId('preconditioning-accounting'))
      .getAllByText('Balances')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    expect(h.climateRefetch).toHaveBeenCalledTimes(1);
    expect(h.driveRefetch).not.toHaveBeenCalled();
    h.climateQuery = query<ClimateState[]>(h.climateRefetch, { data: [] });
    view.rerender(<MemoryRouter><PreconditioningEffectivenessPage /></MemoryRouter>);
    expectEverySection();
    expect(screen.queryByRole('button', { name: 'Retry refresh' })).not.toBeInTheDocument();
    expect(screen.getByText(
      'Both endpoints returned valid empty responses, so no readiness comparison is published.',
    )).toBeInTheDocument();
  });
});
