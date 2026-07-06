/**
 * TripDetailPage — orchestration behaviour + hardening coverage.
 *
 * The page is a thin orchestrator: it reads the `:id` route param, fans the
 * single `useTrip` query out to five presentational sections, computes a
 * human `tripLabel`, keeps the browser-tab title in sync, and wires one
 * shared `onRetry` back to the query's `refetch`. Those responsibilities are
 * exactly what this suite pins down.
 *
 * Strategy: the five child sections (AI suggestion + KPI band + drives chart +
 * overview panel + drives table) are each replaced with an inert,
 * prop-capturing stub. That keeps the test focused on the page's own contract
 * (which props flow where, and in what state) instead of re-testing recharts,
 * DataTable, or the AI stream — each of which owns its own suite. Network is
 * never touched: `useTrip` is a controllable mock and the route param is
 * injected via a `useParams` stub.
 *
 * Covered facets:
 *   - READY (named): shell + subtitle + freshness chip + every section mounts,
 *     the same trip object reaches each data section, tab title = trip name.
 *   - READY (unnamed): subtitle AND tab title both fall back to "Trip #<id>"
 *     (the fixed inconsistency — the tab used to stay the generic title).
 *   - LOADING: no subtitle, generic tab title, loading flag propagated.
 *   - ERROR: the error object reaches each section and every Retry calls the
 *     shared refetch (user interaction).
 *   - EDGE (missing id): no non-null-assertion blow-up; hook gets '' and the
 *     AI section receives `undefined`.
 *   - PERF: one stable `onRetry` reference is shared by all three data sections
 *     (the useCallback hardening).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { TripDetail } from '@/api/types';
import { __resetTitleStoreForTests } from '@/lib/titleStore';

// ── Child-section prop shapes (mirror the real component contracts) ──────────
type KpiProps = { trip: TripDetail | undefined; isLoading: boolean };
type BandProps = {
  trip: TripDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
};
type AiProps = { tripId?: string };

// ── Hoisted, per-test controllable state + child-prop capture ────────────────
const h = vi.hoisted(() => ({
  id: '5' as string | undefined,
  useTrip: vi.fn(),
}));

const caps = vi.hoisted(() => ({
  kpi: null as KpiProps | null,
  chart: null as BandProps | null,
  overview: null as BandProps | null,
  table: null as BandProps | null,
  ai: null as AiProps | null,
}));

// Deterministic i18n: echo the English default and interpolate {{placeholder}}.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Route param is injected directly so we control the id (incl. `undefined`)
// without threading a matching <Route> element.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: h.id }) };
});

// The single data source. Returns a fully-shaped query stub set per test.
vi.mock('@/api/hooks/useTrips', () => ({
  useTrip: h.useTrip,
}));

// ── Prop-capturing child stubs ──────────────────────────────────────────────
vi.mock('@/components/ai/AIAutoTripNameSuggestion', () => ({
  AIAutoTripNameSuggestion: (props: AiProps) => {
    caps.ai = props;
    return <div data-testid="ai-suggest" data-tripid={props.tripId ?? ''} />;
  },
}));

vi.mock('@/features/trips/components/TripKpiBand', () => ({
  TripKpiBand: (props: KpiProps) => {
    caps.kpi = props;
    return (
      <div
        data-testid="kpi-band"
        data-loading={String(props.isLoading)}
        data-hastrip={String(!!props.trip)}
      />
    );
  },
}));

vi.mock('@/features/trips/components/TripDrivesChart', () => ({
  TripDrivesChart: (props: BandProps) => {
    caps.chart = props;
    return (
      <div data-testid="drives-chart" data-error={String(props.isError)} data-loading={String(props.isLoading)}>
        <button type="button" onClick={() => props.onRetry()}>retry-chart</button>
      </div>
    );
  },
}));

vi.mock('@/features/trips/components/TripOverviewPanel', () => ({
  TripOverviewPanel: (props: BandProps) => {
    caps.overview = props;
    return (
      <div data-testid="overview-panel" data-error={String(props.isError)}>
        <button type="button" onClick={() => props.onRetry()}>retry-overview</button>
      </div>
    );
  },
}));

vi.mock('@/features/trips/components/TripDrivesTable', () => ({
  TripDrivesTable: (props: BandProps) => {
    caps.table = props;
    return (
      <div data-testid="drives-table" data-error={String(props.isError)}>
        <button type="button" onClick={() => props.onRetry()}>retry-table</button>
      </div>
    );
  },
}));

import TripDetailPage from './TripDetailPage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn +
// DataFreshness). Provide a no-preference stub.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const refetchSpy = vi.fn();

interface QueryStub {
  data: TripDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: refetchSpy,
    ...overrides,
  };
}

function makeTrip(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    id: 5,
    vehicle_id: 3,
    name: 'Weekend Getaway',
    start_date: '2024-01-10T08:00:00Z',
    end_date: '2024-01-12T20:00:00Z',
    started_at: '2024-01-10T08:00:00Z',
    ended_at: '2024-01-12T20:00:00Z',
    total_distance_m: 320_000,
    total_energy_wh: 64_000,
    total_duration_s: 14_400,
    total_cost: 12.5,
    drive_count: 3,
    charge_count: 1,
    created_at: '2024-01-10T07:00:00Z',
    energy_used_wh: 64_000,
    drives: [],
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/trips/${h.id ?? ''}`]}>
        <TripDetailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetTitleStoreForTests();
  h.id = '5';
  caps.kpi = null;
  caps.chart = null;
  caps.overview = null;
  caps.table = null;
  caps.ai = null;
  h.useTrip.mockReturnValue(makeQuery({ data: makeTrip() }));
});

afterEach(() => {
  cleanup();
});

describe('TripDetailPage', () => {
  it('renders the shell and distributes a ready (named) trip to every section', () => {
    h.id = '5';
    h.useTrip.mockReturnValue(makeQuery({ data: makeTrip({ id: 5, name: 'Weekend Getaway' }) }));

    renderPage();

    // Shell: <h1> page title + subtitle = the trip's name.
    expect(screen.getByRole('heading', { level: 1, name: 'Trip Detail' })).toBeInTheDocument();
    expect(screen.getByText('Weekend Getaway')).toBeInTheDocument();

    // The hook was queried with the route param.
    expect(h.useTrip).toHaveBeenCalledWith('5');

    // Passing `query` lights up the header freshness chip — a Refresh control
    // wired to the query's refetch (proves the `query={tripQuery}` wiring).
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();

    // Every section mounted; the AI section received the trip id.
    expect(screen.getByTestId('ai-suggest')).toHaveAttribute('data-tripid', '5');
    expect(screen.getByTestId('kpi-band')).toBeInTheDocument();
    expect(screen.getByTestId('drives-chart')).toBeInTheDocument();
    expect(screen.getByTestId('overview-panel')).toBeInTheDocument();
    expect(screen.getByTestId('drives-table')).toBeInTheDocument();

    // Prop contract: the identical trip object flows to each data section.
    expect(caps.kpi?.trip?.id).toBe(5);
    expect(caps.chart?.trip?.name).toBe('Weekend Getaway');
    expect(caps.overview?.trip?.id).toBe(5);
    expect(caps.table?.trip?.id).toBe(5);

    // Tab title reflects the trip name.
    expect(document.title).toBe('Weekend Getaway — TeslaSync');
  });

  it('falls back to "Trip #<id>" for an unnamed loaded trip in both the subtitle and tab title', () => {
    h.id = '7';
    h.useTrip.mockReturnValue(makeQuery({ data: makeTrip({ id: 7, name: null }) }));

    renderPage();

    // Subtitle uses the interpolated fallback label.
    expect(screen.getByText('Trip #7')).toBeInTheDocument();

    // Regression guard: the tab title previously stayed the generic
    // "Trip Detail — TeslaSync" for a nameless trip; it now matches the label
    // so multiple open trip tabs remain distinguishable.
    expect(document.title).toBe('Trip #7 — TeslaSync');
  });

  it('shows no subtitle and a generic tab title while loading, and marks every section loading', () => {
    h.id = '9';
    h.useTrip.mockReturnValue(
      makeQuery({ data: undefined, isLoading: true, isFetching: true, dataUpdatedAt: 0 }),
    );

    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Trip Detail' })).toBeInTheDocument();
    // No trip → the subtitle is suppressed (never a stray "Trip #9").
    expect(screen.queryByText('Trip #9')).not.toBeInTheDocument();
    expect(document.title).toBe('Trip Detail — TeslaSync');

    // Loading flag + an absent trip reach the sections.
    expect(caps.kpi?.isLoading).toBe(true);
    expect(caps.kpi?.trip).toBeUndefined();
    expect(caps.chart?.isLoading).toBe(true);
    expect(caps.chart?.trip).toBeUndefined();
  });

  it('propagates the error to each data section and wires every Retry back to refetch', () => {
    const boom = new Error('boom');
    h.useTrip.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: boom, dataUpdatedAt: 0 }),
    );

    renderPage();

    // The error object flows through to all three retry-capable sections.
    expect(caps.chart?.isError).toBe(true);
    expect(caps.chart?.error).toBe(boom);
    expect(caps.overview?.error).toBe(boom);
    expect(caps.table?.error).toBe(boom);

    // Each section exposes exactly one Retry; clicking all three drives the
    // single shared refetch three times.
    const retries = screen.getAllByRole('button', { name: /^retry-/ });
    expect(retries).toHaveLength(3);
    retries.forEach((b) => fireEvent.click(b));
    expect(refetchSpy).toHaveBeenCalledTimes(3);
  });

  it('handles a missing route id without a non-null-assertion blow-up', () => {
    h.id = undefined;
    h.useTrip.mockReturnValue(makeQuery({ data: undefined }));

    renderPage();

    // Honest empty-string arg (the old `id!` asserted a lie to the type system).
    expect(h.useTrip).toHaveBeenCalledWith('');
    // Shell + sections still render.
    expect(screen.getByRole('heading', { level: 1, name: 'Trip Detail' })).toBeInTheDocument();
    expect(screen.getByTestId('kpi-band')).toBeInTheDocument();
    // AI section receives `undefined` (no trip selected) and stays inert.
    expect(caps.ai?.tripId).toBeUndefined();
    expect(document.title).toBe('Trip Detail — TeslaSync');
  });

  it('shares one stable onRetry reference across all three data sections (useCallback hardening)', () => {
    h.useTrip.mockReturnValue(makeQuery({ data: makeTrip() }));

    renderPage();

    expect(typeof caps.chart?.onRetry).toBe('function');
    expect(caps.chart?.onRetry).toBe(caps.overview?.onRetry);
    expect(caps.overview?.onRetry).toBe(caps.table?.onRetry);
  });
});
