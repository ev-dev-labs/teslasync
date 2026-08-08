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
  history: undefined as unknown,
  historyHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'UTC',
}));
const historyRefetch = vi.fn();

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
  const actual = await importOriginal<typeof import('@/api/hooks/useDriving')>();
  return {
    ...actual,
    useDriveHistory: (vehicleId?: string, limit?: number) => {
      h.historyHook(vehicleId, limit);
      return h.history;
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

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDuration: (
      value: number | null | undefined,
      options?: { precision?: number },
    ) =>
      value == null || !Number.isFinite(value)
        ? '—'
        : `${(value / 60).toFixed(options?.precision ?? 0)} min`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import ArrivalReliabilityPage from './ArrivalReliabilityPage';

let nextId = 1;

function driveAt(startTs: string, overrides: Partial<Drive> = {}): Drive {
  const durationS = overrides.durationS ?? 1_800;
  const endTs =
    overrides.endTs === undefined
      ? new Date(Date.parse(startTs) + durationS * 1_000).toISOString()
      : overrides.endTs;
  return {
    id: nextId++,
    vehicleId: 7,
    startTs,
    endTs,
    durationS,
    distanceM: 20_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 3_000,
    regenEnergyWh: 400,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 5_000,
    outsideTempAvgC: 15,
    insideTempAvgC: 20,
    score: null,
    endedStatus: 'completed',
    createdAt: startTs,
    updatedAt: startTs,
    ...overrides,
    endTs,
  };
}

function readyHistory(): Drive[] {
  return [
    driveAt('2026-08-07T12:00:00.000Z', { durationS: 1_800 }),
    driveAt('2026-07-31T12:00:00.000Z', { durationS: 1_920 }),
    driveAt('2026-07-24T12:00:00.000Z', { durationS: 2_100 }),
    driveAt('2026-08-06T18:00:00.000Z', {
      startAddress: 'Gym',
      endAddress: 'School',
      durationS: 1_100,
    }),
    driveAt('2026-07-30T18:00:00.000Z', {
      startAddress: 'Gym',
      endAddress: 'School',
      durationS: 1_200,
    }),
    driveAt('2026-07-23T18:00:00.000Z', {
      startAddress: 'Gym',
      endAddress: 'School',
      durationS: 1_400,
    }),
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
    refetch: historyRefetch,
    ...overrides,
  };
}

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/driving/arrival-reliability']}>
          <ArrivalReliabilityPage />
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
  'arrival-kpis',
  'arrival-consistency-chart',
  'arrival-timing-bands',
  'arrival-window-comparisons',
  'arrival-window-profile',
  'arrival-weekday-profile',
  'arrival-month-trend',
  'arrival-route-directory',
  'arrival-evidence-quality',
  'arrival-methodology',
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
  h.timeZone = 'UTC';
  h.history = query({ data: readyHistory() });
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

describe('ArrivalReliabilityPage', () => {
  it('renders all ten persistent analytical shells with the capped hook and vehicle timezone', () => {
    renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Arrival Reliability',
      }),
    ).toBeInTheDocument();
    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
  });

  it('freezes the analysis clock across query changes', () => {
    const view = renderPage();
    const quality = within(screen.getByTestId('arrival-evidence-quality'));
    expect(quality.getByText('Recency (days)').parentElement).toHaveTextContent(
      '1.0',
    );

    vi.mocked(Date.now).mockReturnValue(FROZEN_NOW + 10 * 86_400_000);
    h.history = query({
      data: [
        ...readyHistory(),
        driveAt('2026-01-01T10:00:00.000Z', {
          startAddress: 'One-off',
          endAddress: 'Somewhere',
        }),
      ],
    });
    view.rerenderPage();

    expect(
      within(screen.getByTestId('arrival-evidence-quality'))
        .getByText('Recency (days)')
        .parentElement,
    ).toHaveTextContent('1.0');
  });

  it('keeps every shell visible with one live loading status', () => {
    h.history = query({ isLoading: true });

    renderPage();

    expectEverySection();
    expect(
      screen.getAllByLabelText('Loading arrival timing history').length,
    ).toBeGreaterThan(1);
    expect(
      screen.getAllByRole('status', {
        name: 'Loading arrival timing history',
      }),
    ).toHaveLength(1);
    expect(
      screen.getAllByText('Waiting for returned drive history…'),
    ).toHaveLength(6);
    expect(screen.queryByText('0 rows returned')).toBeNull();
    expect(screen.queryByText('Below the 1,000-row cap')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows one actionable initial error without removing any shell', () => {
    h.history = query({
      isError: true,
      error: new Error('history unavailable'),
    });

    renderPage();

    expectEverySection();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByText("Can't reach server")).toHaveLength(1);
    expect(
      screen.getAllByText(
        'Drive history is unavailable; use the status below to retry.',
      ),
    ).toHaveLength(6);
    expect(screen.queryByText('0 rows returned')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });

  it('preserves cached evidence and offers one refresh retry', () => {
    h.history = query({
      data: readyHistory(),
      isError: true,
      error: new Error('refresh unavailable'),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Drive history could not refresh. Showing the most recently loaded timing evidence.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Home → Office').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps all shells visible when no vehicle is selected', () => {
    h.vehicleId = null;

    renderPage();

    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(
      screen.getByText(
        'Select a vehicle to analyze its returned directional-route timing.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Select a vehicle above to load timing evidence.'),
    ).toHaveLength(6);
    expect(screen.queryByText('Below the 1,000-row cap')).toBeNull();
  });

  it('keeps all shells visible for empty returned history', () => {
    h.history = query({ data: [] });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'No drives were returned, so no route timing claim is made.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('arrival-kpis')).getAllByText('0').length,
    ).toBeGreaterThan(0);
  });

  it('keeps all shells visible with insufficient repeated-route evidence', () => {
    h.history = query({
      data: [
        driveAt('2026-08-07T12:00:00.000Z'),
        driveAt('2026-08-06T12:00:00.000Z'),
      ],
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Included drives are available, but no directional route has three samples yet.',
      ),
    ).toBeInTheDocument();
  });

  it('warns at exactly 1,000 returned rows without hiding evidence', () => {
    h.history = query({
      data: Array.from({ length: 1_000 }, () =>
        driveAt('2026-08-07T12:00:00.000Z'),
      ),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Exactly 1,000 rows were returned. Findings cover the returned latest history and may not represent lifetime driving.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The 1,000-row return cap was reached. Accounting is complete for returned rows, not established lifetime history.',
      ),
    ).toBeInTheDocument();
  });

  it('uses vehicle timezone at a weekday boundary', () => {
    h.timeZone = 'America/Los_Angeles';
    h.history = query({
      data: Array.from({ length: 3 }, (_, index) =>
        driveAt(`2026-01-06T00:3${index}:00.000Z`),
      ),
    });

    renderPage();

    const weekday = within(screen.getByTestId('arrival-weekday-profile'));
    expect(weekday.getAllByText('Monday').length).toBeGreaterThan(0);
    expect(weekday.getAllByText('3').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/America\/Los_Angeles/).length,
    ).toBeGreaterThan(0);
  });

  it('handles a sole supported window without duplicated extreme claims', () => {
    h.history = query({
      data: [
        driveAt('2026-08-07T12:00:00.000Z'),
        driveAt('2026-08-06T12:00:00.000Z'),
        driveAt('2026-08-05T12:00:00.000Z'),
      ],
    });

    renderPage();

    expect(
      screen.getByText(
        'Only one route-window is supported, so no highest-versus-lowest comparison is asserted.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Only supported route-window'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Lowest observed timing consistency'),
    ).toBeNull();
  });

  it('avoids misleading score and chance terminology', () => {
    renderPage();

    expect(screen.queryByText(/Probability/i)).toBeNull();
    expect(screen.queryByText(/Reliability Score/i)).toBeNull();
  });

  it('provides accessible summaries for every chart', () => {
    renderPage();

    for (const label of [
      'Timing consistency index and observed within-allowance share for supported directional routes',
      'Observed median, ninetieth percentile, and p90-minus-p50 timing buffer for supported routes',
      'Twelve-bin vehicle-local departure-window profile of route-normalized duration, observed allowance share, and samples',
      'Seven-day vehicle-timezone profile of route-normalized duration, observed allowance share, and samples',
      'Vehicle-local monthly trend of route-normalized duration, observed allowance share, and samples',
    ]) {
      expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    }
  });
});
