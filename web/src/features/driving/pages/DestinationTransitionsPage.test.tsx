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

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import DestinationTransitionsPage from './DestinationTransitionsPage';

let nextId = 1;

function driveAt(
  startTs: string,
  startAddress: string | null,
  endAddress: string | null,
  overrides: Partial<Drive> = {},
): Drive {
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
    startAddress,
    endAddress,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
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
    driveAt('2026-08-01T10:00:00.000Z', 'Home', 'A'),
    driveAt('2026-08-02T10:00:00.000Z', 'A', 'B'),
    driveAt('2026-08-03T10:00:00.000Z', 'B', 'A'),
    driveAt('2026-08-04T10:00:00.000Z', 'A', 'B'),
    driveAt('2026-08-05T10:00:00.000Z', 'B', 'A'),
    driveAt('2026-08-06T10:00:00.000Z', 'A', 'B'),
    driveAt('2026-08-07T10:00:00.000Z', 'B', 'A'),
    driveAt('2026-08-08T10:00:00.000Z', 'A', 'C'),
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
        <MemoryRouter initialEntries={['/driving/destination-transitions']}>
          <DestinationTransitionsPage />
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
  'destination-transitions-kpis',
  'destination-visit-share',
  'destination-origin-concentration',
  'destination-transition-matrix',
  'destination-leading-directory',
  'destination-frequent-edges',
  'destination-information-edges',
  'destination-two-hour-profile',
  'destination-weekday-profile',
  'destination-month-trend',
  'destination-evidence-quality',
  'destination-methodology',
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

describe('DestinationTransitionsPage', () => {
  it('renders all twelve shells with the capped hook and vehicle timezone', () => {
    renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Destination Transitions',
      }),
    ).toBeInTheDocument();
    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
  });

  it('freezes the analysis clock across cached data changes', () => {
    const view = renderPage();
    const quality = within(
      screen.getByTestId('destination-evidence-quality'),
    );
    expect(
      quality.getByText('Visit recency (days)').parentElement,
    ).toHaveTextContent('0.1');

    vi.mocked(Date.now).mockReturnValue(
      FROZEN_NOW + 10 * 86_400_000,
    );
    h.history = query({
      data: [
        ...readyHistory(),
        driveAt('2026-01-01T10:00:00.000Z', 'Old', 'Archive'),
      ],
    });
    view.rerenderPage();

    expect(
      within(screen.getByTestId('destination-evidence-quality'))
        .getByText('Visit recency (days)')
        .parentElement,
    ).toHaveTextContent('0.1');
  });

  it('keeps every shell visible with one live loading status', () => {
    h.history = query({ isLoading: true });
    renderPage();

    expectEverySection();
    expect(
      screen.getAllByRole('status', {
        name: 'Loading destination transition history',
      }),
    ).toHaveLength(1);
    expect(
      screen.getAllByText('Waiting for returned drive history…'),
    ).toHaveLength(6);
    expect(screen.queryByText('0 rows returned')).toBeNull();
    expect(
      screen.queryByText('returned history below the 1,000-row cap'),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows one actionable initial error without removing shells', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
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
        'Drive history could not refresh. Showing the most recently loaded destination evidence.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('A → B').length).toBeGreaterThan(0);
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
        'Select a vehicle to analyze its returned destination visits and continuity-safe transitions.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        'Select a vehicle above to load destination evidence.',
      ),
    ).toHaveLength(6);
    expect(
      screen.queryByText('returned history below the 1,000-row cap'),
    ).toBeNull();
  });

  it('keeps all shells visible for empty returned history', () => {
    h.history = query({ data: [] });
    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'No drives were returned, so no destination or transition claim is made.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('destination-transitions-kpis'))
        .getAllByText('0').length,
    ).toBeGreaterThan(0);
  });

  it('reports no accepted continuity without hiding visit evidence', () => {
    h.history = query({
      data: [
        driveAt('2026-08-07T10:00:00.000Z', 'Home', 'Work'),
        driveAt('2026-08-08T10:00:00.000Z', 'Home', 'Gym'),
      ],
    });
    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Included destination visits are available, but no adjacent pair passed endpoint continuity and time-order checks.',
      ),
    ).toBeInTheDocument();
    const quality = within(
      screen.getByTestId('destination-evidence-quality'),
    );
    expect(
      quality.getByText('Endpoint mismatch').parentElement,
    ).toHaveTextContent('1');
  });

  it('shows thin evidence for a sole observed outgoing edge', () => {
    h.history = query({
      data: [
        driveAt('2026-08-07T10:00:00.000Z', 'Home', 'A'),
        driveAt('2026-08-08T10:00:00.000Z', 'A', 'B'),
      ],
    });
    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Accepted transitions are descriptive, but no origin has the three outgoing observations required for supported evidence.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('Thin evidence').length,
    ).toBeGreaterThan(0);
    const kpis = within(
      screen.getByTestId('destination-transitions-kpis'),
    );
    expect(
      kpis.getByText('Supported origin states').parentElement
        ?.parentElement?.parentElement,
    ).toHaveTextContent('0');
  });

  it('warns at exactly 1,000 returned rows without hiding evidence', () => {
    h.history = query({
      data: Array.from({ length: 1_000 }, () =>
        driveAt('2026-08-07T10:00:00.000Z', 'Home', 'A'),
      ),
    });
    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Exactly 1,000 rows were returned. Findings cover only the latest returned history and may be capped.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The 1,000-row return cap was reached. Accounting is complete for returned rows, not established lifetime history.',
      ),
    ).toBeInTheDocument();
  });

  it('withholds stale latest insight when the actual latest row is unknown', () => {
    h.history = query({
      data: [
        ...readyHistory(),
        driveAt('2026-08-08T11:00:00.000Z', 'C', null),
      ],
    });
    renderPage();

    const kpis = within(
      screen.getByTestId('destination-transitions-kpis'),
    );
    expect(
      kpis.getByText(
        /The actual latest row is unusable, so no historical successor is shown/,
      ),
    ).toBeInTheDocument();
    expect(
      kpis.queryByText(
        /Historical leading successor from latest observed destination: B/,
      ),
    ).toBeNull();
  });

  it('uses the vehicle timezone at a weekday boundary', () => {
    h.timeZone = 'America/Los_Angeles';
    h.history = query({
      data: [
        driveAt('2026-01-05T23:00:00.000Z', 'Home', 'A'),
        driveAt('2026-01-06T00:30:00.000Z', 'A', 'B'),
      ],
    });
    renderPage();

    const weekday = within(
      screen.getByTestId('destination-weekday-profile'),
    );
    expect(weekday.getAllByText('Monday').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/America\/Los_Angeles/).length,
    ).toBeGreaterThan(0);
  });

  it('avoids overclaiming terminology', () => {
    renderPage();

    expect(screen.queryByText(/Probability/i)).toBeNull();
    expect(screen.queryByText(/Predictability/i)).toBeNull();
    expect(screen.queryByText(/Prediction/i)).toBeNull();
    expect(screen.queryByText(/Surprising/i)).toBeNull();
  });

  it('provides accessible summaries for every chart', () => {
    renderPage();

    expect(
      screen.getByRole('img', {
        name: 'Visit share for the most common normalized end destinations',
      }),
    ).toBeInTheDocument();
    for (const label of [
      'Transition concentration index and historical leading successor share by origin',
      'Twelve-bin vehicle-local profile of accepted transition counts and concentration',
      'Seven-day vehicle-timezone profile of accepted transition counts and concentration',
      'Vehicle-local monthly trend of accepted transition counts and concentration',
    ]) {
      expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
    }
  });
});
