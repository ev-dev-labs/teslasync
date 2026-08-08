import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const UPDATED_AT = Date.UTC(2026, 7, 8, 12);
const START_INSTANT = '2026-04-18T07:00:00.000Z';
const END_INSTANT = '2026-07-17T07:00:00.000Z';

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  intensityQuery: undefined as unknown,
  periodQuery: undefined as unknown,
  lifetimeQuery: undefined as unknown,
  recommendationQuery: undefined as unknown,
  intensityHook: vi.fn(),
  summaryHook: vi.fn(),
  recommendationHook: vi.fn(),
  rangeHook: vi.fn(),
  intensityRefetch: vi.fn(),
  periodRefetch: vi.fn(),
  lifetimeRefetch: vi.fn(),
  recommendationRefetch: vi.fn(),
  setRange: vi.fn(),
  distance: 'km' as 'km' | 'mi',
  energy: 'kWh' as 'Wh' | 'kWh',
  timezone: 'America/Los_Angeles',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      const values = options && typeof options === 'object'
        ? options as Record<string, unknown>
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

vi.mock('@/api/hooks/useCarbon', () => ({
  useCarbonIntensity: () => {
    h.intensityHook();
    return h.intensityQuery;
  },
  useCarbonSummary: (
    vehicleId: number | null,
    from?: string,
    to?: string,
  ) => {
    h.summaryHook(vehicleId, from, to);
    return from != null || to != null ? h.periodQuery : h.lifetimeQuery;
  },
  useCarbonRecommendation: (vehicleId: number | null) => {
    h.recommendationHook(vehicleId);
    return h.recommendationQuery;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => h.timezone,
}));

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: (options: unknown) => {
    h.rangeHook(options);
    return {
      start: '2026-04-18',
      end: '2026-07-16',
      startInstant: START_INSTANT,
      endInstantExclusive: END_INSTANT,
      timezone: h.timezone,
      presetId: undefined,
      compare: false,
      comparePrev: undefined,
      setRange: h.setRange,
      setPreset: vi.fn(),
      setCompare: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/useUnits', async () => {
  const units = await vi.importActual<typeof import('@/lib/unitConversion')>(
    '@/lib/unitConversion',
  );
  return {
    useUnits: () => {
      const unitPrefs: import('@/lib/unitConversion').UnitPref = {
        distance: h.distance,
        speed: h.distance === 'mi' ? 'mph' : 'km/h',
        temperature: '°C',
        pressure: 'bar',
        energy: h.energy,
        duration: 'h',
        power: 'kW',
        locale: 'en-US',
        precision: 1,
      };
      return {
        unitPrefs,
        formatDistance: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatDistance(value, unitPrefs, options),
        formatEnergy: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatEnergy(value, unitPrefs, options),
      };
    },
  };
});

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select">Vehicle picker</div>,
  RangePicker: () => <div data-testid="carbon-range">Range picker</div>,
}));

vi.mock('@/components/charts', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const SvgWrapper = ({ children }: { children?: ReactNode }) => (
    <svg>{children}</svg>
  );
  return {
    Area: () => null,
    AreaChart: SvgWrapper,
    Bar: () => null,
    ChartContainer: ({
      children,
      title,
      subtitle,
      ariaLabel,
      data,
    }: {
      children:
        | ReactNode
        | ((context: {
          annotations: [];
          hidden: false;
          hiddenSeries: {
            isHidden: () => false;
            toggle: () => void;
          };
        }) => ReactNode);
      title: string;
      subtitle?: string;
      ariaLabel: string;
      data?: ReadonlyArray<Record<string, unknown>>;
    }) => (
      <div>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
        <div data-testid="chart-data">{JSON.stringify(data ?? [])}</div>
        <div role="img" aria-label={ariaLabel}>
          {typeof children === 'function'
            ? children({
              annotations: [],
              hidden: false,
              hiddenSeries: {
                isHidden: () => false,
                toggle: () => undefined,
              },
            })
            : children}
        </div>
      </div>
    ),
    ChartGradient: () => null,
    ChartLegend: () => null,
    ChartTooltip: () => null,
    ComposedChart: Wrapper,
    Line: () => null,
    LinearGauge: ({
      value,
      label,
    }: {
      value: number;
      label: string;
    }) => (
      <div role="meter" aria-label={label} aria-valuenow={value}>
        {value}
      </div>
    ),
    ReferenceLine: () => null,
    ResponsiveContainer: Wrapper,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
    axisTick: {},
    chartGrid: null,
  };
});

