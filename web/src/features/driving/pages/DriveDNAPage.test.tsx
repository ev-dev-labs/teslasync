import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { Drive, DriveTelemetryPoint } from '@/types/driving';

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as unknown,
  telemetry: undefined as unknown,
  historyHook: vi.fn(),
  telemetryHook: vi.fn(),
}));

const historyRefetch = vi.fn();
const telemetryRefetch = vi.fn();

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
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return {
    ...actual,
    useDriveHistory: (vehicleId?: string, limit?: number) => {
      h.historyHook(vehicleId, limit);
      return h.history;
    },
    useDriveTelemetry: (driveId: string) => {
      h.telemetryHook(driveId);
      return h.telemetry;
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
  return { ...actual, useTimezone: () => 'America/Los_Angeles' };
});

const unitPrefs = {
  distance: 'km',
  speed: 'km/h',
  temperature: '°C',
  pressure: 'bar',
  energy: 'kWh',
  duration: 'h',
  power: 'kW',
  locale: 'en-US',
  precision: 1,
} as const;

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs,
    formatDistance: (value: number | null | undefined) =>
      value == null ? '—' : `${value / 1_000} km`,
    formatSpeed: (value: number | null | undefined) =>
      value == null ? '—' : `${value * 3.6} km/h`,
    formatTemperature: (value: number | null | undefined) =>
      value == null ? '—' : `${value}°C`,
    formatPressure: (value: number | null | undefined) =>
      value == null ? '—' : `${value} bar`,
    formatEnergy: (value: number | null | undefined) =>
      value == null ? '—' : `${value / 1_000} kWh`,
    formatDuration: (value: number | null | undefined) =>
      value == null ? '—' : `${value / 3_600} h`,
    formatPower: (value: number | null | undefined) =>
      value == null ? '—' : `${value / 1_000} kW`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import {
  DRIVE_DNA_SVG_REVOKE_DELAY_MS,
  buildDriveDnaSvg,
} from '../components/drive-dna';
import { buildDriveDnaModel } from '../lib/driveDNA';
import DriveDNAPage from './DriveDNAPage';

function drive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 7,
    startTs: '2026-02-01T18:00:00Z',
    endTs: '2026-02-01T18:30:00Z',
    durationS: 1_800,
    distanceM: 25_000,
    startAddress: 'Start',
    endAddress: 'End',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 8_000,
    regenEnergyWh: 1_000,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 5_000,
    outsideTempAvgC: 12,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: '2026-02-01T18:00:00Z',
    updatedAt: '2026-02-01T18:30:00Z',
    ...overrides,
  };
}

function telemetryPoint(
  seconds: number,
  overrides: Partial<DriveTelemetryPoint> = {},
): DriveTelemetryPoint {
  const createdAt = new Date(
    Date.parse('2026-02-01T18:00:00Z') + seconds * 1_000,
  ).toISOString();
  return {
    timestamp: createdAt,
    createdAt,
    speed: 10 + seconds / 10,
    // Endpoint response semantics are kW; the model lifts this to W.
    power: seconds % 20 === 0 ? -5 : 12,
    batteryLevel: null,
    outsideTemp: 10,
    insideTemp: 21,
    driverTemp: 21,
    passengerTemp: 21,
    elevation: 100 + seconds,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: 80 - seconds / 20,
    usableSoc: null,
    tirePressureFl: null,
    tirePressureFr: null,
    tirePressureRl: null,
    tirePressureRr: null,
    isClimateOn: false,
    fanStatus: null,
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

function query(
  overrides: Partial<QueryStub> = {},
  refetch = historyRefetch,
): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    refetch,
    ...overrides,
  };
}

function testTree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/driving/drive-dna']}>
          <DriveDNAPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(testTree(client));
  return {
    ...view,
    rerenderPage: () => view.rerender(testTree(client)),
  };
}

const sectionIds = [
  'drive-dna-kpis',
  'drive-dna-fingerprint',
  'drive-dna-genome',
  'drive-dna-encoding',
  'drive-dna-speed-power',
  'drive-dna-soc-elevation',
  'drive-dna-power-distribution',
  'drive-dna-speed-distribution',
  'drive-dna-coverage',
  'drive-dna-methodology',
] as const;

