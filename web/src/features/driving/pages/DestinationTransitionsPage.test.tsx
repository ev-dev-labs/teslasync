import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

// Keep the real chart frames and legend/controller; replace only layout-dependent Recharts rendering.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const series = ({ dataKey, hide, connectNulls }: {
    dataKey?: string; hide?: boolean; connectNulls?: boolean;
  }) => (
    <span data-testid={`plot-series-${dataKey}`} data-hidden={String(!!hide)}
      data-connect-nulls={String(connectNulls)} />
  );
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    ComposedChart: ({ children, data }: { children?: ReactNode; data?: unknown }) => (
      <div data-testid="profile-plot" data-rows={JSON.stringify(data)}>{children}</div>
    ),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Bar: series,
    Line: series,
    Legend: ({ formatter }: {
      formatter?: (value: string, entry: { dataKey: string; value: string }) => ReactNode;
    }) => (
      <div>
        {['samples', 'concentration', 'leadingShare'].map((key) => (
          <span key={key}>{formatter?.(key, { dataKey: key, value: key })}</span>
        ))}
      </div>
    ),
  };
});

import DestinationTransitionsPage from './DestinationTransitionsPage';
import { DestinationTransitionProfilePlot } from '../components/destination-transitions/DestinationTransitionProfilePlot';
import { OriginConcentrationPlot } from '../components/destination-transitions/OriginConcentrationPlot';

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

function LocationProbe() {
  return <output data-testid="profile-url">{useLocation().search}</output>;
}