import CarbonIntelligencePage from './CarbonIntelligencePage';

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
    dataUpdatedAt: UPDATED_AT,
    refetch,
    ...overrides,
  };
}

function intensityData() {
  return {
    curve: Array.from({ length: 24 }, (_, hour) => ({
      hour_of_day: hour,
      g_co2_per_kwh: 100 + Math.abs(hour - 2) * 10,
    })),
    min: 100,
    max: 310,
    greenest_hours: [2],
    dirtiest_hours: [23],
  };
}

function periodData() {
  return {
    total_energy_kwh: 2.5,
    total_co2_kg: 0.75,
    gas_equiv_co2_kg: 0.5,
    co2_saved_kg: -0.25,
    green_score: 4.8,
    sessions_scored: 1,
    monthly: [
      { month: '2026-06', energy_kwh: 1, co2_kg: 0.3 },
      { month: '2026-07', energy_kwh: 1.5, co2_kg: 0.45 },
    ],
  };
}

function lifetimeData() {
  return {
    total_energy_kwh: 10,
    total_co2_kg: 3,
    gas_equiv_co2_kg: 4,
    co2_saved_kg: 1,
    green_score: 4.8,
    sessions_scored: 4,
    monthly: [
      { month: '2026-01', energy_kwh: 5, co2_kg: 1.5 },
      { month: '2026-02', energy_kwh: 5, co2_kg: 1.5 },
    ],
  };
}

function recommendationData() {
  return {
    current_avg_intensity: 300,
    greenest_window: {
      start_hour: 1,
      end_hour: 4,
      avg_intensity: 106.7,
    },
    potential_co2_saving_kg: 1.93,
    potential_saving_pct: 64.4,
  };
}

