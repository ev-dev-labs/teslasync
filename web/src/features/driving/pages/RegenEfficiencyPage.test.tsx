import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { Drive, RegenEfficiencyData } from '@/types/driving';

const h = vi.hoisted(() => ({
  aggregate: undefined as unknown,
  drives: undefined as unknown,
  vehicleId: 7 as number | null,
  aggregateHook: vi.fn(),
  drivesHook: vi.fn(),
}));

const aggregateRefetch = vi.fn();
const drivesRefetch = vi.fn();
const csvMocks = vi.hoisted(() => ({
  objectsToCSV: vi.fn(
    (_rows: readonly Record<string, unknown>[]) => 'csv',
  ),
  downloadCSV: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  );
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        let text = typeof fallback === 'string' ? fallback : key;
        const values =
          options && typeof options === 'object'
            ? (options as Record<string, unknown>)
            : {};
        text = text.replace(
          /\{\{\s*(\w+)\s*\}\}/g,
          (_match, name: string) =>
            values[name] != null ? String(values[name]) : '',
        );
        return text;
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
    useRegenEfficiency: (
      vehicleId?: string,
      start?: string,
      end?: string,
    ) => {
      h.aggregateHook(vehicleId, start, end);
      return h.aggregate;
    },
    useDrives: (
      vehicleId?: string,
      options?: {
        start?: string;
        end?: string;
        limit?: number;
      },
    ) => {
      h.drivesHook(vehicleId, options);
      return h.drives;
    },
  };
});

vi.mock('@/lib/csvExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csvExport')>();
  return {
    ...actual,
    objectsToCSV: csvMocks.objectsToCSV,
    downloadCSV: csvMocks.downloadCSV,
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
    useTimezone: () => 'America/Los_Angeles',
  };
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
      value == null ? '—' : `${value} distance`,
    formatSpeed: (value: number | null | undefined) =>
      value == null ? '—' : `${value} speed`,
    formatTemperature: (value: number | null | undefined) =>
      value == null ? '—' : `${value} °C`,
    formatPressure: (value: number | null | undefined) =>
      value == null ? '—' : `${value} pressure`,
    formatEnergy: (value: number | null | undefined) =>
      value == null ? '—' : `${value} energy`,
    formatDuration: (value: number | null | undefined) =>
      value == null ? '—' : `${value} duration`,
    formatPower: (value: number | null | undefined) =>
      value == null ? '—' : `${value} power`,
  }),
}));

vi.mock('@/components/forms', () => ({
  RangePicker: ({
    value,
    onChange,
    triggerTestId,
  }: {
    value: { start: string; end: string };
    onChange: (range: { start: string; end: string }) => void;
    triggerTestId?: string;
  }) => (
    <button
      type="button"
      data-testid={triggerTestId}
      data-start={value.start}
      data-end={value.end}
      onClick={() =>
        onChange({ start: '2026-01-01', end: '2026-01-31' })
      }
    >
      change range
    </button>
  ),
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import RegenEfficiencyPage from './RegenEfficiencyPage';

function makeDrive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicleId: 7,
    startTs: '2025-01-15T12:00:00Z',
    endTs: '2025-01-15T12:30:00Z',
    durationS: 1_800,
    distanceM: 25_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 70,
    endBatteryPct: 60,
    energyUsedWh: 8_000,
    regenEnergyWh: 2_000,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 4_000,
    outsideTempAvgC: 15,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: '2025-01-15T12:00:00Z',
    updatedAt: '2025-01-15T12:30:00Z',
    ...overrides,
  };
}

function makeAggregate(
  overrides: Partial<RegenEfficiencyData> = {},
): RegenEfficiencyData {
  return {
    vehicleId: 7,
    totalRegenWh: 50_000,
    totalDriveWh: 200_000,
    regenRatio: 25,
    monthlyAvgRegen: 7_000,
    freeCharges: 0.7,
    monthlySummary: [],
    drives: [],
    batteryCapacityWh: 75_000,
    capacitySource: 'vin_estimate',
    ...overrides,
  };
}

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

function query(
  overrides: Partial<QueryStub> = {},
  refetch = aggregateRefetch,
): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/driving/regen']}>
          <RegenEfficiencyPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  h.vehicleId = 7;
  h.aggregate = query({ data: makeAggregate() }, aggregateRefetch);
  h.drives = query(
    {
      data: [
        makeDrive(),
        makeDrive({
          id: 2,
          startTs: '2025-02-20T12:00:00Z',
          energyUsedWh: 10_000,
          regenEnergyWh: 3_000,
          outsideTempAvgC: 5,
          startBatteryPct: 85,
        }),
      ],
    },
    drivesRefetch,
  );
});