function tree(client: QueryClient, search = '') {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/driving/destination-transitions${search}`]}>
          <DestinationTransitionsPage />
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage(search = '') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(tree(client, search));
  return {
    ...view,
    rerenderPage: () => view.rerender(tree(client, search)),
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
  it('uses the origin host legend identity while retaining full evidence and exports', () => {
    renderPage('?hidden_destination-origin-concentration=concentration&hidden_origin-concentration=leadingShare&hidden_destination-weekday-profile=concentration&keep=1');
    const section = screen.getByTestId('destination-origin-concentration');
    const origin = within(section);
    expect(section.querySelectorAll('figure')).toHaveLength(1);
    expect(origin.getAllByRole('table')).toHaveLength(1);
    expect(origin.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Origin destination', 'Transition concentration index', 'Leading successor share (%)',
      'Outgoing transitions', 'Distinct observed successors', 'Support index', 'Evidence band',
    ]);
    expect(origin.getAllByRole('button', { name: 'Export chart' })).toHaveLength(1);
    fireEvent.click(origin.getByRole('button', { name: 'Export chart' }));
    expect(screen.getByRole('menuitem', { name: 'Download data as CSV' })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Export chart' }), { key: 'Escape' });
    expect(origin.getByTestId('plot-series-concentration')).toHaveAttribute('data-hidden', 'true');
    expect(origin.getByRole('button', { name: 'concentration' })).toHaveAttribute('aria-pressed', 'true');
    expect(origin.getByTestId('plot-series-leadingShare')).toHaveAttribute('data-hidden', 'false');
    fireEvent.click(origin.getByRole('button', { name: 'concentration' }));
    fireEvent.click(origin.getByRole('button', { name: 'leadingShare' }));
    expect(origin.getByTestId('plot-series-concentration')).toHaveAttribute('data-hidden', 'false');
    expect(origin.getByTestId('plot-series-leadingShare')).toHaveAttribute('data-hidden', 'true');
    expect(origin.getByRole('button', { name: 'leadingShare' })).toHaveAttribute('aria-pressed', 'true');
    const params = new URLSearchParams(screen.getByTestId('profile-url').textContent ?? '');
    expect(params.get('hidden_destination-origin-concentration')).toBe('leadingShare');
    expect(params.get('hidden_origin-concentration')).toBe('leadingShare');
    expect(params.get('hidden_destination-weekday-profile')).toBe('concentration');
    expect(params.get('keep')).toBe('1');
    const points = JSON.parse(origin.getByTestId('profile-plot').getAttribute('data-rows') ?? '[]') as Array<Record<string, unknown>>;
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]).toEqual(expect.objectContaining({
      outgoing: expect.any(Number), successors: expect.any(Number),
      supportIndex: expect.any(Number), support: expect.any(String),
    }));
    expectEverySection();
  });

  it('preserves the standalone origin identity and all evidence columns', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/?hidden_origin-concentration=leadingShare&keep=1']}>
          <OriginConcentrationPlot
            rows={[{ origin: 'Fixture origin', concentration: 75, leadingShare: 80, outgoing: 5, successors: 2, supportIndex: 60, support: 'Thin evidence' }]}
            locale="en-US" concentrationName="Concentration" leadingName="Leading share"
          />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getByRole('cell', { name: 'Fixture origin' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Thin evidence' })).toBeInTheDocument();
    expect(screen.getByTestId('plot-series-leadingShare')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByRole('button', { name: 'leadingShare' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'leadingShare' }));
    expect(screen.getByTestId('plot-series-leadingShare')).toHaveAttribute('data-hidden', 'false');
    expect(screen.getByTestId('profile-url')).toHaveTextContent('?keep=1');
  });

  it('uses independent host URL controllers for plots and legends without nested chart frames', () => {
    renderPage('?hidden_destination-two-hour-profile=samples&hidden_destination-weekday-profile=concentration&hidden_destination-transition-profile=samples&keep=1');
    const twoHour = within(screen.getByTestId('destination-two-hour-profile'));
    const weekday = within(screen.getByTestId('destination-weekday-profile'));
    const month = within(screen.getByTestId('destination-month-trend'));
    expect(twoHour.getByTestId('plot-series-samples')).toHaveAttribute('data-hidden', 'true');
    expect(twoHour.getByRole('button', { name: 'samples' })).toHaveAttribute('aria-pressed', 'true');
    expect(weekday.getByTestId('plot-series-concentration')).toHaveAttribute('data-hidden', 'true');
    expect(month.getByTestId('plot-series-samples')).toHaveAttribute('data-hidden', 'false');

    fireEvent.click(twoHour.getByRole('button', { name: 'samples' }));
    expect(twoHour.getByTestId('plot-series-samples')).toHaveAttribute('data-hidden', 'false');
    expect(twoHour.getByRole('button', { name: 'samples' })).toHaveAttribute('aria-pressed', 'false');
    expect(weekday.getByTestId('plot-series-concentration')).toHaveAttribute('data-hidden', 'true');
    const params = new URLSearchParams(screen.getByTestId('profile-url').textContent ?? '');
    expect(params.has('hidden_destination-two-hour-profile')).toBe(false);
    expect(params.get('hidden_destination-weekday-profile')).toBe('concentration');
    expect(params.get('hidden_destination-transition-profile')).toBe('samples');
    expect(params.get('keep')).toBe('1');

    for (const id of ['destination-two-hour-profile', 'destination-weekday-profile', 'destination-month-trend']) {
      const section = screen.getByTestId(id);
      expect(section.querySelectorAll('figure')).toHaveLength(1);
      expect(within(section).getAllByRole('table')).toHaveLength(1);
      expect(within(section).getAllByRole('columnheader')).toHaveLength(7);
      expect(within(section).getAllByRole('button', { name: 'Export chart' })).toHaveLength(1);
      expect(within(section).getByTestId('plot-series-concentration')).toHaveAttribute('data-connect-nulls', 'false');
    }
    const points = JSON.parse(twoHour.getByTestId('profile-plot').getAttribute('data-rows') ?? '[]') as Array<{ samples: number; concentration: number | null; leadingShare: number | null; support: string }>;
    expect(points).toHaveLength(12);
    expect(points.some((point) => point.samples > 0 && point.concentration != null)).toBe(true);
    expect(points.some((point) => point.samples === 0 && point.concentration === null && point.leadingShare === null)).toBe(true);
    expectEverySection();
  });

  it('retains the legacy standalone URL key and complete accessible evidence', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/?hidden_destination-transition-profile=concentration']}>
          <DestinationTransitionProfilePlot
            rows={[{ label: 'Empty window', samples: 0, origins: 0, destinations: 0, concentration: null, leadingShare: null, support: 'Thin evidence' }]}
            locale="en-US" countSeriesName="Samples" concentrationSeriesName="Concentration"
          />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getByTestId('plot-series-concentration')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByRole('button', { name: 'concentration' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'concentration' }));
    expect(screen.getByTestId('plot-series-concentration')).toHaveAttribute('data-hidden', 'false');
    expect(screen.getByTestId('profile-url').textContent).toBe('');
    expect(screen.getAllByRole('cell').filter((cell) => cell.textContent === '—')).toHaveLength(2);
  });

  it('retains all four evidence populations and configuration readouts in real briefs', () => {
    renderPage();
    const expected = [
      ['destination-row-accounting-brief', 11],
      ['destination-continuity-accounting-brief', 10],
      ['destination-coverage-recency-brief', 15],
      ['destination-descriptive-support-brief', 11],
    ] as const;
    for (const [id, count] of expected) {
      expect(screen.getByTestId(id).querySelectorAll('[data-operational-value]')).toHaveLength(count);
    }
    expect(screen.getByTestId('destination-continuity-accounting-brief')).toHaveTextContent('GPS continuity tolerance');
    expect(screen.getByTestId('destination-descriptive-support-brief')).toHaveTextContent('Effective successor count');
    expect(screen.getByTestId('destination-descriptive-support-brief')).toHaveTextContent('not a counted event population');
    expectEverySection();
  });

  it('retains the transition matrix, directory and temporal evidence through a paused refresh', () => {
    h.history = { ...query({ data: readyHistory() }), fetchStatus: 'paused' };
    renderPage();
    expectEverySection();
    const notice = screen.getByTestId('stale-refresh-warning');
    expect(notice).toHaveTextContent(
      'The latest values are temporarily unavailable. Previously loaded data remains visible.',
    );
    expect(notice).toHaveAttribute('data-refresh-blocked', 'true');
    expect(notice).not.toHaveTextContent(/offline|failed/i);
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });

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
    ).toHaveTextContent('0.06');

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
    ).toHaveTextContent('0.06');
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
      kpis.getByText('Supported origin states').closest('[data-operational-metric="origins"]'),
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

describe('DestinationTransitionsPage snapshot clock', () => {
  it('includes newly completed visits after a successful history refresh', () => {
    const initial = readyHistory();
    h.history = { ...query({ data: initial }), dataUpdatedAt: FROZEN_NOW };
    const view = renderPage();
    const refreshedAt = FROZEN_NOW + 86_400_000;
    vi.mocked(Date.now).mockReturnValue(refreshedAt + 2 * 86_400_000);
    h.history = {
      ...query({
        data: [
          ...initial,
          driveAt('2026-08-09T10:00:00.000Z', 'C', 'Fixture destination'),
        ],
      }),
      dataUpdatedAt: refreshedAt,
    };
    view.rerenderPage();

    expectEverySection();
    const summary = within(screen.getByTestId('destination-transitions-kpis'));
    expect(summary.getByText('Included destination visits').closest('[data-operational-metric="visits"]')).toHaveTextContent('9');
    expect(summary.getByText('Latest observed destination').closest('[data-operational-metric="latest"]')).toHaveTextContent('Fixture destination');
    const quality = within(screen.getByTestId('destination-evidence-quality'));
    expect(quality.getByText('Visit recency (days)').parentElement).toHaveTextContent('0.06');
    expect(quality.getByText('Future rows').parentElement).toHaveTextContent('0');
  });

  it('advances recency when a successful snapshot retains the same drive array', () => {
    const data = readyHistory();
    h.history = { ...query({ data }), dataUpdatedAt: FROZEN_NOW };
    const view = renderPage();
    h.history = {
      ...query({ data }),
      dataUpdatedAt: FROZEN_NOW + 86_400_000,
    };
    view.rerenderPage();

    const quality = within(screen.getByTestId('destination-evidence-quality'));
    expect(quality.getByText('Visit recency (days)').parentElement).toHaveTextContent('1.06');
    expectEverySection();
  });

  it.each([
    { caseId: 'failed refresh', failed: true },
    { caseId: 'paused refresh', failed: false },
  ])('retains the successful analysis instant during $caseId', ({ failed }) => {
    const data = readyHistory();
    h.history = { ...query({ data }), dataUpdatedAt: FROZEN_NOW };
    const view = renderPage();
    vi.mocked(Date.now).mockReturnValue(FROZEN_NOW + 10 * 86_400_000);
    h.history = {
      ...query({
        data,
        isError: failed,
        error: failed ? new Error('fixture refresh unavailable') : null,
      }),
      dataUpdatedAt: FROZEN_NOW,
      fetchStatus: failed ? 'idle' : 'paused',
    };
    view.rerenderPage();

    expectEverySection();
    const quality = within(screen.getByTestId('destination-evidence-quality'));
    expect(quality.getByText('Visit recency (days)').parentElement).toHaveTextContent('0.06');
    expect(screen.getAllByText('A → B').length).toBeGreaterThan(0);
    const retry = failed
      ? screen.getByRole('button', { name: 'Retry' })
      : within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' });
    fireEvent.click(retry);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { caseId: 'successful snapshot timestamp', withTimestamp: true },
    { caseId: 'missing snapshot timestamp', withTimestamp: false },
  ])('uses the new vehicle analysis scope with $caseId', ({ withTimestamp }) => {
    h.history = { ...query({ data: readyHistory() }), dataUpdatedAt: FROZEN_NOW };
    const view = renderPage();
    const switchedAt = FROZEN_NOW + 2 * 86_400_000;
    vi.mocked(Date.now).mockReturnValue(switchedAt);
    h.vehicleId = 8;
    h.history = {
      ...query({
        data: [
          driveAt('2026-08-10T10:00:00.000Z', 'Fixture origin', 'Fixture destination', { vehicleId: 8 }),
        ],
      }),
      ...(withTimestamp ? { dataUpdatedAt: switchedAt } : {}),
    };
    view.rerenderPage();

    expectEverySection();
    expect(h.historyHook).toHaveBeenLastCalledWith('8', 1_000);
    const summary = within(screen.getByTestId('destination-transitions-kpis'));
    expect(summary.getByText('Included destination visits').closest('[data-operational-metric="visits"]')).toHaveTextContent('1');
    expect(summary.getByText('Latest observed destination').closest('[data-operational-metric="latest"]')).toHaveTextContent('Fixture destination');
    expect(screen.queryByText('A → B')).toBeNull();
    const quality = within(screen.getByTestId('destination-evidence-quality'));
    expect(quality.getByText('Visit recency (days)').parentElement).toHaveTextContent('0.06');
  });

  it.each([
    { caseId: 'nonfinite snapshot', updatedAt: Number.POSITIVE_INFINITY },
    { caseId: 'invalid snapshot', updatedAt: Number.NaN },
    { caseId: 'absent snapshot', updatedAt: 0 },
  ])('keeps deterministic fallback classification for $caseId', ({ updatedAt }) => {
    h.history = {
      ...query({
        data: [
          driveAt('2026-08-08T10:00:00.000Z', 'Fixture origin', 'Fixture destination'),
          driveAt('2026-08-09T10:00:00.000Z', 'Fixture destination', 'Future fixture'),
        ],
      }),
      dataUpdatedAt: updatedAt,
    };
    renderPage();

    expectEverySection();
    const quality = within(screen.getByTestId('destination-evidence-quality'));
    expect(quality.getByText('Future rows').parentElement).toHaveTextContent('1');
    const summary = within(screen.getByTestId('destination-transitions-kpis'));
    expect(summary.getByText('Included destination visits').closest('[data-operational-metric="visits"]')).toHaveTextContent('1');
    expect(summary.getByText('Latest observed destination').closest('[data-operational-metric="latest"]')).not.toHaveTextContent('Future fixture');
  });
});
