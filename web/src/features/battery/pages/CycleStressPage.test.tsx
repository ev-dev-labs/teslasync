import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
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

import { ToastProvider } from '@/components/feedback';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

const FROZEN_NOW = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  sessions: undefined as unknown,
  drives: undefined as unknown,
  chargingHook: vi.fn(),
  drivingHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'America/Los_Angeles',
}));
const refetchCharging = vi.fn();
const refetchDrives = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  );
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        const text = typeof fallback === 'string' ? fallback : key;
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
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useCharging', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/api/hooks/useCharging')
  >();
  return {
    ...actual,
    useChargingHistory: (vehicleId?: string, limit?: number) => {
      h.chargingHook(vehicleId, limit);
      return h.sessions;
    },
  };
});

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/api/hooks/useDriving')
  >();
  return {
    ...actual,
    useDriveHistory: (vehicleId?: string, limit?: number) => {
      h.drivingHook(vehicleId, limit);
      return h.drives;
    },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/lib/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return {
    ...actual,
    useTimezone: (mode: string) => {
      h.timezoneHook(mode);
      return h.timeZone;
    },
  };
});

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import CycleStressPage from './CycleStressPage';

let nextId = 1;

function session(
  start: string,
  end: string,
  startSoc: number,
  endSoc: number,
): ChargingSession {
  return {
    id: String(nextId++),
    vehicle_id: '7',
    charger_type: 'AC',
    start_soc_pct: startSoc,
    end_soc_pct: endSoc,
    total_energy_added_wh: 30_000,
    peak_power_w: null,
    cost_decimal: null,
    started_at: start,
    ended_at: end,
    start_ts: start,
    startedAt: start,
    duration_min: 60,
  };
}

function drive(
  start: string,
  end: string,
  startSoc: number,
  endSoc: number,
): Drive {
  return {
    id: nextId++,
    vehicleId: 7,
    startTs: start,
    endTs: end,
    durationS: (Date.parse(end) - Date.parse(start)) / 1_000,
    distanceM: 20_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: startSoc,
    endBatteryPct: endSoc,
    energyUsedWh: 4_000,
    regenEnergyWh: 300,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 5_000,
    outsideTempAvgC: 20,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: start,
    updatedAt: end,
  };
}

function readyHistory() {
  return {
    sessions: [
      session(
        '2026-07-01T10:00:00.000Z',
        '2026-07-01T11:00:00.000Z',
        20,
        90,
      ),
      session(
        '2026-07-02T10:00:00.000Z',
        '2026-07-02T11:00:00.000Z',
        30,
        80,
      ),
      session(
        '2026-08-01T10:00:00.000Z',
        '2026-08-01T11:00:00.000Z',
        25,
        85,
      ),
    ],
    drives: [
      drive(
        '2026-07-01T12:00:00.000Z',
        '2026-07-01T13:00:00.000Z',
        89,
        30,
      ),
      drive(
        '2026-07-02T12:00:00.000Z',
        '2026-07-02T13:00:00.000Z',
        79,
        25,
      ),
      drive(
        '2026-08-01T12:00:00.000Z',
        '2026-08-01T13:00:00.000Z',
        84,
        20,
      ),
    ],
  };
}

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

function query(
  refetch: () => void,
  overrides: Partial<QueryStub> = {},
): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isFetching: overrides.isFetching ?? isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    refetch,
    ...overrides,
  };
}

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/cycle-stress']}>
          <CycleStressPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(tree(client));
  return {
    ...view,
    rerenderPage: () => view.rerender(tree(client)),
  };
}

const sectionIds = [
  'cycle-stress-kpis',
  'cycle-stress-depth-distribution',
  'cycle-stress-month-trend',
  'cycle-stress-threshold-sensitivity',
  'cycle-stress-exponent-sensitivity',
  'cycle-stress-mean-soc-profile',
  'cycle-stress-duration-profile',
  'cycle-stress-composition',
  'cycle-stress-turning-points',
  'cycle-stress-directory',
  'cycle-stress-source-coverage',
  'cycle-stress-continuity',
  'cycle-stress-evidence-support',
  'cycle-stress-accounting',
  'cycle-stress-methodology',
] as const;