describe('RegenEfficiencyPage', () => {
  it('renders the ready state with all eight persistent evidence sections', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Regenerative Braking' }),
    ).toBeInTheDocument();
    for (const testId of [
      'regen-kpis',
      'regen-overview',
      'regen-monthly',
      'regen-distribution',
      'regen-temperature',
      'regen-soc',
      'regen-evidence',
      'regen-methodology',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    const kpis = screen.getByTestId('regen-kpis');
    for (const label of [
      'Aggregate recovered',
      'Aggregate recovery share',
      'Equivalent full-pack cycles',
      'Aggregate drive energy',
      'Detailed rows returned',
      'Eligible detailed coverage',
    ]) {
      expect(within(kpis).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Drive #2')).toBeInTheDocument();
    expect(screen.queryByText('Monthly Avg kW')).not.toBeInTheDocument();
  });

  it('keeps every section shell visible while both queries load', () => {
    h.aggregate = query({
      isLoading: true,
      isFetching: true,
      dataUpdatedAt: 0,
    });
    h.drives = query(
      { isLoading: true, isFetching: true, dataUpdatedAt: 0 },
      drivesRefetch,
    );

    const { container } = renderPage();

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    for (const testId of [
      'regen-kpis',
      'regen-overview',
      'regen-monthly',
      'regen-distribution',
      'regen-temperature',
      'regen-soc',
      'regen-evidence',
      'regen-methodology',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(screen.getAllByText('Loading…').length).toBeGreaterThanOrEqual(6);
    expect(
      screen.queryByText('Below the 1,000-row request cap'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No detailed rows returned'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No detailed drives were returned for this window.'),
    ).not.toBeInTheDocument();
  });

  it('isolates an aggregate error while detailed evidence remains available', () => {
    h.aggregate = query({
      isError: true,
      error: new Error('aggregate down'),
    });

    renderPage();

    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThan(0);
    expect(screen.getByText('Monthly recovery trend')).toBeInTheDocument();
    expect(screen.getByText('Drive #2')).toBeInTheDocument();
    expect(screen.getByText('Ambient-temperature context')).toBeInTheDocument();

    const errorRegion = screen.getByTestId('regen-kpis-aggregate-error');
    fireEvent.click(within(errorRegion).getByRole('button', { name: 'Retry' }));
    expect(aggregateRefetch).toHaveBeenCalledTimes(1);
    expect(drivesRefetch).not.toHaveBeenCalled();
  });

  it('isolates a detailed-drives error while complete aggregate evidence remains available', () => {
    h.drives = query(
      { isError: true, error: new Error('drives down') },
      drivesRefetch,
    );

    renderPage();

    expect(screen.getByText('50000 energy')).toBeInTheDocument();
    expect(screen.getByText('Complete aggregate')).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Below the 1,000-row request cap'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No detailed rows returned'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No detailed drives were returned for this window.'),
    ).not.toBeInTheDocument();

    const errorRegion = screen.getByTestId('regen-kpis-detail-error');
    fireEvent.click(within(errorRegion).getByRole('button', { name: 'Retry' }));
    expect(drivesRefetch).toHaveBeenCalledTimes(1);
    expect(aggregateRefetch).not.toHaveBeenCalled();
  });

  it('uses availability copy until the detailed query resolves successfully', () => {
    h.drives = query(
      { data: undefined, isSuccess: false },
      drivesRefetch,
    );

    renderPage();

    expect(
      screen.getAllByText(
        'Detailed data availability has not resolved.',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText('Detailed availability not resolved'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Below the 1,000-row request cap'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No detailed rows returned'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No detailed drives were returned for this window.'),
    ).not.toBeInTheDocument();
  });

  it('renders explicit empty content in every section', () => {
    h.aggregate = query({
      data: makeAggregate({
        totalRegenWh: 0,
        totalDriveWh: 0,
        regenRatio: 0,
        freeCharges: 0,
      }),
    });
    h.drives = query({ data: [] }, drivesRefetch);

    renderPage();

    expect(
      screen.getByText(
        'No aggregate energy or detailed drives were returned for this selected window.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The complete aggregate contains no drive-energy denominator for this window.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No detailed drives were returned for this window.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No eligible dated drives are available for a monthly trend.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No eligible per-drive ratios are available for a distribution.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No returned drives include usable ambient-temperature context.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'No returned drives include usable starting-SoC context.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No eligible detailed drives are available to rank.'),
    ).toBeInTheDocument();
  });

  it('warns throughout detailed sections when the 1,000-row cap is reached', () => {
    h.drives = query(
      {
        data: Array.from({ length: 1_000 }, (_, index) =>
          makeDrive({
            id: index + 1,
            startTs: `2025-01-${String((index % 28) + 1).padStart(2, '0')}T12:00:00Z`,
          }),
        ),
      },
      drivesRefetch,
    );

    renderPage();

    expect(screen.getByText('1,000-row cap reached')).toBeInTheDocument();
    expect(
      screen.getAllByText('Detailed history cap reached').length,
    ).toBeGreaterThanOrEqual(6);
  });

  it('calls both hooks with timezone-resolved instant bounds and a 1,000-row detailed limit', async () => {
    renderPage();

    expect(h.aggregateHook).toHaveBeenLastCalledWith(
      '7',
      expect.any(String),
      expect.any(String),
    );
    expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
      start: expect.any(String),
      end: expect.any(String),
      limit: 1_000,
    });

    fireEvent.click(screen.getByTestId('regen-efficiency-range'));

    await waitFor(() => {
      expect(h.aggregateHook).toHaveBeenLastCalledWith(
        '7',
        '2026-01-01T08:00:00.000Z',
        '2026-02-01T08:00:00.000Z',
      );
      expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
        start: '2026-01-01T08:00:00.000Z',
        end: '2026-02-01T08:00:00.000Z',
        limit: 1_000,
      });
    });
  });

  it('uses the selected timezone for ranked drive dates', () => {
    h.drives = query(
      {
        data: [
          makeDrive({
            startTs: '2025-03-01T01:30:00Z',
            endTs: '2025-03-01T02:00:00Z',
          }),
        ],
      },
      drivesRefetch,
    );

    renderPage();

    expect(screen.getByText('Feb 28, 2025')).toBeInTheDocument();
    expect(screen.queryByText('Mar 1, 2025')).not.toBeInTheDocument();
  });

  it('shows and exports unavailable monthly measurements as gaps rather than zeros', () => {
    h.drives = query(
      {
        data: [
          makeDrive({
            id: 1,
            startTs: '2025-01-15T12:00:00Z',
          }),
          makeDrive({
            id: 2,
            startTs: '2025-02-15T12:00:00Z',
            regenEnergyWh: null,
          }),
        ],
      },
      drivesRefetch,
    );

    renderPage();

    const caption = screen.getByText(
      'Monthly recovery trend — data table',
    );
    const table = caption.closest('table');
    expect(table).not.toBeNull();
    const februaryRow = Array.from(
      table!.querySelectorAll('tbody tr'),
    ).find((row) => row.querySelector('td')?.textContent === '2025-02');
    expect(februaryRow).toBeDefined();
    expect(
      Array.from(februaryRow!.querySelectorAll('td')).map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['2025-02', '—', '—', '—', '0', '1']);

    const monthlySection = screen.getByTestId('regen-monthly');
    fireEvent.click(
      within(monthlySection).getByRole('button', { name: 'Export chart' }),
    );
    fireEvent.click(
      within(monthlySection).getByRole('menuitem', {
        name: 'Download data as CSV',
      }),
    );

    const exportRows = csvMocks.objectsToCSV.mock.calls.at(-1)?.[0];
    expect(exportRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Month: '2025-02',
          'Recovered energy (kWh)': '—',
          'Drive energy (kWh)': '—',
          'Weighted recovery share': '—',
        }),
      ]),
    );
  });

  it('shows no aggregate recovery percentage without a finite positive denominator', () => {
    h.aggregate = query({
      data: makeAggregate({
        totalRegenWh: 1_000,
        totalDriveWh: 0,
        regenRatio: 0,
      }),
    });
    h.drives = query({ data: [] }, drivesRefetch);

    renderPage();

    const shareCard = screen
      .getByText('Aggregate recovery share')
      .closest('[data-role="metric-card"]');
    expect(shareCard).not.toBeNull();
    expect(within(shareCard as HTMLElement).getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('calls out zero aggregate totals when measured detail proves aggregate unavailability', () => {
    h.aggregate = query({
      data: makeAggregate({
        totalRegenWh: 0,
        totalDriveWh: 0,
        regenRatio: 0,
        freeCharges: 0,
      }),
    });

    renderPage();

    expect(screen.getByText('Aggregate totals unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Treat the complete aggregate as unavailable, not as evidence of 0% recovery/,
      ),
    ).toBeInTheDocument();
  });
});
