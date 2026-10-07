import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { Drive } from '@/types/driving';

const FROZEN_NOW = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  drives: undefined as unknown,
  drivesHook: vi.fn(),
  rangeHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'America/Los_Angeles',
}));
const refetch = vi.fn();
const setRange = vi.fn();

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

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/api/hooks/useDriving')
  >();
  return {
    ...actual,
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

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: (options: unknown) => {
    h.rangeHook(options);
    return {
      start: '2015-01-01',
      end: '2026-08-02',
      startInstant: '2015-01-01T08:00:00.000Z',
      endInstantExclusive: '2026-08-03T07:00:00.000Z',
      timezone: h.timeZone,
      presetId: undefined,
      compare: false,
      comparePrev: undefined,
      setRange,
      setPreset: vi.fn(),
      setCompare: vi.fn(),
      reset: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (
      value: number | null | undefined,
      options?: { precision?: number },
    ) =>
      value == null || !Number.isFinite(value)
        ? '—'
        : `${(value / 1_000).toFixed(options?.precision ?? 1)} km`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: ({
    triggerTestId,
  }: {
    triggerTestId?: string;
  }) => <div data-testid={triggerTestId ?? 'range-picker'} />,
}));

import RangeBufferPage from './RangeBufferPage';

let nextId = 1;

function driveAt(
  endTs: string,
  overrides: Partial<Drive> = {},
): Drive {
  const endMs = Date.parse(endTs);
  const startTs = new Date(endMs - 1_800_000).toISOString();
  return {
    id: nextId++,
    vehicleId: 7,
    startTs,
    endTs,
    durationS: 1_800,
    distanceM: 20_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: 80,
    endBatteryPct: 60,
    energyUsedWh: 3_000,
    regenEnergyWh: 300,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 5_000,
    outsideTempAvgC: 18,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: startTs,
    updatedAt: endTs,
    ...overrides,
  };
}

function readyDrives(): Drive[] {
  return [
    driveAt('2026-08-08T08:00:00.000Z', { endBatteryPct: 15 }),
    driveAt('2026-08-07T14:00:00.000Z', { endBatteryPct: 25 }),
    driveAt('2026-08-06T20:00:00.000Z', { endBatteryPct: 35 }),
    driveAt('2026-08-01T09:00:00.000Z', { endBatteryPct: 45 }),
    driveAt('2026-07-25T16:00:00.000Z', { endBatteryPct: 55 }),
    driveAt('2026-07-18T22:00:00.000Z', { endBatteryPct: 65 }),
  ];
}

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
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
    refetch,
    ...overrides,
  };
}

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter
          initialEntries={[
            '/range-buffer?from=2015-01-01&to=2026-08-02',
          ]}
        >
          <RangeBufferPage />
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
  'range-buffer-kpis',
  'range-buffer-distribution',
  'range-buffer-month-trend',
  'range-buffer-threshold-sensitivity',
  'range-buffer-weekday-profile',
  'range-buffer-hour-profile',
  'range-buffer-drive-context',
  'range-buffer-distance-profile',
  'range-buffer-destinations',
  'range-buffer-low-arrivals',
  'range-buffer-evidence-support',
  'range-buffer-accounting',
  'range-buffer-methodology',
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
  h.drives = query({ data: readyDrives() });
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

describe('RangeBufferPage', () => {
  it('renders all thirteen shells with exact local-window bounds and a capped request', () => {
    renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Range Buffer',
      }),
    ).toBeInTheDocument();
    expectEverySection();
    expect(h.drivesHook).toHaveBeenLastCalledWith('7', {
      start: '2015-01-01T08:00:00.000Z',
      end: '2026-08-03T07:00:00.000Z',
      limit: 1_000,
    });
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
    expect(h.rangeHook).toHaveBeenCalledWith(
      expect.objectContaining({
        persistKey: 'range-buffer.range',
        defaultPresetId: 'all',
        timezone: 'America/Los_Angeles',
      }),
    );
  });

  it('freezes recency across query changes', () => {
    const view = renderPage();
    const support = within(
      screen.getByTestId('range-buffer-evidence-support'),
    );
    expect(support.getByText('0.2 days')).toBeInTheDocument();

    vi.mocked(Date.now).mockReturnValue(
      FROZEN_NOW + 30 * 86_400_000,
    );
    h.drives = query({
      data: [
        ...readyDrives(),
        driveAt('2026-06-01T12:00:00.000Z', {
          endAddress: 'Gym',
        }),
      ],
    });
    view.rerenderPage();

    expect(
      within(
        screen.getByTestId('range-buffer-evidence-support'),
      ).getByText('0.2 days'),
    ).toBeInTheDocument();
  });

  it('recomputes every threshold-dependent surface from the selector', () => {
    renderPage();
    const kpis = within(screen.getByTestId('range-buffer-kpis'));
    expect(kpis.getByText('16.7%')).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Arrival battery planning threshold',
      }),
      { target: { value: '30' } },
    );

    expect(kpis.getByText('33.3%')).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId('range-buffer-methodology'),
      ).getByText(/strictly less than 30%/i),
    ).toBeInTheDocument();
  });

  it('keeps every shell visible while loading with one live status', () => {
    h.drives = query({ isLoading: true });

    renderPage();

    expectEverySection();
    expect(
      screen.getByRole('status', {
        name: 'Loading arrival buffer history',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Loading up to 1,000 drives in the selected vehicle-local window...',
      ),
    ).toBeInTheDocument();
  });

  it('keeps every shell visible without a selected vehicle', () => {
    h.vehicleId = null;
    h.drives = query();

    renderPage();

    expectEverySection();
    expect(h.drivesHook).toHaveBeenLastCalledWith(undefined, {
      start: '2015-01-01T08:00:00.000Z',
      end: '2026-08-03T07:00:00.000Z',
      limit: 1_000,
    });
    expect(
      screen.getByText(
        'Select a vehicle to analyze its returned arrival-buffer history.',
      ),
    ).toBeInTheDocument();
  });

  it('shows one actionable retry while all error shells remain mounted', () => {
    h.drives = query({
      isError: true,
      error: new Error('drive history failed'),
    });

    renderPage();

    expectEverySection();
    const retries = screen.getAllByRole('button', {
      name: /retry/i,
    });
    expect(retries).toHaveLength(1);
    fireEvent.click(retries[0]!);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('retains cached evidence during a refresh error with one retry', () => {
    h.drives = query({
      data: readyDrives(),
      isError: true,
      isSuccess: false,
      error: new Error('refresh failed'),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Drive history could not refresh. Showing the most recently loaded arrival evidence.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1);
    expect(
      within(screen.getByTestId('range-buffer-kpis')).getByText(
        '40.0%',
      ),
    ).toBeInTheDocument();
  });

  it('keeps all shells present for an empty successful response', () => {
    h.drives = query({ data: [] });

    renderPage();

    expectEverySection();
    expect(
      within(screen.getByTestId('range-buffer-kpis')).getByText(
        'No drives were returned for this vehicle-local date window.',
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId('range-buffer-accounting'),
      ).getByText('0 returned = 0 included + 0 incomplete + 0 invalid time/order + 0 future-dated + 0 invalid arrival SoC.'),
    ).toBeInTheDocument();
  });
});