function expectEverySection(): void {
  for (const testId of sectionIds) {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 1;
  h.vehicleId = 7;
  h.timeZone = 'America/Los_Angeles';
  const history = readyHistory();
  h.sessions = query(refetchCharging, { data: history.sessions });
  h.drives = query(refetchDrives, { data: history.drives });
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

describe('CycleStressPage', () => {
  it('renders all fifteen analytical shells with both capped hooks', () => {
    renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Cycle Stress',
      }),
    ).toBeInTheDocument();
    expectEverySection();
    expect(h.chargingHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.drivingHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
  });

  it('recomputes threshold and exponent descriptions from both selectors', () => {
    renderPage();

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Deep-cycle lens' }),
      { target: { value: '80' } },
    );
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Depth exponent' }),
      { target: { value: '2' } },
    );

    const kpis = within(screen.getByTestId('cycle-stress-kpis'));
    expect(kpis.getByText('80%+ cycle share')).toBeInTheDocument();
    expect(kpis.getByText('illustrative exponent 2')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('cycle-stress-methodology')).getByText(
        /raised to exponent 2/i,
      ),
    ).toBeInTheDocument();
  });

  it('freezes recency across source updates', () => {
    const view = renderPage();
    const support = within(
      screen.getByTestId('cycle-stress-evidence-support'),
    );
    const recencyBefore = support.getByText(/days$/).textContent;

    vi.mocked(Date.now).mockReturnValue(
      FROZEN_NOW + 30 * 86_400_000,
    );
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      data: [...history.sessions],
    });
    h.drives = query(refetchDrives, {
      data: [...history.drives],
    });
    view.rerenderPage();

    expect(
      within(
        screen.getByTestId('cycle-stress-evidence-support'),
      ).getByText(recencyBefore ?? ''),
    ).toBeInTheDocument();
  });

  it('keeps every shell visible while both sources load', () => {
    h.sessions = query(refetchCharging, { isLoading: true });
    h.drives = query(refetchDrives, { isLoading: true });

    renderPage();

    expectEverySection();
    expect(
      screen.getByRole('status', {
        name: 'Loading Cycle Stress evidence',
      }),
    ).toBeInTheDocument();
  });

  it('keeps every shell visible without a selected vehicle', () => {
    h.vehicleId = null;
    h.sessions = query(refetchCharging);
    h.drives = query(refetchDrives);

    renderPage();

    expectEverySection();
    expect(h.chargingHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(h.drivingHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(
      screen.getByText(
        'Select a vehicle to analyze its returned charge and drive history.',
      ),
    ).toBeInTheDocument();
  });

  it('shows one retry surface when both histories fail', () => {
    h.sessions = query(refetchCharging, {
      isError: true,
      error: new Error('charging failed'),
    });
    h.drives = query(refetchDrives, {
      isError: true,
      error: new Error('drives failed'),
    });

    renderPage();

    expectEverySection();
    const retries = screen.getAllByRole('button', { name: /retry/i });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetchCharging).toHaveBeenCalledTimes(1);
    expect(refetchDrives).toHaveBeenCalledTimes(1);
  });

  it('shows usable partial evidence and one retry when one source fails', () => {
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      isError: true,
      error: new Error('charging failed'),
    });
    h.drives = query(refetchDrives, { data: history.drives });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Partial evidence is shown while these sources are unavailable or pending: Charging history.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchCharging).toHaveBeenCalledTimes(1);
    expect(refetchDrives).not.toHaveBeenCalled();
  });

  it('retains cached evidence through a refresh error', () => {
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      data: history.sessions,
      isError: true,
      isSuccess: false,
      error: new Error('refresh failed'),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'One or more histories could not refresh. Showing the most recently loaded evidence.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);
  });

  it('keeps all shells and exact accounting for empty success', () => {
    h.sessions = query(refetchCharging, { data: [] });
    h.drives = query(refetchDrives, { data: [] });

    renderPage();

    expectEverySection();
    expect(
      within(screen.getByTestId('cycle-stress-kpis')).getByText(
        'No drive or charging history was returned for this vehicle.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('cycle-stress-accounting')).getByText(
        '0 known returned = 0 included + 0 excluded. Missing completion times are never synthesized from duration, and missing SoC is never imputed.',
      ),
    ).toBeInTheDocument();
  });
});