function emptySummary() {
  return {
    total_energy_kwh: 0,
    total_co2_kg: 0,
    gas_equiv_co2_kg: 0,
    co2_saved_kg: 0,
    green_score: 0,
    sessions_scored: 0,
    monthly: [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[
        '/analytics/carbon?from=2026-04-18&to=2026-07-16',
      ]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <CarbonIntelligencePage />
    </MemoryRouter>,
  );
}

const sectionIds = [
  'carbon-evidence-ledger',
  'carbon-source-scope',
  'carbon-period-footprint',
  'carbon-lifetime-context',
  'carbon-monthly-trend',
  'carbon-curve-coverage',
  'carbon-intensity-curve',
  'carbon-hourly-directory',
  'carbon-green-timing-score',
  'carbon-recommendation',
  'carbon-opportunity-math',
  'carbon-accounting-identities',
  'carbon-methodology',
] as const;

function expectEverySection(): void {
  for (const id of sectionIds) {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.distance = 'km';
  h.energy = 'kWh';
  h.timezone = 'America/Los_Angeles';
  h.intensityQuery = query(h.intensityRefetch, { data: intensityData() });
  h.periodQuery = query(h.periodRefetch, { data: periodData() });
  h.lifetimeQuery = query(h.lifetimeRefetch, { data: lifetimeData() });
  h.recommendationQuery = query(h.recommendationRefetch, {
    data: recommendationData(),
  });
});

describe('CarbonIntelligencePage', () => {
  it('renders all thirteen persistent section shells', () => {
    renderPage();

    expectEverySection();
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Carbon Intelligence',
    })).toBeInTheDocument();
  });

  it('converts URL calendar labels to vehicle-timezone instants for only the period hook', () => {
    renderPage();

    expect(h.rangeHook).toHaveBeenCalledWith(expect.objectContaining({
      persistKey: 'carbon.range',
      defaultPresetId: '90d',
      timezone: 'America/Los_Angeles',
    }));
    expect(h.summaryHook).toHaveBeenNthCalledWith(
      1,
      7,
      START_INSTANT,
      END_INSTANT,
    );
    expect(h.summaryHook).toHaveBeenNthCalledWith(2, 7, undefined, undefined);
    expect(screen.getByText(
      `API window: ${START_INSTANT} ≤ timestamp < ${END_INSTANT}`,
    )).toBeInTheDocument();
  });

  it('keeps intensity evidence useful and excludes disabled vehicle queries from page freshness', () => {
    h.vehicleId = null;
    h.periodQuery = query(h.periodRefetch, { isSuccess: false });
    h.lifetimeQuery = query(h.lifetimeRefetch, { isSuccess: false });
    h.recommendationQuery = query(h.recommendationRefetch, {
      isSuccess: false,
    });
    renderPage();

    expectEverySection();
    expect(within(screen.getByTestId('carbon-curve-coverage'))
      .getByText('Valid unique hours')).toBeInTheDocument();
    expect(screen.getAllByText(
      'Select a vehicle to load this vehicle-dependent evidence.',
    ).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(h.intensityRefetch).toHaveBeenCalledTimes(1);
    expect(h.periodRefetch).not.toHaveBeenCalled();
    expect(h.lifetimeRefetch).not.toHaveBeenCalled();
    expect(h.recommendationRefetch).not.toHaveBeenCalled();
  });

  it('keeps every shell mounted during initial loading', () => {
    h.intensityQuery = query(h.intensityRefetch, {
      isLoading: true,
      isSuccess: false,
    });
    h.periodQuery = query(h.periodRefetch, {
      isLoading: true,
      isSuccess: false,
    });
    h.lifetimeQuery = query(h.lifetimeRefetch, {
      isLoading: true,
      isSuccess: false,
    });
    h.recommendationQuery = query(h.recommendationRefetch, {
      isLoading: true,
      isSuccess: false,
    });
    renderPage();

    expectEverySection();
    expect(screen.getAllByLabelText('Loading carbon evidence').length)
      .toBeGreaterThan(4);
  });

  it.each([
    ['intensity', 'Intensity query failed'],
    ['period', 'Selected-period query failed'],
    ['lifetime', 'Lifetime summary query failed'],
    ['recommendation', 'Recommendation query failed'],
  ] as const)('preserves shells for an initial %s error', (source, message) => {
    const failed = query(vi.fn(), {
      isError: true,
      isSuccess: false,
      error: new Error(`${source} unavailable`),
    });
    if (source === 'intensity') h.intensityQuery = failed;
    if (source === 'period') h.periodQuery = failed;
    if (source === 'lifetime') h.lifetimeQuery = failed;
    if (source === 'recommendation') h.recommendationQuery = failed;

    renderPage();

    expectEverySection();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('distinguishes valid empty responses from loading and failure', () => {
    h.periodQuery = query(h.periodRefetch, { data: emptySummary() });
    h.lifetimeQuery = query(h.lifetimeRefetch, { data: emptySummary() });
    h.recommendationQuery = query(h.recommendationRefetch, {
      data: {
        current_avg_intensity: 0,
        greenest_window: {
          start_hour: 1,
          end_hour: 4,
          avg_intensity: 106.7,
        },
        potential_co2_saving_kg: 0,
        potential_saving_pct: 0,
      },
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'The selected-period endpoint returned a valid zero-evidence response.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'No scored lifetime charging sessions support a timing score.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'No lifetime charging energy supports a green-window scenario.',
    )).toBeInTheDocument();
  });

  it('uses selected-period monthly rows while labeling lifetime-only evidence honestly', () => {
    renderPage();

    const monthly = screen.getByTestId('carbon-monthly-trend');
    const chartData = within(monthly).getByTestId('chart-data').textContent;
    expect(chartData).toContain('2026-06');
    expect(chartData).toContain('2026-07');
    expect(chartData).not.toContain('2026-01');
    expect(screen.getAllByText(/Full vehicle history/).length).toBeGreaterThan(0);
    expect(screen.getByText(
      /Lifetime scope: the backend estimates moving all observed full-history charging energy/,
    )).toBeInTheDocument();
  });

  it('retains cached evidence for refresh errors and paused refreshes', () => {
    h.intensityQuery = query(h.intensityRefetch, {
      data: intensityData(),
      isError: true,
      isSuccess: false,
      error: new Error('intensity refresh failed'),
    });
    h.periodQuery = query(h.periodRefetch, {
      data: periodData(),
      fetchStatus: 'paused',
    });
    h.lifetimeQuery = query(h.lifetimeRefetch, {
      data: lifetimeData(),
      isError: true,
      isSuccess: false,
      error: new Error('lifetime refresh failed'),
    });
    h.recommendationQuery = query(h.recommendationRefetch, {
      data: recommendationData(),
      fetchStatus: 'paused',
    });
    renderPage();

    expectEverySection();
    expect(screen.getAllByText(
      'Refresh failed; the most recently loaded evidence remains visible.',
    )).toHaveLength(2);
    expect(screen.getAllByText(
      'The network is unavailable; cached evidence remains visible while refresh is paused.',
    )).toHaveLength(2);
    expect(screen.getByText('2.5 kWh')).toBeInTheDocument();
    expect(screen.getByText('24-hour grid intensity curve')).toBeInTheDocument();
  });

  it('formats canonical Wh through the selected display-energy preference', () => {
    h.energy = 'Wh';
    renderPage();

    expect(within(screen.getByTestId('carbon-evidence-ledger'))
      .getByText('2,500.0 Wh')).toBeInTheDocument();
    expect(within(screen.getByTestId('carbon-lifetime-context'))
      .getByText('10,000.0 Wh')).toBeInTheDocument();
  });

  it('formats reverse-derived distance through the selected distance preference', () => {
    h.distance = 'mi';
    renderPage();

    expect(within(screen.getByTestId('carbon-period-footprint'))
      .getByText('1.6 mi')).toBeInTheDocument();
  });

  it('withholds invalid scores instead of displaying a real zero', () => {
    h.lifetimeQuery = query(h.lifetimeRefetch, {
      data: {
        ...lifetimeData(),
        green_score: 101,
      },
    });
    renderPage();

    expect(within(screen.getByTestId('carbon-green-timing-score')).getByText(
      'A timing score is unavailable because the returned score failed validation.',
    )).toBeInTheDocument();
  });

  it('presents an invalid baseline comparison as unavailable', () => {
    h.periodQuery = query(h.periodRefetch, {
      data: {
        ...periodData(),
        total_co2_kg: Number.NaN,
      },
    });
    renderPage();

    const evidence = screen.getByTestId('carbon-evidence-ledger');
    expect(within(evidence).getByText('Baseline comparison unavailable'))
      .toBeInTheDocument();
    expect(within(screen.getByTestId('carbon-period-footprint')).getByText(
      'The gas-baseline comparison is unavailable because one or more required values failed validation.',
    )).toBeInTheDocument();
  });

  it('renders mismatched hour sets directly without numeric sentinels', () => {
    h.intensityQuery = query(h.intensityRefetch, {
      data: {
        ...intensityData(),
        greenest_hours: [3],
      },
    });
    renderPage();

    const accounting = screen.getByTestId('carbon-accounting-identities');
    expect(within(accounting).getByText('Outside tolerance'))
      .toBeInTheDocument();
    expect(within(accounting).getByText('02:00')).toBeInTheDocument();
    expect(within(accounting).getByText('03:00')).toBeInTheDocument();
    expect(within(accounting).queryByText('-1 h')).not.toBeInTheDocument();
  });
});
