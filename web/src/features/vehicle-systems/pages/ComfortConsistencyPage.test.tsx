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

import type { ClimateState } from '@/types/vehicle-systems';

const BASE = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  historyHook: vi.fn(),
  temperature: '°C' as '°C' | '°F',
}));
const refetch = vi.fn();

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

vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useClimateHistory: (vehicleId: string) => {
    h.historyHook(vehicleId);
    return h.history;
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

vi.mock('@/components/charts', () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ChartContainer: ({
    children,
    title,
    ariaLabel,
  }: {
    children: ReactNode;
    title: string;
    ariaLabel: string;
  }) => (
    <div>
      <h4>{title}</h4>
      <div role="img" aria-label={ariaLabel}>{children}</div>
    </div>
  ),
  ChartTooltip: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import ComfortConsistencyPage from './ComfortConsistencyPage';

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function query(overrides: Partial<QueryStub> = {}): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    isFetching: isLoading,
    isStale: false,
    dataUpdatedAt: BASE,
    refetch,
    ...overrides,
  };
}

function climate(
  minute: number,
  state: Partial<ClimateState>,
): ClimateState {
  return {
    timestamp: new Date(BASE + minute * 60_000).toISOString(),
    ...state,
  };
}

function completeEvidence(): ClimateState[] {
  return [
    climate(0, {
      insideTemp: 21,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: false,
    }),
    climate(5, {
      insideTemp: 30,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(10, {
      insideTemp: 25,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(15, {
      insideTemp: 21.5,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(20, {
      insideTemp: 20.5,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(25, {
      insideTemp: 20.5,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: false,
    }),
    climate(30, {
      insideTemp: 15,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(35, {
      insideTemp: 20.5,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(40, {
      insideTemp: 21,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: true,
    }),
    climate(45, {
      insideTemp: 21,
      driverTempSetting: 21,
      passengerTempSetting: 21,
      hvacPower: false,
    }),
  ];
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/comfort-consistency']}>
      <ComfortConsistencyPage />
    </MemoryRouter>,
  );
}

const sectionIds = [
  'comfort-consistency-kpis',
  'comfort-consistency-source-availability',
  'comfort-consistency-coverage-cadence',
  'comfort-consistency-row-disposition',
  'comfort-consistency-interval-composition',
  'comfort-consistency-hourly-profile',
  'comfort-consistency-deviation-distribution',
  'comfort-consistency-setpoint-agreement',
  'comfort-consistency-stabilization-outcomes',
  'comfort-consistency-score-decomposition',
  'comfort-consistency-thresholds',
  'comfort-consistency-window-directory',
  'comfort-consistency-accounting',
  'comfort-consistency-availability',
  'comfort-consistency-methodology',
] as const;

function expectEverySection(): void {
  for (const id of sectionIds) {
    expect(screen.getByTestId(id)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.temperature = '°C';
  h.history = query({ data: completeEvidence() });
});

describe('ComfortConsistencyPage', () => {
  it('renders all fifteen persistent shells with complete evidence', () => {
    renderPage();

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Comfort Consistency',
    })).toBeInTheDocument();
    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith('7');
    expect(screen.getAllByText('Sustained band observed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Balances')).toHaveLength(7);
  });

  it('keeps the header, vehicle control, and every shell without a vehicle', () => {
    h.vehicleId = null;
    h.history = query();
    renderPage();

    expectEverySection();
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
    expect(h.historyHook).toHaveBeenLastCalledWith('');
    expect(screen.getByText(
      'Select a vehicle to analyze its returned climate timeline.',
    )).toBeInTheDocument();
  });

  it('keeps every shell visible while loading', () => {
    h.history = query({ isLoading: true, isSuccess: false });
    renderPage();

    expectEverySection();
    expect(screen.getAllByRole('status', {
      name: 'Loading comfort-consistency evidence',
    })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows one retry for an initial error while retaining all shells', () => {
    h.history = query({
      isError: true,
      isSuccess: false,
      error: new Error('history unavailable'),
    });
    renderPage();

    expectEverySection();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves cached evidence through a refresh error', () => {
    h.history = query({
      data: completeEvidence(),
      isError: true,
      isSuccess: false,
      error: new Error('refresh unavailable'),
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Climate history could not refresh. Showing the most recently loaded comfort evidence.',
    )).toBeInTheDocument();
    expect(screen.getAllByText('Sustained band observed').length).toBeGreaterThan(0);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps exact zero accounting for an empty success', () => {
    h.history = query({ data: [] });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'The climate endpoint returned no rows, so no comfort claim is made.',
    )).toBeInTheDocument();
    expect(
      within(screen.getByTestId('comfort-consistency-accounting'))
        .getAllByText('Balances'),
    ).toHaveLength(7);
  });

  it('discloses timestamped rows that fail the analysis gates', () => {
    h.history = query({
      data: [
        climate(0, {}),
        climate(5, {
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: false,
        }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Timestamped rows exist, but none passed the active-HVAC, cabin, and setpoint gates.',
    )).toBeInTheDocument();
    expect(screen.getByText('Unknown HVAC state')).toBeInTheDocument();
  });

  it('distinguishes sample evidence from absent duration support', () => {
    h.history = query({
      data: [
        climate(0, {
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: true,
        }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Sample metrics are available, but no adjacent interval supports duration-weighted consistency.',
    )).toBeInTheDocument();
  });

  it('keeps in-band active fragments separate from stabilization windows', () => {
    h.history = query({
      data: [
        climate(0, {
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: true,
        }),
        climate(5, {
          insideTemp: 21,
          driverTempSetting: 21,
          hvacPower: true,
        }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Active fragments exist, but none began outside the configured comfort band.',
    )).toBeInTheDocument();
  });

  it('discloses censored outside-band fragments without claiming stabilization', () => {
    h.history = query({
      data: [
        climate(0, {
          insideTemp: 30,
          driverTempSetting: 21,
          hvacPower: true,
        }),
        climate(5, {
          insideTemp: 28,
          driverTempSetting: 21,
          hvacPower: true,
        }),
      ],
    });
    renderPage();

    expectEverySection();
    expect(screen.getByText(
      'Outside-band fragments were observed, but none reached the sustained-band gate; censored endings remain disclosed.',
    )).toBeInTheDocument();
    expect(screen.getByText('Right-censored')).toBeInTheDocument();
  });

  it('converts Celsius deltas to the selected Fahrenheit display unit', () => {
    h.temperature = '°F';
    renderPage();

    expect(screen.getByText('+/- 2.7 °F')).toBeInTheDocument();
  });
});
