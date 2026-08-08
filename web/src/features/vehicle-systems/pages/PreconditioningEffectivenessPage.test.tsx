import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { Drive } from '@/types/driving';
import type { ClimateState } from '@/types/vehicle-systems';

const BASE = Date.UTC(2026, 7, 8, 12);
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  climateQuery: undefined as unknown,
  driveQuery: undefined as unknown,
  climateHook: vi.fn(),
  driveHook: vi.fn(),
  climateRefetch: vi.fn(),
  driveRefetch: vi.fn(),
  temperature: '°C' as '°C' | '°F',
}));

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
  useDriveHistory: (vehicleId: string | undefined, limit: number) => {
    h.driveHook(vehicleId, limit);
    return h.driveQuery;
  },
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: (vehicleId: string) => {
    h.climateHook(vehicleId);
    return h.climateQuery;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
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
    ChartContainer: ({
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

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.temperature = '°C';
  const evidence = comparisonEvidence();
  h.climateQuery = query(h.climateRefetch, { data: evidence.climate });
  h.driveQuery = query(h.driveRefetch, { data: evidence.drives });
});

describe('PreconditioningEffectivenessPage', () => {
  it('renders all fifteen persistent evidence sections and the bounded hooks', () => {
    renderPage();

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Preconditioning Effectiveness',
    })).toBeInTheDocument();
    expectEverySection();
    expect(h.climateHook).toHaveBeenLastCalledWith('7');
    expect(h.driveHook).toHaveBeenLastCalledWith('7', 1000);
  });

  it('retains every shell and both controls without a selected vehicle', () => {
    h.vehicleId = null;
    h.climateQuery = query(h.climateRefetch, { isSuccess: false });
    h.driveQuery = query(h.driveRefetch, { isSuccess: false });
    renderPage();

    expectEverySection();
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh evidence' })).toBeDisabled();
    expect(h.climateHook).toHaveBeenLastCalledWith('');
    expect(h.driveHook).toHaveBeenLastCalledWith(undefined, 1000);
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
    expect(screen.getByRole('status', {
      name: 'Loading preconditioning evidence',
    })).toBeInTheDocument();
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
    expect(screen.getByText(
      'Evidence loading is paused while the network is unavailable; no empty response has been inferred.',
    )).toBeInTheDocument();
    expect(screen.queryByText(
      'Both endpoints returned valid empty responses, so no readiness comparison is published.',
    )).not.toBeInTheDocument();
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
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'One or more sources could not refresh. The most recently loaded evidence remains visible.',
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('preconditioning-readiness-comparison'))
      .getByText('Median departure gap by observational group')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    expect(h.climateRefetch).toHaveBeenCalledTimes(1);
    expect(h.driveRefetch).toHaveBeenCalledTimes(1);
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
});
