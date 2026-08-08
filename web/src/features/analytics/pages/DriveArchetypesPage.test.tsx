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

const NOW = Date.UTC(2026, 7, 8, 12);
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: undefined as unknown,
  hook: vi.fn(),
  refetch: vi.fn(),
  distance: 'km' as 'km' | 'mi',
  temperature: '°C' as '°C' | '°F',
  energy: 'kWh' as 'Wh' | 'kWh',
  timeZone: 'UTC',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: unknown) => {
      const text = typeof fallback === 'string' ? fallback : _key;
      const values =
        options && typeof options === 'object'
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

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: (vehicleId: string | undefined, limit: number) => {
    h.hook(vehicleId, limit);
    return h.query;
  },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => h.timeZone,
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
        temperature: h.temperature,
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
        formatSpeed: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatSpeed(value, unitPrefs, options),
        formatTemperature: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatTemperature(value, unitPrefs, options),
        formatEnergy: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatEnergy(value, unitPrefs, options),
        formatDuration: (
          value: number | null | undefined,
          options?: { precision?: number },
        ) => units.formatDuration(value, unitPrefs, options),
      };
    },
  };
});

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select">Vehicle picker</div>,
}));

vi.mock('@/components/charts', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const hiddenSeries = {
    isHidden: () => false,
    toggle: vi.fn(),
  };
  return {
    Bar: Wrapper,
    BarChart: Wrapper,
    CartesianGrid: () => null,
    Cell: () => null,
    ChartContainer: ({
      children,
      title,
      subtitle,
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
      subtitle?: string;
      ariaLabel: string;
    }) => (
      <div>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
        <div role="img" aria-label={ariaLabel}>
          {typeof children === 'function'
            ? children({ annotations: [], hidden: false, hiddenSeries })
            : children}
        </div>
      </div>
    ),
    ChartLegend: () => null,
    ChartTooltip: () => null,
    CHART_COLORS: ['#00a', '#0a0', '#a00', '#aa0', '#0aa'],
    ResponsiveContainer: Wrapper,
    Scatter: () => null,
    ScatterChart: Wrapper,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
    ZAxis: () => null,
    axisTick: {},
  };
});

import DriveArchetypesPage from './DriveArchetypesPage';

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
    dataUpdatedAt: NOW,
    refetch: h.refetch,
    ...overrides,
  };
}

interface DriveSpec {
  id: number;
  day: number;
  hour: number;
  km: number;
  speedKph: number;
  whPerKm: number;
  tempC: number | null;
}

function drive(spec: DriveSpec): Drive {
  return {
    id: spec.id,
    vehicleId: 7,
    startTs: new Date(Date.UTC(2026, 2, spec.day, spec.hour, 5)).toISOString(),
    endTs: null,
    durationS: Math.round((spec.km / spec.speedKph) * 3600),
    distanceM: spec.km * 1000,
    startAddress: `Start ${spec.id}`,
    endAddress: `End ${spec.id}`,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: spec.whPerKm * spec.km,
    regenEnergyWh: null,
    avgSpeedMps: spec.speedKph / 3.6,
    maxSpeedMps: spec.speedKph / 3.6,
    avgPowerW: null,
    outsideTempAvgC: spec.tempC,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

function clusteredDrives(imputeOne = false): Drive[] {
  const rows: Drive[] = [];
  for (let index = 0; index < 10; index += 1) {
    rows.push(
      drive({
        id: index + 1,
        day: index + 1,
        hour: 8,
        km: 10 + index * 0.4,
        speedKph: 30 + (index % 3),
        whPerKm: 180 + index,
        tempC: imputeOne && index === 0 ? null : 10 + index * 0.2,
      }),
      drive({
        id: index + 11,
        day: index + 1,
        hour: 14,
        km: 100 + index * 2,
        speedKph: 90 + (index % 4),
        whPerKm: 150 + index,
        tempC: 20 + index * 0.2,
      }),
    );
  }
  return rows;
}

function constantDrives(): Drive[] {
  return Array.from({ length: 20 }, (_, index) =>
    drive({
      id: index + 1,
      day: index + 1,
      hour: 8,
      km: 10,
      speedKph: 30,
      whPerKm: 180,
      tempC: 15,
    }));
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/drive-archetypes']}>
      <DriveArchetypesPage />
    </MemoryRouter>,
  );
}

const sectionIds = [
  'drive-archetypes-kpis',
  'drive-archetypes-source',
  'drive-archetypes-coverage',
  'drive-archetypes-feature-ranges',
  'drive-archetypes-candidates',
  'drive-archetypes-centroid-map',
  'drive-archetypes-composition',
  'drive-archetypes-profiles',
  'drive-archetypes-separation',
  'drive-archetypes-confidence',
  'drive-archetypes-hourly',
  'drive-archetypes-monthly',
  'drive-archetypes-directory',
  'drive-archetypes-accounting',
  'drive-archetypes-methodology',
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
  h.temperature = '°C';
  h.energy = 'kWh';
  h.timeZone = 'UTC';
  h.query = query<Drive[]>({ data: clusteredDrives() });
});

