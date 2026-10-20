/**
 * FSDInsightsPage — orchestration, retained-data, and URL-state contracts.
 *
 * The page owns one query, the header's shared URL-backed range, and independently
 * mounted panels. These tests pin the parts a refactor could
 * silently break:
 *
 *   - every panel stays mounted in the complete, empty, loading, error, and
 *     no-vehicle states (no section is ever hidden);
 *   - a FAILED BACKGROUND REFRESH keeps the retained payload on screen and
 *     downgrades trust via `<StaleRefreshWarning>` rather than blanking the
 *     page — panels read `state.data`, the error surface reads
 *     `state.fatalError`;
 *   - shared `from`/`to` links and header preset changes scope the FSD query;
 *   - the workspace range's IANA timezone travels with the request.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRangeState } from '@/hooks/useRangeState';
import { calendarRangeToInstants } from '@/lib/dateRange';

const {
  pageTitleMock,
  sectionPropsMock,
  selectedVehicleMock,
  useFsdInsightsMock,
  staleWarningMock,
  motionPreferenceMock,
  sectionFailureMock,
} = vi.hoisted(() => ({
  pageTitleMock: vi.fn(),
  sectionPropsMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  useFsdInsightsMock: vi.fn(),
  staleWarningMock: vi.fn(),
  motionPreferenceMock: vi.fn(),
  sectionFailureMock: vi.fn(),
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
  useFsdInsightsRange: (...args: unknown[]) => useFsdInsightsMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => motionPreferenceMock(),
}));

vi.mock('@/lib/errorReporter', () => ({
  reportFrontendError: vi.fn(),
}));

vi.mock('@/components/feedback', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/feedback')>(),
  SectionErrorBoundary: (await import('@/components/feedback/SectionErrorBoundary')).SectionErrorBoundary,
  StaleRefreshWarning: (props: import('@/components/feedback').StaleRefreshWarningProps) => {
    staleWarningMock(props.state);
    if (!props.state.hasData || props.state.status === 'ok') return null;
    return <div data-testid="stale-warning">
      {props.state.status}
      <ActualStaleRefreshWarning {...props} />
    </div>;
  },
}));

vi.mock('@/components/layout', () => ({
  PageLayout: ({
    title,
    subtitle,
    contextActions,
    busy,
    children,
  }: {
    title: string;
    subtitle: string;
    contextActions: ReactNode;
    busy?: boolean;
    children: ReactNode;
  }) => (
    <main aria-busy={busy}>
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
  type State = { isLoading: boolean; error: unknown; noVehicle: boolean; onRetry: () => void };
  type Insights = { totals?: { fsd_distance_m: number | null } } | undefined;

  const section = (testId: string, insights: Insights, state: State) => {
    sectionFailureMock(testId);
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
    FsdKpiBand: passthrough('fsd-kpis'),
    FsdObservatoryPanel: passthrough('fsd-observatory'),
    FsdDistanceTrend: passthrough('fsd-distance-trend'),
    FsdShareTrend: passthrough('fsd-share-trend'),
    FsdWeekdayPattern: passthrough('fsd-weekday-pattern'),
    FsdTopDays: passthrough('fsd-top-days'),
    FsdDriveAnalyticsPanels: passthrough('fsd-drive-analytics'),
    FsdConfidencePanel: passthrough('fsd-confidence'),
  };
});

vi.mock('../components/operationalbrief-a-m/FsdEvidenceBrief', async () => ({
  FsdEvidenceBrief: (await import('../components/fsd-insights')).FsdKpiBand,
}));

import FSDInsightsPage from './FSDInsightsPage';
import { StaleRefreshWarning as ActualStaleRefreshWarning } from '@/components/feedback/StaleRefreshWarning';

const SECTION_IDS = [
  'fsd-kpis',
  'fsd-observatory',
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

function HeaderRangeProbe() {
  const { setPreset } = useRangeState({ defaultPresetId: '7d' });
  return <button type="button" onClick={() => setPreset('90d')}>Change header range</button>;
}

function PageHarness({ initialEntry = '/fsd' }: { initialEntry?: string }) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <HeaderRangeProbe />
      <Routes>
        <Route path="/fsd" element={<FSDInsightsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(initialEntry = '/fsd') {
  return render(<PageHarness initialEntry={initialEntry} />);
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

beforeEach(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } });
  vi.clearAllMocks();
  sectionFailureMock.mockReset();
  window.localStorage.clear();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useFsdInsightsMock.mockReturnValue(loaded());
  motionPreferenceMock.mockReturnValue({ reduce: false });
});

describe('FSDInsightsPage', () => {
  it.each([true, false])('preserves hash-target navigation with reduced motion=%s', (reduce) => {
    motionPreferenceMock.mockReturnValue({ reduce });
    const scrollIntoView = vi.fn();
    const getElement = vi.spyOn(document, 'getElementById');
    const target = document.createElement('section');
    target.scrollIntoView = scrollIntoView;
    getElement.mockReturnValue(target);
    const previousHash = window.location.hash;
    window.location.hash = '#fsd-observatory';
    try {
      renderPage();
      expect(getElement).toHaveBeenCalledWith('fsd-observatory');
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: reduce ? 'auto' : 'smooth', block: 'start',
      });
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    } finally {
      window.location.hash = previousHash;
      getElement.mockRestore();
    }
  });

  it('mounts every panel and requests the shared default range', () => {
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
    expect(useFsdInsightsMock).toHaveBeenCalledWith(
      '42', expect.any(String), expect.any(String), Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(pageTitleMock).toHaveBeenCalledWith('FSD Insights');
  });

  it('uses a shared custom date link instead of the retired days filter', () => {
    renderPage('/fsd?from=2026-05-01&to=2026-05-07');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { startInstant, endInstantExclusive } = calendarRangeToInstants({
      startDate: '2026-05-01',
      endDate: '2026-05-07',
      timezone,
    });
    expect(useFsdInsightsMock).toHaveBeenCalledWith(
      '42', startInstant, endInstantExclusive, timezone,
    );
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-05-01&to=2026-05-07');
    expect(screen.queryByTestId('fsd-period-control')).toBeNull();
  });

  it.each([
    ['30', 30],
    ['365', 365],
  ])('restores an existing days=%s link through the header range', async (days, expectedDays) => {
    renderPage(`/fsd?days=${days}&vehicle_id=42`);
    await waitFor(() => {
      const params = new URLSearchParams((screen.getByTestId('location').textContent ?? '').split('?')[1]);
      expect(params.has('days')).toBe(false);
      expect(params.get('vehicle_id')).toBe('42');
      expect(params.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const start = Date.parse(useFsdInsightsMock.mock.lastCall?.[1] as string);
      const end = Date.parse(useFsdInsightsMock.mock.lastCall?.[2] as string);
      expect((end - start) / 86_400_000).toBeGreaterThan(expectedDays - 2);
      expect((end - start) / 86_400_000).toBeLessThan(expectedDays + 2);
    });
  });

  it('prefers an explicit shared range over an obsolete days parameter', async () => {
    renderPage('/fsd?days=90&from=2026-05-01&to=2026-05-07');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { startInstant, endInstantExclusive } = calendarRangeToInstants({
      startDate: '2026-05-01', endDate: '2026-05-07', timezone,
    });
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('days='));
    expect(useFsdInsightsMock).toHaveBeenLastCalledWith(
      '42', startInstant, endInstantExclusive, timezone,
    );
  });

  it('reacts to header range changes while preserving the vehicle scope', async () => {
    renderPage('/fsd?vehicle_id=42');
    const priorStart = useFsdInsightsMock.mock.lastCall?.[1] as string;
    fireEvent.click(screen.getByRole('button', { name: 'Change header range' }));
    await waitFor(() => {
      const params = new URLSearchParams((screen.getByTestId('location').textContent ?? '').split('?')[1]);
      expect(params.get('time_scope')).toBe('90d');
      expect(params.get('vehicle_id')).toBe('42');
    });
    expect(useFsdInsightsMock.mock.lastCall?.[1]).not.toBe(priorStart);
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
    useFsdInsightsMock.mockReturnValue(query({ isPending: true, isFetching: true, fetchStatus: 'fetching' }));
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
  });

  it('keeps every panel mounted when the period reported no measurable distance', () => {
    useFsdInsightsMock.mockReturnValue(loaded({ data: { totals: { fsd_distance_m: null } } }));
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('empty');
    }
  });

  it('keeps every panel mounted without a vehicle', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('no-vehicle');
    }
    expect(screen.queryByTestId('fsd-period-control')).toBeNull();
    expect(useFsdInsightsMock).toHaveBeenCalledWith(
      undefined, expect.any(String), expect.any(String), expect.any(String),
    );
  });

  it('does not publish perpetual loading for an idle disabled query with no vehicle', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    useFsdInsightsMock.mockReturnValue(query({ isPending: true, isFetching: false, fetchStatus: 'idle' }));
    renderPage();
    expect(sectionPropsMock).toHaveBeenCalled();
    for (const [, props] of sectionPropsMock.mock.calls) {
      expect(props.state.noVehicle).toBe(true);
      expect(props.state.isLoading).toBe(false);
      expect(props.insights).toBeUndefined();
    }
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('no-vehicle');
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

  it('preserves measured zero separately from unknown counter distance', () => {
    const zeroInsights = { totals: { fsd_distance_m: 0 } };
    useFsdInsightsMock.mockReturnValue(loaded({ data: zeroInsights }));
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready:0');
    }
    for (const [, props] of sectionPropsMock.mock.calls) {
      expect(props.insights).toBe(zeroInsights);
      expect(props.state.error).toBeNull();
    }
    expect(screen.queryByTestId('stale-warning')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'ok');
  });

  it('retains historical evidence during paused refresh without inventing an error or live state', () => {
    useFsdInsightsMock.mockReturnValue(loaded({ fetchStatus: 'paused' }));
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready:16093.44');
    }
    const state = staleWarningMock.mock.calls.at(-1)?.[0];
    expect(state).toMatchObject({
      data: POPULATED,
      provenance: 'historical',
      status: 'stale',
      isRefreshBlocked: true,
      refreshError: null,
      fatalError: null,
      updatedAt: 1_772_000_000_000,
    });
    expect(screen.getByTestId('stale-warning')).toHaveTextContent('stale');
    expect(screen.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'stale');
    expect(screen.queryByLabelText('Live')).not.toBeInTheDocument();
    for (const [, props] of sectionPropsMock.mock.calls) {
      expect(props.insights).toBe(POPULATED);
      expect(props.state.error).toBeNull();
      expect(props.state.isLoading).toBe(false);
    }
  });

  it('leaves initial paused evidence unknown rather than measured zero or historical', () => {
    const refetch = vi.fn();
    useFsdInsightsMock.mockReturnValue(query({ fetchStatus: 'paused', refetch }));
    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }
    expect(staleWarningMock.mock.calls.at(-1)?.[0]).toMatchObject({
      hasData: false,
      provenance: 'unknown',
      status: 'initial',
      isRefreshBlocked: true,
      refreshError: null,
      fatalError: null,
      updatedAt: null,
    });
    expect(screen.getByLabelText('Unknown source')).toHaveAttribute('data-data-status', 'initial');
    expect(screen.queryByLabelText('Historical')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Refresh paused');
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByText(/offline|Service unavailable/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, 0])('recovers a paused first request to successful distance=%s', (distance) => {
    useFsdInsightsMock.mockReturnValue(query({ fetchStatus: 'paused' }));
    const view = renderPage();
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();

    useFsdInsightsMock.mockReturnValue(loaded({ data: { totals: { fsd_distance_m: distance } } }));
    view.rerender(<PageHarness />);

    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-warning')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'ok');
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(distance === null ? 'empty' : 'ready:0');
    }
  });

  it.each(['failed', 'paused'])('retries the actual source after a %s retained refresh and clears the warning on recovery', (status) => {
    const refetch = vi.fn();
    useFsdInsightsMock.mockReturnValue(loaded(status === 'failed'
      ? { isError: true, error: new Error('refresh failed'), refetch }
      : { fetchStatus: 'paused', refetch }));
    const view = renderPage();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    useFsdInsightsMock.mockReturnValue(loaded({ isFetching: true, fetchStatus: 'fetching', refetch }));
    view.rerender(<PageHarness />);
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready:16093.44');

    useFsdInsightsMock.mockReturnValue(loaded({ dataUpdatedAt: 1_772_000_060_000, refetch }));
    view.rerender(<PageHarness />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'ok');
    expect(staleWarningMock.mock.calls.at(-1)?.[0]).toMatchObject({
      refreshError: null, fatalError: null, updatedAt: 1_772_000_060_000,
    });
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready:16093.44');
  });

  it.each(SECTION_IDS)('isolates a render failure and retries only the affected %s section', (failedSection) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refetch = vi.fn();
    useFsdInsightsMock.mockReturnValue(loaded({ refetch }));
    sectionFailureMock.mockImplementation((id: string) => {
      if (id === failedSection) throw new Error('Synthetic FSD section render failure');
    });

    try {
      renderPage();
      expect(screen.getByText('Component failed to load')).toBeInTheDocument();
      expect(screen.queryByTestId(failedSection)).not.toBeInTheDocument();
      for (const id of SECTION_IDS.filter((id) => id !== failedSection)) {
        expect(screen.getByTestId(id)).toHaveTextContent('ready:16093.44');
      }
      expect(screen.getByRole('heading', { name: 'FSD Insights' })).toBeInTheDocument();
      expect(screen.getByLabelText('Historical')).toBeInTheDocument();

      sectionFailureMock.mockReset();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

      for (const id of SECTION_IDS) {
        expect(screen.getByTestId(id)).toHaveTextContent('ready:16093.44');
      }
      expect(screen.queryByText('Component failed to load')).not.toBeInTheDocument();
      expect(refetch).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
