import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '@/components/feedback';
import type { UnitPref } from '@/lib/unitConversion';
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

// FadeIn starts at opacity 0 until its animation runs; visibility assertions need the settled layout.
vi.mock('@/components/motion', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
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
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'min',
      power: 'kW',
      locale: 'en-US',
      precision: 1,
    } satisfies UnitPref,
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
  dataUpdatedAt?: number;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
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
    isPending: overrides.isPending ?? isLoading,
    isFetching: overrides.isFetching ?? isLoading,
    fetchStatus: overrides.fetchStatus ?? (isLoading ? 'fetching' : 'idle'),
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
  it.each(['failed', 'blocked'] as const)(
    'propagates %s refresh trust without changing retained quality or window quantities',
    (refresh) => {
      const data = readyHistory();
      h.history = query({ data });
      const view = renderPage();
      const briefs = () => [
        screen.getByTestId('arrival-kpis'),
        screen.getByTestId('arrival-window-comparisons'),
        screen.getByTestId('arrival-row-accounting-brief'),
        screen.getByTestId('arrival-coverage-recurrence-brief'),
        screen.getByTestId('arrival-support-ingredients-brief'),
      ];
      const quantities = () => briefs().map(brief =>
        Array.from(brief.querySelectorAll('[data-operational-value]'), node => node.textContent),
      );
      const original = quantities();
      expect(original.map(values => values.length)).toEqual([6, 8, 9, 17, 6]);

      h.history = query({
        data,
        ...(refresh === 'failed'
          ? { isError: true, error: new Error('refresh unavailable') }
          : { fetchStatus: 'paused' as const }),
      });
      view.rerenderPage();
      expectEverySection();
      expect(quantities()).toEqual(original);
      assertOperationalBriefDisclosure(briefs()[0]!,
        refresh === 'failed' ? 'Retained source' : 'Refresh paused');
      for (const brief of briefs().slice(1)) {
        const cards = brief.matches('[data-operational-brief]')
          ? [brief]
          : Array.from(brief.querySelectorAll('[data-operational-brief]'));
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) {
          assertOperationalBriefDisclosure(card, 'Retained source');
        }
        expect(within(brief).queryByText('Returned evidence')).toBeNull();
      }
      const warning = refresh === 'failed'
        ? screen.getByRole('alert')
        : screen.getByTestId('stale-refresh-warning');
      expect(screen.getAllByRole('button', {
        name: refresh === 'failed' ? 'Retry' : 'Refresh',
      })).toHaveLength(1);
      fireEvent.click(within(warning).getByRole('button', {
        name: refresh === 'failed' ? 'Retry' : 'Refresh',
      }));
      expect(historyRefetch).toHaveBeenCalledTimes(1);

      if (refresh === 'failed') {
        h.history = query({
          data,
          isError: true,
          error: new Error('refresh unavailable'),
          isFetching: true,
          fetchStatus: 'fetching',
        });
        view.rerenderPage();
        expect(quantities()).toEqual(original);
        for (const brief of briefs().slice(1)) {
          const cards = brief.matches('[data-operational-brief]')
            ? [brief]
            : Array.from(brief.querySelectorAll('[data-operational-brief]'));
          expect(cards.length).toBeGreaterThan(0);
          for (const card of cards) {
            assertOperationalBriefDisclosure(card, 'Retained source');
          }
        }
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
      }

      h.history = query({ data, dataUpdatedAt: FROZEN_NOW });
      view.rerenderPage();
      expectEverySection();
      expect(quantities()).toEqual(original);
      expect(screen.queryByText('Retained source')).toBeNull();
      expect(screen.queryByText('Retained source')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
      for (const brief of briefs().slice(1)) {
        const cards = brief.matches('[data-operational-brief]')
          ? [brief]
          : Array.from(brief.querySelectorAll('[data-operational-brief]'));
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) {
          assertOperationalBriefDisclosure(card, 'Returned evidence');
        }
      }
    },
  );

  it('retains every row, coverage and support operand in the three real evidence briefs', () => {
    renderPage();
    const accounting = screen.getByTestId('arrival-row-accounting-brief');
    const coverage = screen.getByTestId('arrival-coverage-recurrence-brief');
    const support = screen.getByTestId('arrival-support-ingredients-brief');
    expect(accounting.querySelectorAll('[data-operational-value]')).toHaveLength(9);
    expect(coverage.querySelectorAll('[data-operational-value]')).toHaveLength(17);
    expect(support.querySelectorAll('[data-operational-value]')).toHaveLength(6);
    expect(accounting).toHaveTextContent('Rows returned');
    expect(coverage).toHaveTextContent('First parseable returned start');
    assertOperationalBriefDisclosure(coverage, 'source timestamps and denominators are shown separately', { contains: true });
    assertOperationalBriefDisclosure(support, 'Support indices are not confidence scores', { contains: true });
    expectEverySection();
  });

  it('keeps all timing evidence while a cached history refresh is paused and recovers', () => {
    const data = readyHistory();
    h.history = query({ data, fetchStatus: 'paused' });
    const view = renderPage();
    expectEverySection();
    const notice = screen.getByTestId('stale-refresh-warning');
    expect(notice).toHaveAttribute('data-refresh-blocked', 'true');
    expect(notice).toHaveTextContent('Previously loaded data remains visible.');
    expect(notice).not.toHaveTextContent(/offline/i);
    assertOperationalBriefDisclosure(screen.getByTestId('arrival-kpis'), 'Refresh paused');
    expect(screen.queryByLabelText('Loading arrival timing history')).toBeNull();
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(historyRefetch).toHaveBeenCalledTimes(1);

    h.history = query({ data, fetchStatus: 'fetching', isFetching: true });
    view.rerenderPage();
    expectEverySection();
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    assertOperationalBriefDisclosure(screen.getByTestId('arrival-kpis'), 'updating…');
    expect(screen.getAllByText('Home → Office').length).toBeGreaterThan(0);

    h.history = query({ data });
    view.rerenderPage();
    expectEverySection();
    expect(screen.queryByText('Refresh paused')).toBeNull();
    expect(screen.queryByText('updating…')).toBeNull();
    assertOperationalBriefDisclosure(screen.getByTestId('arrival-kpis'), 'Returned evidence');
  });

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

  it('advances recency for new history without replacing drive observation timestamps', () => {
    const view = renderPage();
    const quality = within(screen.getByTestId('arrival-evidence-quality'));
    expect(quality.getByText('Recency (days)').closest('[data-operational-metric]')).toHaveTextContent(
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
        .closest('[data-operational-metric]'),
    ).toHaveTextContent('11.0');
  });

  it.each(['history snapshot', 'vehicle'] as const)(
    'includes newly completed drives after a new %s while excluding true future records',
    (change) => {
      const initialData = readyHistory();
      h.history = query({ data: initialData, dataUpdatedAt: FROZEN_NOW });
      const view = renderPage();
      const advancedNow = FROZEN_NOW + 10 * 86_400_000;
      vi.mocked(Date.now).mockReturnValue(advancedNow);
      if (change === 'vehicle') h.vehicleId = 8;
      h.history = query({
        data: [
          ...initialData,
          driveAt('2026-08-17T12:00:00.000Z'),
          driveAt('2026-08-19T12:00:00.000Z'),
          driveAt('2026-08-18T11:45:00.000Z'),
        ],
        dataUpdatedAt: advancedNow,
      });
      view.rerenderPage();

      const quality = within(screen.getByTestId('arrival-evidence-quality'));
      expect(
        quality.getByText('Included drives').closest('[data-operational-metric]'),
      ).toHaveTextContent('7');
      expect(
        quality.getByText('Future rows').closest('[data-operational-metric]'),
      ).toHaveTextContent('2');
      expect(
        quality.getByText('Recency (days)').closest('[data-operational-metric]'),
      ).toHaveTextContent('1.0');
      expectEverySection();
    },
  );

  it('advances for an accepted identical snapshot but not for a failed refresh or timezone change', () => {
    const data = readyHistory();
    h.history = query({ data, dataUpdatedAt: FROZEN_NOW });
    const view = renderPage();
    const acceptedAt = FROZEN_NOW + 10 * 86_400_000;
    vi.mocked(Date.now).mockReturnValue(acceptedAt);
    h.history = query({ data, dataUpdatedAt: acceptedAt });
    view.rerenderPage();
    const recency = () =>
      within(screen.getByTestId('arrival-evidence-quality'))
        .getByText('Recency (days)')
        .closest('[data-operational-metric]');
    expect(recency()).toHaveTextContent('11.0');

    vi.mocked(Date.now).mockReturnValue(acceptedAt + 5 * 86_400_000);
    h.history = query({
      data,
      dataUpdatedAt: acceptedAt,
      isError: true,
      error: new Error('refresh unavailable'),
    });
    h.timeZone = 'America/Los_Angeles';
    view.rerenderPage();
    expect(recency()).toHaveTextContent('11.0');
    expectEverySection();
  });

  it('advances for a vehicle change even when the history reference is unchanged', () => {
    const view = renderPage();
    vi.mocked(Date.now).mockReturnValue(FROZEN_NOW + 10 * 86_400_000);
    h.vehicleId = 8;
    view.rerenderPage();
    expect(h.historyHook).toHaveBeenLastCalledWith('8', 1_000);
    expect(
      within(screen.getByTestId('arrival-evidence-quality'))
        .getByText('Recency (days)')
        .closest('[data-operational-metric]'),
    ).toHaveTextContent('11.0');
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
    fireEvent.click(within(screen.getByTestId('arrival-kpis')).getByRole('button', { name: 'Review details' }));
    const loadingDrawer = screen.getByRole('dialog');
    expect(within(loadingDrawer).getAllByText('Waiting for returned drive history…')).toHaveLength(6);
    fireEvent.keyDown(loadingDrawer, { key: 'Escape' });
    expect(screen.queryByText('0 rows returned')).toBeNull();
    expect(screen.queryByText('Below the 1,000-row cap')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByTestId('arrival-row-accounting-brief')).toBeNull();
    expect(screen.queryByText('Retained source')).toBeNull();
  });

  it('keeps paused initial evidence unknown and resumes through active loading to successful zero', () => {
    h.history = query({
      isPending: true,
      isSuccess: false,
      fetchStatus: 'paused',
    });
    const view = renderPage();
    expectEverySection();
    expect(screen.getAllByText('Arrival Reliability loading is paused. No data has been loaded yet.').length).toBeGreaterThan(6);
    expect(screen.queryByLabelText('Loading arrival timing history')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/offline|Can't reach server/i)).toBeNull();
    expect(screen.queryByText('0 rows returned')).toBeNull();
    expect(screen.queryByText('Below the 1,000-row cap')).toBeNull();
    expect(screen.queryByTestId('arrival-row-accounting-brief')).toBeNull();
    expect(screen.queryByText('Retained source')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveAttribute('type', 'button');
    expect(retry).toBeEnabled();
    expect(retry).not.toHaveAttribute('aria-busy');
    expect(retry).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0', 'h-auto', 'whitespace-normal');
    expect(within(retry).getByText('Retry')).toHaveClass('min-w-0', 'break-words');
    retry.focus();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(retry).toHaveFocus();
    expect(historyRefetch).toHaveBeenCalledTimes(1);

    h.history = query({ isLoading: true });
    view.rerenderPage();
    expectEverySection();
    expect(screen.getAllByRole('status', { name: 'Loading arrival timing history' })).toHaveLength(1);
    expect(screen.queryByText('Source paused')).toBeNull();

    h.history = query({ data: [] });
    view.rerenderPage();
    expectEverySection();
    expect(screen.getByText('No drives were returned, so no route timing claim is made.')).toBeInTheDocument();
    expect(within(screen.getByTestId('arrival-kpis')).getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    const accounting = screen.getByTestId('arrival-row-accounting-brief');
    assertOperationalBriefDisclosure(accounting, 'Returned evidence');
    expect(within(accounting).getByText('Rows returned').closest('[data-operational-metric]'))
      .toHaveTextContent('0');
    expect(screen.queryByText('Retained source')).toBeNull();
  });

  it('does not describe an idle unresolved query as actively loading', () => {
    h.history = query({ isPending: true, isSuccess: false });
    renderPage();
    expectEverySection();
    expect(screen.queryByLabelText('Loading arrival timing history')).toBeNull();
    const idleKpis = screen.getByTestId('arrival-kpis');
    expect(within(idleKpis).queryByText('Drive-history availability has not resolved.')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(idleKpis, 'Awaiting evidence');
    for (const label of ['Supported routes', 'Included drives', 'Repeated-route coverage',
      'Timing consistency index', 'Observed within-allowance share', 'Observed p90 buffer']) {
      assertOperationalMetricUnavailable(idleKpis, label);
    }
    expect(screen.queryByText('0 rows returned')).toBeNull();
  });

  it('retains refresh failures during retry and clears their status after successful recovery', () => {
    const data = readyHistory();
    const error = new Error('refresh unavailable');
    h.history = query({ data, isError: true, error });
    const view = renderPage();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveAttribute('type', 'button');
    expect(retry).toBeEnabled();
    expect(retry).not.toHaveAttribute('aria-busy');
    expect(retry).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0', 'h-auto', 'whitespace-normal');
    expect(within(retry).getByText('Retry')).toHaveClass('min-w-0', 'break-words');
    retry.focus();
    fireEvent.click(retry);
    expect(retry).toHaveFocus();
    expect(historyRefetch).toHaveBeenCalledTimes(1);

    h.history = query({ data, isError: true, error, isFetching: true, fetchStatus: 'fetching' });
    view.rerenderPage();
    expectEverySection();
    expect(screen.getAllByText('Home → Office').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Updating…' })).toBe(retry);
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0');
    expect(within(retry).getByText('Updating…')).toHaveClass('min-w-0', 'break-words');
    fireEvent.click(retry);
    expect(historyRefetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Loading arrival timing history')).toBeNull();

    h.history = query({ data, dataUpdatedAt: FROZEN_NOW });
    view.rerenderPage();
    expectEverySection();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    assertOperationalBriefDisclosure(screen.getByTestId('arrival-kpis'), 'Returned evidence');
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
    const errorKpis = screen.getByTestId('arrival-kpis');
    expect(within(errorKpis).queryByText('Drive history is unavailable; use the status below to retry.')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(errorKpis, 'Source unavailable');
    for (const label of ['Supported routes', 'Included drives', 'Repeated-route coverage',
      'Timing consistency index', 'Observed within-allowance share', 'Observed p90 buffer']) {
      assertOperationalMetricUnavailable(errorKpis, label);
    }
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
    const noVehicleKpis = screen.getByTestId('arrival-kpis');
    expect(within(noVehicleKpis).queryByText('Select a vehicle above to load timing evidence.')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(noVehicleKpis, 'Select a vehicle');
    for (const label of ['Supported routes', 'Included drives', 'Repeated-route coverage',
      'Timing consistency index', 'Observed within-allowance share', 'Observed p90 buffer']) {
      assertOperationalMetricUnavailable(noVehicleKpis, label);
    }
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
      screen.queryAllByText(/America\/Los_Angeles/).length,
    ).toBe(0);
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
      within(screen.getByTestId('arrival-window-comparisons')).getByText(
        'Only supported route-window',
        { selector: 'article > p' },
      ),
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
      expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
    }
  });
});
