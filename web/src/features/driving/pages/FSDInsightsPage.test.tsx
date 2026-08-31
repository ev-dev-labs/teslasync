/**
 * FSDInsightsPage — orchestration, retained-data, and URL-state contracts.
 *
 * The page owns one query, one URL-backed period control, and six
 * independently mounted panels. These tests pin the parts a refactor could
 * silently break:
 *
 *   - every panel stays mounted in the complete, empty, loading, error, and
 *     no-vehicle states (no section is ever hidden);
 *   - a FAILED BACKGROUND REFRESH keeps the retained payload on screen and
 *     downgrades trust via `<StaleRefreshWarning>` rather than blanking the
 *     page — panels read `state.data`, the error surface reads
 *     `state.fatalError`;
 *   - `?days=` round-trips: a direct link initialises the period, and changing
 *     the period writes it back so Copy link carries it;
 *   - the browser's IANA timezone travels with the request, falling back to
 *     UTC when `Intl` is unavailable.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  pageTitleMock,
  sectionPropsMock,
  selectedVehicleMock,
  useFsdInsightsMock,
  browserTimezoneMock,
  staleWarningMock,
} = vi.hoisted(() => ({
  pageTitleMock: vi.fn(),
  sectionPropsMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  useFsdInsightsMock: vi.fn(),
  browserTimezoneMock: vi.fn(),
  staleWarningMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useFsdInsights: (...args: unknown[]) => useFsdInsightsMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/lib/timezone', () => ({
  browserTimezone: () => browserTimezoneMock(),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/feedback', () => ({
  StaleRefreshWarning: (props: { state: { status: string; hasData: boolean } }) => {
    staleWarningMock(props.state);
    if (!props.state.hasData || props.state.status === 'ok') return null;
    return <div data-testid="stale-warning">{props.state.status}</div>;
  },
}));

vi.mock('@/components/layout', () => ({
  PageContainer: ({
    title,
    subtitle,
    contextActions,
    children,
  }: {
    title: string;
    subtitle: string;
    contextActions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {contextActions}
      {children}
    </main>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../components/fsd-insights', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const actualHelpers = await vi.importActual<typeof import('../components/fsd-insights/helpers')>(
    '../components/fsd-insights/helpers',
  );
  type State = { isLoading: boolean; error: unknown; noVehicle: boolean; onRetry: () => void };
  type Insights = { totals?: { fsd_distance_m: number | null } } | undefined;

  const section = (testId: string, insights: Insights, state: State) => {
    sectionPropsMock(testId, { insights, state });
    const status = state.noVehicle
      ? 'no-vehicle'
      : state.error
        ? 'error'
        : state.isLoading
          ? 'loading'
          : insights?.totals?.fsd_distance_m != null
            ? `ready:${insights.totals.fsd_distance_m}`
            : 'empty';
    return React.createElement('section', { 'data-testid': testId }, status);
  };

  const passthrough =
    (testId: string) =>
    (props: { insights: Insights; state: State }) =>
      section(testId, props.insights, props.state);

  return {
    coercePeriodDays: actualHelpers.coercePeriodDays,
    FsdKpiBand: passthrough('fsd-kpis'),
    FsdDistanceTrend: passthrough('fsd-distance-trend'),
    FsdShareTrend: passthrough('fsd-share-trend'),
    FsdWeekdayPattern: passthrough('fsd-weekday-pattern'),
    FsdTopDays: passthrough('fsd-top-days'),
    FsdDriveAnalyticsPanels: passthrough('fsd-drive-analytics'),
    FsdConfidencePanel: passthrough('fsd-confidence'),
    FsdPeriodControl: ({
      value,
      onChange,
      disabled,
    }: {
      value: number;
      onChange: (days: number) => void;
      disabled?: boolean;
    }) => (
      <div data-testid="fsd-period-control" data-value={String(value)} data-disabled={String(!!disabled)}>
        {[7, 30, 90, 365].map((days) => (
          <button key={days} type="button" onClick={() => onChange(days)}>
            {`${days}d`}
          </button>
        ))}
      </div>
    ),
  };
});

import FSDInsightsPage from './FSDInsightsPage';

const SECTION_IDS = [
  'fsd-kpis',
  'fsd-distance-trend',
  'fsd-share-trend',
  'fsd-weekday-pattern',
  'fsd-top-days',
  'fsd-drive-analytics',
  'fsd-confidence',
] as const;

/** Surfaces the live URL so the URL-state assertions read the real thing. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(initialEntry = '/fsd') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/fsd" element={<FSDInsightsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isError: false,
    isPending: true,
    isFetching: false,
    fetchStatus: 'idle' as const,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
    isStale: false,
    ...overrides,
  };
}

const POPULATED = { totals: { fsd_distance_m: 16_093.44 } };

function loaded(overrides: Record<string, unknown> = {}) {
  return query({
    data: POPULATED,
    isPending: false,
    dataUpdatedAt: 1_772_000_000_000,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  browserTimezoneMock.mockReturnValue('America/Los_Angeles');
  useFsdInsightsMock.mockReturnValue(loaded());
});

describe('FSDInsightsPage', () => {
  it('mounts every panel and requests the default 30-day local window', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'FSD Insights' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Reported supervised self-driving distance and its share of observed driving/,
      ),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready:16093.44');
    }
    expect(useFsdInsightsMock).toHaveBeenCalledWith('42', 30, 'America/Los_Angeles');
    expect(pageTitleMock).toHaveBeenCalledWith('FSD Insights');
  });

  it('falls back to UTC when the browser cannot resolve a timezone', () => {
    browserTimezoneMock.mockReturnValue('UTC');
    renderPage();
    expect(useFsdInsightsMock).toHaveBeenCalledWith('42', 30, 'UTC');
  });

  // ── URL state ───────────────────────────────────────────────────────────

  it('initialises the period from ?days= on a direct link', () => {
    renderPage('/fsd?days=90');

    expect(useFsdInsightsMock).toHaveBeenCalledWith('42', 90, 'America/Los_Angeles');
    expect(screen.getByTestId('fsd-period-control')).toHaveAttribute('data-value', '90');
  });

  it('falls back to the default for an unsupported ?days= value', () => {
    renderPage('/fsd?days=45');
    expect(useFsdInsightsMock).toHaveBeenCalledWith('42', 30, 'America/Los_Angeles');

    useFsdInsightsMock.mockClear();
    renderPage('/fsd?days=not-a-number');
    expect(useFsdInsightsMock).toHaveBeenCalledWith('42', 30, 'America/Los_Angeles');
  });

  it.each([7, 30, 90, 365])('writes ?days=%s to the URL so Copy link preserves it', async (days) => {
    renderPage('/fsd?days=7');
    fireEvent.click(screen.getByRole('button', { name: `${days}d` }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/fsd?days=${days}`),
    );
    await waitFor(() =>
      expect(useFsdInsightsMock).toHaveBeenLastCalledWith('42', days, 'America/Los_Angeles'),
    );
  });

  it('preserves unrelated query params when the period changes', async () => {
    renderPage('/fsd?vehicle_id=42&days=7');
    fireEvent.click(screen.getByRole('button', { name: '365d' }));

    await waitFor(() => {
      const url = screen.getByTestId('location').textContent ?? '';
      const params = new URLSearchParams(url.split('?')[1]);
      expect(params.get('days')).toBe('365');
      expect(params.get('vehicle_id')).toBe('42');
    });
  });

  // ── retained data ───────────────────────────────────────────────────────

  it('keeps retained panels populated when a background refresh fails', () => {
    // Data is retained AND the query is in error: this is the case that used
    // to blank the page.
    useFsdInsightsMock.mockReturnValue(
      loaded({ isError: true, error: new Error('refresh failed') }),
    );
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready:16093.44');
    }
    expect(screen.getByTestId('stale-warning')).toHaveTextContent('stale');

    // No panel may be handed a fatal error while data is retained.
    const errors = sectionPropsMock.mock.calls.map(
      ([, probe]: [string, { state: { error: unknown } }]) => probe.state.error,
    );
    expect(errors.every((error) => error == null)).toBe(true);
  });

  it('keeps retained panels populated while a refetch is in flight', () => {
    useFsdInsightsMock.mockReturnValue(loaded({ isFetching: true, fetchStatus: 'fetching' }));
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready:16093.44');
    }
    expect(screen.queryByTestId('stale-warning')).not.toBeInTheDocument();
  });

  it('shows the blocking error only when the FIRST load failed with nothing retained', () => {
    useFsdInsightsMock.mockReturnValue(
      query({ isError: true, isPending: false, error: new Error('fsd unavailable') }),
    );
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('error');
    }
    expect(screen.queryByTestId('stale-warning')).not.toBeInTheDocument();
  });

  it('shows the skeleton only on the initial load', () => {
    useFsdInsightsMock.mockReturnValue(query({ isPending: true }));
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }
  });

  it('keeps every panel mounted when the period reported no measurable distance', () => {
    useFsdInsightsMock.mockReturnValue(loaded({ data: { totals: { fsd_distance_m: null } } }));
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('empty');
    }
  });

  it('keeps every panel mounted and disables the period control with no vehicle', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('no-vehicle');
    }
    expect(screen.getByTestId('fsd-period-control')).toHaveAttribute('data-disabled', 'true');
    expect(useFsdInsightsMock).toHaveBeenCalledWith(undefined, 30, 'America/Los_Angeles');
  });

  it('shares one retry callback across every panel', () => {
    const refetch = vi.fn();
    useFsdInsightsMock.mockReturnValue(
      query({ isError: true, isPending: false, error: new Error('offline'), refetch }),
    );
    renderPage();

    const retries = sectionPropsMock.mock.calls.map(
      ([, probe]: [string, { state: { onRetry: () => void } }]) => probe.state.onRetry,
    );
    expect(new Set(retries).size).toBe(1);
    retries[0]?.();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('classifies the retained payload as historical provenance', () => {
    renderPage();
    const state = staleWarningMock.mock.calls.at(-1)?.[0] as { provenance: string; status: string };
    expect(state.provenance).toBe('historical');
    expect(state.status).toBe('ok');
  });
});