describe('DriveArchetypesPage', () => {
  it('renders all fifteen shells, requests 1,000 rows, and refreshes evidence', () => {
    renderPage();

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Drive Archetypes',
    })).toBeInTheDocument();
    expectEverySection();
    expect(h.hook).toHaveBeenLastCalledWith('7', 1000);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh evidence' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('retains all shells and disables refresh without a selected vehicle', () => {
    h.vehicleId = null;
    h.query = query<Drive[]>({ isSuccess: false });
    renderPage();

    expectEverySection();
    expect(h.hook).toHaveBeenLastCalledWith(undefined, 1000);
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh evidence' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('drive-archetypes-kpis')).getByText(
      'Select a vehicle to query an observed window of up to 1,000 recent drives.',
    )).toBeInTheDocument();
  });

  it('retains all shells during the initial load', () => {
    h.query = query<Drive[]>({ isLoading: true, isSuccess: false });
    renderPage();

    expectEverySection();
    expect(screen.getByRole('status', {
      name: 'Loading drive-archetype evidence',
    })).toBeInTheDocument();
  });

  it('shows one initial failure retry while every shell remains mounted', () => {
    h.query = query<Drive[]>({
      isError: true,
      isSuccess: false,
      error: new Error('history unavailable'),
    });
    renderPage();

    expectEverySection();
    const ledger = screen.getByTestId('drive-archetypes-kpis');
    expect(within(ledger).getByText('Drive-history query failed')).toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('retains cached evidence and discloses a refresh failure', () => {
    h.query = query<Drive[]>({
      data: clusteredDrives(),
      isError: true,
      isSuccess: false,
      error: new Error('refresh unavailable'),
    });

    renderPage();

    expectEverySection();
    expect(within(screen.getByTestId('drive-archetypes-candidates'))
      .getByText('Candidate-k model selection')).toBeInTheDocument();
    const ledger = screen.getByTestId('drive-archetypes-kpis');
    expect(within(ledger).getByText(
      'The history window could not refresh. The most recently loaded evidence remains visible.',
    )).toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole('button', { name: 'Retry refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('retains cached evidence and discloses a paused offline refresh', () => {
    h.query = query<Drive[]>({
      data: clusteredDrives(),
      fetchStatus: 'paused',
      isFetching: false,
    });
    renderPage();

    expectEverySection();
    expect(within(screen.getByTestId('drive-archetypes-kpis')).getByText(
      'The network is unavailable, so cached evidence remains visible while its refresh is paused.',
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('drive-archetypes-candidates'))
      .getAllByText('Selected')).toHaveLength(1);
  });

  it('renders a valid empty response with exact zero accounting', () => {
    h.query = query<Drive[]>({ data: [] });
    renderPage();

    expectEverySection();
    expect(within(screen.getByTestId('drive-archetypes-kpis')).getByText(
      'The drive-history endpoint returned a valid empty response; no archetype partition is published.',
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('drive-archetypes-accounting'))
      .getAllByText('Balances')).toHaveLength(6);
  });

  it('publishes eligibility but withholds clusters below twenty drives', () => {
    h.query = query<Drive[]>({ data: clusteredDrives().slice(0, 12) });
    renderPage();

    expectEverySection();
    expect(within(screen.getByTestId('drive-archetypes-kpis')).getByText(
      '12 eligible drives are available; 20 are required for clustering.',
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('drive-archetypes-source'))
      .getAllByText('Eligible').length).toBeGreaterThan(0);
  });

  it('withholds clustering when eligible features have no variation', () => {
    h.query = query<Drive[]>({ data: constantDrives() });
    renderPage();

    expectEverySection();
    expect(within(screen.getByTestId('drive-archetypes-kpis')).getByText(
      'Clustering is withheld because every standardized feature dimension is constant.',
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('drive-archetypes-candidates')).getByText(
      'Eligible drives exist, but no standardized feature dimension varies enough to support a partition.',
    )).toBeInTheDocument();
  });

  it('renders clustered evidence and the selected candidate model', () => {
    renderPage();

    expectEverySection();
    const candidates = screen.getByTestId('drive-archetypes-candidates');
    expect(within(candidates).getByText('Candidate-k model selection')).toBeInTheDocument();
    expect(within(candidates).getAllByText('Selected')).toHaveLength(1);
    expect(within(screen.getByTestId('drive-archetypes-profiles'))
      .getAllByText(/Cluster \d+ ·/).length).toBeGreaterThan(0);
  });

  it('warns when the observed window reaches the 1,000-row cap', () => {
    h.query = query<Drive[]>({
      data: Array.from({ length: 1000 }, () => null) as unknown as Drive[],
    });
    renderPage();

    expectEverySection();
    expect(within(screen.getByTestId('drive-archetypes-coverage')).getByText(
      'Exactly 1,000 rows were returned, so older history may exist beyond this observed bounded window.',
    )).toBeInTheDocument();
  });

  it('discloses eligible median-imputed temperature as unmeasured', () => {
    h.query = query<Drive[]>({ data: clusteredDrives(true) });
    renderPage();

    expectEverySection();
    expect(within(screen.getByTestId('drive-archetypes-feature-ranges')).getByText(
      /1 eligible drives lacked measured temperature.*imputed, not measured\./,
    )).toBeInTheDocument();
    expect(within(screen.getByTestId('drive-archetypes-directory'))
      .getAllByText('Temperature imputed')).toHaveLength(1);
  });

  it('discloses configured-default temperature when no measured value exists', () => {
    h.query = query<Drive[]>({
      data: clusteredDrives().map((row) => ({
        ...row,
        outsideTempAvgC: null,
      })),
    });
    renderPage();

    expect(within(screen.getByTestId('drive-archetypes-feature-ranges')).getByText(
      /no eligible measured temperature exists.*configured default.*imputed, not measured\./,
    )).toBeInTheDocument();
  });

  it('keeps the assignment directory newest-first', () => {
    renderPage();

    const directory = screen.getByTestId('drive-archetypes-directory');
    const entries = within(directory).getAllByRole('listitem');
    expect(within(entries[0]!).getByText('Drive 20')).toBeInTheDocument();
    expect(within(entries[1]!).getByText('Drive 10')).toBeInTheDocument();
  });

  it('converts distance, speed, efficiency, and temperature to mile/Fahrenheit display units', () => {
    h.distance = 'mi';
    h.temperature = '°F';
    h.energy = 'kWh';
    renderPage();

    const method = screen.getByTestId('drive-archetypes-methodology');
    expect(within(method).getByText(/93\.2 mi/)).toBeInTheDocument();
    expect(within(method).getByText(/43\.5 mph/)).toBeInTheDocument();
    expect(within(method).getByText(/37\.4°F/)).toBeInTheDocument();
    expect(within(screen.getByTestId('drive-archetypes-profiles'))
      .getAllByText(/kWh\/mi/).length).toBeGreaterThan(0);
  });
});