function expectEverySection(): void {
  for (const testId of sectionIds) {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.history = query({
    data: [
      drive(),
      drive({
        id: 2,
        startTs: '2026-02-02T18:00:00Z',
        distanceM: 12_000,
      }),
    ],
  });
  h.telemetry = query(
    {
      data: [
        telemetryPoint(0),
        telemetryPoint(10),
        telemetryPoint(20),
        telemetryPoint(40),
      ],
    },
    telemetryRefetch,
  );
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:drive-dna'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('DriveDNAPage', () => {
  it('renders the ready state with all ten persistent evidence sections', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Drive DNA' }),
    ).toBeInTheDocument();
    expectEverySection();
    for (const title of [
      'Selected-drive evidence',
      'Emission fingerprint',
      'Genome identity',
      'Encoding legend & evidence',
      'Speed & power emission profile',
      'SoC & elevation context',
      'Power states by telemetry-emission count',
      'Speed bands by telemetry-emission count',
      'Signal coverage & cadence',
      'Coverage & methodology',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(h.historyHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.telemetryHook).toHaveBeenLastCalledWith('1');
  });

  it('keeps every shell visible and suppresses telemetry while the list loads', () => {
    h.history = query({ isLoading: true });

    renderPage();

    expectEverySection();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText('Loading drive history').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('status', { name: 'Loading drive history' }),
    ).toHaveLength(1);
  });

  it('keeps every shell visible on a list error and never requests stale telemetry', () => {
    h.history = query({
      isError: true,
      error: new Error('history unavailable'),
    });

    renderPage();

    expectEverySection();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
    expect(screen.getAllByText("Can't reach server")).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);
    expect(screen.getByText('Selector history unavailable')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId('drive-dna-list-error')).getByRole(
        'button',
        { name: 'Retry' },
      ),
    );
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(telemetryRefetch).not.toHaveBeenCalled();
  });

  it('keeps cached drive-list evidence visible after a refetch failure', () => {
    h.history = query({
      data: [drive()],
      isError: true,
      error: new Error('history refresh unavailable'),
    });

    renderPage();

    expectEverySection();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('1');
    expect(screen.getByText('25 km')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Drive DNA deterministic emission artwork/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Drive history could not refresh. Showing the most recently loaded drives.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);

    fireEvent.click(
      within(screen.getByTestId('drive-dna-list-refresh-error')).getByRole(
        'button',
        { name: 'Retry' },
      ),
    );
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(telemetryRefetch).not.toHaveBeenCalled();
  });

  it('renders explicit list-empty states without a telemetry request', () => {
    h.history = query({ data: [] });

    renderPage();

    expectEverySection();
    expect(h.telemetryHook).toHaveBeenLastCalledWith('');
    expect(
      screen.getAllByText('No drives were returned for this vehicle.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: 'Choose a drive' })).toBeDisabled();
  });

  it('retains selected-drive metadata while telemetry loads', () => {
    h.telemetry = query(
      { isLoading: true },
      telemetryRefetch,
    );

    renderPage();

    expectEverySection();
    expect(screen.getByText('25 km')).toBeInTheDocument();
    expect(screen.getByText('0.5 h')).toBeInTheDocument();
    expect(
      screen.getAllByLabelText('Loading selected-drive telemetry').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('status', {
        name: 'Loading selected-drive telemetry',
      }),
    ).toHaveLength(1);
  });

  it('isolates a telemetry error without blanking selected-drive metadata', () => {
    h.telemetry = query(
      { isError: true, error: new Error('telemetry unavailable') },
      telemetryRefetch,
    );

    renderPage();

    expectEverySection();
    expect(screen.getByText('25 km')).toBeInTheDocument();
    expect(screen.getByText('0.5 h')).toBeInTheDocument();
    expect(screen.getAllByText("Can't reach server")).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);
    const error = screen.getByTestId('drive-dna-telemetry-error');
    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }));
    expect(telemetryRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).not.toHaveBeenCalled();
  });

  it('keeps cached telemetry fingerprint evidence visible after a refetch failure', () => {
    h.telemetry = query(
      {
        data: [
          telemetryPoint(0),
          telemetryPoint(10),
          telemetryPoint(20),
        ],
        isError: true,
        error: new Error('telemetry refresh unavailable'),
      },
      telemetryRefetch,
    );

    renderPage();

    expectEverySection();
    expect(screen.getByText('25 km')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Drive DNA deterministic emission artwork/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Drive telemetry could not refresh. Showing the most recently loaded fingerprint and evidence.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);

    fireEvent.click(
      within(
        screen.getByTestId('drive-dna-telemetry-refresh-error'),
      ).getByRole('button', { name: 'Retry' }),
    );
    expect(telemetryRefetch).toHaveBeenCalledTimes(1);
    expect(historyRefetch).not.toHaveBeenCalled();
  });

  it('keeps all shells explicit for no telemetry and for one telemetry row', () => {
    h.telemetry = query({ data: [] }, telemetryRefetch);
    const view = renderPage();

    expectEverySection();
    expect(
      screen.getAllByText('This drive returned no telemetry emissions.').length,
    ).toBeGreaterThan(0);
    const coverage = within(screen.getByTestId('drive-dna-coverage'));
    expect(
      coverage.getByText(
        'No telemetry rows were returned for cadence or channel coverage.',
      ),
    ).toBeInTheDocument();
    expect(coverage.getAllByText('0 / 0')).toHaveLength(6);
    expect(
      coverage.getAllByText('No valid-row denominator'),
    ).toHaveLength(5);
    expect(
      coverage.queryByText(
        'One chronological emission is available; at least two are needed for this profile.',
      ),
    ).not.toBeInTheDocument();

    h.telemetry = query(
      { data: [telemetryPoint(0, { speed: 0, power: 0, soc: 0 })] },
      telemetryRefetch,
    );
    view.rerenderPage();

    expectEverySection();
    expect(
      screen.getByLabelText(/Drive DNA deterministic emission artwork/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        'One chronological emission is available; at least two are needed for this profile.',
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('shows honest partial states when speed, power, and elevation are missing', () => {
    h.telemetry = query(
      {
        data: [0, 10, 20].map((seconds) =>
          telemetryPoint(seconds, {
            speed: null,
            power: null,
            elevation: null,
            soc: 80 - seconds / 10,
          }),
        ),
      },
      telemetryRefetch,
    );

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Unavailable speed or power channels use neutral geometry and color; they are not encoded as measured zero.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Speed and power channels are unavailable for these emissions.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Elevation is unavailable for this drive; available SoC context remains visible.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No emissions contain available power, so no power state is inferred.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No emissions contain available speed, so no speed band is inferred.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No artistic trait was assigned; unavailable speed or power never creates a substitute trait.',
      ),
    ).toBeInTheDocument();
  });

  it('warns when the 1,000-drive selector history cap is reached', () => {
    h.history = query({
      data: Array.from({ length: 1_000 }, (_, index) =>
        drive({ id: index + 1 }),
      ),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Newest 1,000 drives shown; older drives may be outside this selector.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The selector returned the newest 1,000 drives and reached its cap; older drives may not be selectable.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The selector reached its 1,000-drive history cap; this selected drive’s telemetry remains complete for that drive.',
      ),
    ).toBeInTheDocument();
  });

  it('requests telemetry for the drive selected with the shared Select', async () => {
    renderPage();
    const picker = screen.getByRole('combobox', { name: 'Choose a drive' });

    fireEvent.change(picker, { target: { value: '2' } });

    await waitFor(() => {
      expect(h.telemetryHook).toHaveBeenLastCalledWith('2');
    });
    expect(picker).toHaveValue('2');
  });

  it('derives a valid fallback when a selection leaves the list and disables stale requests during vehicle loading', async () => {
    const view = renderPage();
    const picker = screen.getByRole('combobox', { name: 'Choose a drive' });
    fireEvent.change(picker, { target: { value: '2' } });
    await waitFor(() => expect(h.telemetryHook).toHaveBeenLastCalledWith('2'));

    h.history = query({
      data: [drive({ id: 3, vehicleId: 7 })],
    });
    view.rerenderPage();
    await waitFor(() => expect(h.telemetryHook).toHaveBeenLastCalledWith('3'));
    expect(screen.getByRole('combobox', { name: 'Choose a drive' })).toHaveValue('3');

    h.vehicleId = 8;
    h.history = query({ isLoading: true });
    view.rerenderPage();
    await waitFor(() => expect(h.telemetryHook).toHaveBeenLastCalledWith(''));

    h.history = query({
      data: [drive({ id: 4, vehicleId: 8 })],
    });
    view.rerenderPage();
    await waitFor(() => expect(h.telemetryHook).toHaveBeenLastCalledWith('4'));
    expect(h.historyHook).toHaveBeenLastCalledWith('8', 1_000);
  });

  it('escapes XML export text and performs a local safe SVG download', () => {
    const model = buildDriveDnaModel([
      telemetryPoint(0),
      telemetryPoint(10),
    ]);
    const unsafe = `<Drive & "quoted">'`;
    const svg = buildDriveDnaSvg(model.genome, unsafe);
    expect(svg).toContain('&lt;Drive &amp; &quot;quoted&quot;&gt;&apos;');
    expect(svg).not.toContain(unsafe);

    let downloaded = '';
    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    click.mockImplementation(function captureDownload() {
      downloaded = this.download;
    });
    renderPage();
    vi.useFakeTimers();
    try {
      fireEvent.click(
        screen.getByRole('button', { name: 'Download safe SVG' }),
      );

      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledTimes(1);
      expect(downloaded).toMatch(/^drive-dna-[0-9A-Z]{7}\.svg$/);
      expect(
        document.querySelector('a[download^="drive-dna-"]'),
      ).not.toBeInTheDocument();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();

      vi.advanceTimersByTime(DRIVE_DNA_SVG_REVOKE_DELAY_MS - 1);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:drive-dna');
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });
});
