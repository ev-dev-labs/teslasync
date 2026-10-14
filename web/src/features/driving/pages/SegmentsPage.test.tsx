import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { GhostResponse, LeaderboardRow, SegmentSummary } from '@/api/hooks/useSegments';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  segments: [] as SegmentSummary[],
  selectedIds: [] as Array<number | null>,
  segmentError: null as Error | null,
  leaderboardError: null as Error | null,
  ghostError: null as Error | null,
  segmentHasData: true,
  leaderboardHasData: true,
  segmentFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  leaderboardFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  ghostFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  ghost: undefined as GhostResponse | undefined,
  leaderboardRows: [] as LeaderboardRow[],
  efficiencyRows: [] as LeaderboardRow[],
  chartInputs: [] as unknown[],
  segmentRefetch: vi.fn(),
  leaderboardRefetch: vi.fn(),
  ghostRefetch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance: (meters: number) => `${meters} m` }),
}));
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div>Vehicle select</div>,
}));
vi.mock('@/components/layout', async (importActual) => ({
  ...await importActual<typeof import('@/components/layout')>(),
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/charts', async (importActual) => ({
  ...await importActual<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => (
    <div data-testid="gap-chart" data-points={JSON.stringify(data)}>{children}</div>
  ),
  ReferenceLine: ({ y, stroke, strokeDasharray, strokeOpacity }: {
    y: number; stroke: string; strokeDasharray: string; strokeOpacity: number;
  }) => (
    <svg>
      <line data-testid="gap-reference" y1={y} y2={y} stroke={stroke}
        strokeDasharray={strokeDasharray} strokeOpacity={strokeOpacity} />
    </svg>
  ),
  YAxis: ({ tickFormatter }: { tickFormatter: (value: number) => string }) => (
    <div data-testid="chart-axis-values">
      {state.chartInputs.map((value, index) => (
        <span key={index}>{tickFormatter(value as number)}</span>
      ))}
    </div>
  ),
  Tooltip: ({ content }: { content: ReactNode }) => <>{content}</>,
  ChartTooltip: ({ valueFormatter }: { valueFormatter: (value: unknown) => string }) => (
    <div data-testid="chart-tooltip-values">
      {state.chartInputs.map((value, index) => (
        <span key={index}>{valueFormatter(value)}</span>
      ))}
    </div>
  ),
}));
vi.mock('@/api/hooks/useSegments', () => ({
  useSegments: () => ({
    data: state.segmentHasData ? { segments: state.segments } : undefined,
    isLoading: !state.segmentHasData && state.segmentFetchStatus === 'fetching',
    isPending: !state.segmentHasData,
    fetchStatus: state.segmentFetchStatus,
    isError: state.segmentError != null,
    error: state.segmentError,
    refetch: state.segmentRefetch,
  }),
  useSegmentLeaderboard: (id: number | null) => {
    state.selectedIds.push(id);
    return {
      data: id == null || !state.leaderboardHasData ? undefined : {
        segment: { id, name: `Route ${id}` },
        by_time: state.leaderboardRows,
        by_efficiency: state.efficiencyRows,
      },
      isLoading: !state.leaderboardHasData && state.leaderboardFetchStatus === 'fetching',
      isPending: !state.leaderboardHasData,
      fetchStatus: state.leaderboardFetchStatus,
      isError: state.leaderboardError != null,
      error: state.leaderboardError,
      refetch: state.leaderboardRefetch,
    };
  },
  useSegmentGhost: () => ({
    data: state.ghost,
    isLoading: !state.ghost && state.ghostFetchStatus === 'fetching',
    isPending: !state.ghost,
    fetchStatus: state.ghostFetchStatus,
    isError: state.ghostError != null,
    error: state.ghostError,
    refetch: state.ghostRefetch,
  }),
}));

import SegmentsPage from './SegmentsPage';

const segment = (id: number): SegmentSummary => ({
  id,
  name: `Route ${id}`,
  start_address: 'Home',
  end_address: 'Office',
  distance_m: 1000,
  attempt_count: 2,
  best_time: null,
  best_efficiency: null,
  latest: null,
});

function renderPage(path = '/segments') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SegmentsPage />
    </MemoryRouter>,
  );
}

describe('SegmentsPage pagination', () => {
  beforeEach(() => {
    state.vehicleId = 7;
    state.segments = Array.from({ length: 25 }, (_, index) => segment(index + 1));
    state.selectedIds = [];
    state.segmentError = null;
    state.leaderboardError = null;
    state.ghostError = null;
    state.segmentHasData = true;
    state.leaderboardHasData = true;
    state.segmentFetchStatus = 'idle';
    state.leaderboardFetchStatus = 'idle';
    state.ghostFetchStatus = 'idle';
    state.ghost = undefined;
    state.leaderboardRows = [];
    state.efficiencyRows = [];
    state.chartInputs = [];
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    state.segmentRefetch.mockClear();
    state.leaderboardRefetch.mockClear();
    state.ghostRefetch.mockClear();
  });

  it('distinguishes active loading, paused initial segments, and a successful empty response', () => {
    state.segmentHasData = false;
    state.segmentFetchStatus = 'fetching';
    const view = renderPage();
    const list = screen.getByRole('region', { name: 'Route segments' });
    expect(list.querySelectorAll('[aria-hidden="true"][style]')).toHaveLength(6);
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.queryByText(/No segments yet/)).not.toBeInTheDocument();
    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    expect(screen.getByText('Time gap (A vs B)')).toBeInTheDocument();

    state.segmentFetchStatus = 'paused';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(within(list).getByText('Refresh paused')).toBeInTheDocument();
    expect(list.querySelector('[aria-hidden="true"][style]')).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: /Retry unavailable sources: Route segments/ }));
    expect(state.segmentRefetch).toHaveBeenCalledTimes(1);
    expect(state.leaderboardRefetch).not.toHaveBeenCalled();

    state.segmentHasData = true;
    state.segments = [];
    state.segmentFetchStatus = 'idle';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.getByText(/No segments yet/)).toBeInTheDocument();
  });

  it('tracks leaderboard and ghost initial pauses independently and recovers to measured zero', () => {
    state.leaderboardHasData = false;
    state.leaderboardFetchStatus = 'fetching';
    const view = renderPage();
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 1' }));
    expect(screen.queryByText('No ranked attempts on this segment yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();

    state.leaderboardFetchStatus = 'paused';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry unavailable sources: Leaderboard/ }));
    expect(state.leaderboardRefetch).toHaveBeenCalledTimes(1);
    expect(state.segmentRefetch).not.toHaveBeenCalled();

    state.leaderboardHasData = true;
    state.leaderboardFetchStatus = 'idle';
    state.leaderboardRows = [1, 2].map((id) => ({
      rank: id, drive_id: id, started_at: '2026-10-14T12:00:00Z',
      duration_s: 0, distance_m: 0, wh_per_km: 0, delta_to_best_s: 0, is_pr: id === 1,
    }));
    state.ghostFetchStatus = 'fetching';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.getByRole('table')).toHaveTextContent('0.00s');
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('segment-ghost-brief')).getByText('Loading source')).toBeInTheDocument();

    state.ghostFetchStatus = 'paused';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Not enough shared telemetry to align these two attempts.')).not.toBeInTheDocument();
    expect(screen.getByTestId('segment-ghost-brief')).toBeInTheDocument();
    expect(within(screen.getByTestId('segment-ghost-brief')).getByText('Source unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Retained source')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry unavailable sources: Ghost Race/ }));
    expect(state.ghostRefetch).toHaveBeenCalledTimes(1);
    expect(state.leaderboardRefetch).toHaveBeenCalledTimes(1);

    state.ghostFetchStatus = 'idle';
    state.ghost = {
      segment: segment(1),
      a: { drive_id: 1, duration_s: 0, series: [] },
      b: { drive_id: 2, duration_s: 0, series: [] },
      split_deltas: [], winner_drive_id: null, margin_s: 0,
    };
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.getByText('Dead heat')).toBeInTheDocument();
    const brief = screen.getByTestId('segment-ghost-brief');
    expect(within(brief).getByText('Source available')).toBeInTheDocument();
    expect(within(brief).getAllByText('0:00')).toHaveLength(2);
    expect(screen.getAllByText('Not enough shared telemetry to align these two attempts.')).toHaveLength(2);

    state.ghostError = new Error('ghost refresh failed');
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(screen.getByText('Dead heat')).toBeInTheDocument();
    expect(within(brief).getByText('Retained source')).toBeInTheDocument();
    expect(within(brief).queryByText('Source available')).not.toBeInTheDocument();
    expect(within(brief).getAllByText('0:00')).toHaveLength(2);
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(state.ghostRefetch).toHaveBeenCalledTimes(2);
    state.ghostError = null;
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('Dead heat')).toBeInTheDocument();
    expect(within(brief).getByText('Source available')).toBeInTheDocument();
    expect(within(brief).queryByText('Retained source')).not.toBeInTheDocument();
  });

  it.each(['failed', 'paused'] as const)('preserves ghost metrics and one shared notice during a %s refresh and recovery', (refresh) => {
    state.leaderboardRows = [1, 2].map((id) => ({
      rank: id, drive_id: id, started_at: '2026-10-14T12:00:00Z',
      duration_s: 60 + id, distance_m: 1000, wh_per_km: 150,
      delta_to_best_s: id - 1, is_pr: id === 1,
    }));
    state.ghost = {
      segment: segment(1),
      a: { drive_id: 1, duration_s: 61, series: [
        { fraction_of_distance: 0.5, elapsed_s: 30, speed_mps: 10 },
      ] },
      b: { drive_id: 2, duration_s: 62, series: [
        { fraction_of_distance: 0.5, elapsed_s: 31, speed_mps: 10 },
      ] },
      split_deltas: [{ fraction: 0.5, delta_s: -1 }],
      winner_drive_id: 1, margin_s: 1,
    };
    const view = renderPage();
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 1' }));
    const brief = screen.getByTestId('segment-ghost-brief');
    expect(within(brief).getByText('Source available')).toBeInTheDocument();

    state.ghostError = refresh === 'failed' ? new Error('ghost refresh failed') : null;
    state.ghostFetchStatus = refresh === 'paused' ? 'paused' : 'idle';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(within(brief).getByText('Retained source')).toBeInTheDocument();
    expect(within(brief).queryByText('Source available')).not.toBeInTheDocument();
    expect(within(brief).getByText('1:01')).toBeInTheDocument();
    expect(within(brief).getByText('1:02')).toBeInTheDocument();
    expect(within(brief).getByText('Won by 0:01')).toBeInTheDocument();
    expect(within(brief).getByText(/^Attempt A ·/)).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.queryByText('No requested source has returned usable data yet.')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(state.ghostRefetch).toHaveBeenCalledTimes(1);
    expect(state.segmentRefetch).not.toHaveBeenCalled();
    expect(state.leaderboardRefetch).not.toHaveBeenCalled();

    state.ghostError = null;
    state.ghostFetchStatus = 'idle';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(within(brief).getByText('Source available')).toBeInTheDocument();
    expect(within(brief).queryByText('Retained source')).not.toBeInTheDocument();
    expect(within(brief).getByText('1:01')).toBeInTheDocument();
    expect(within(brief).getByText('1:02')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('keeps leaderboard and ghost shells visible before a segment is selected', () => {
    renderPage();
    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    expect(screen.getAllByText('Ghost Race').length).toBeGreaterThan(0);
    expect(screen.getByTestId('segment-ghost-brief')).toBeInTheDocument();
    expect(screen.getByText('Elapsed time along the route')).toBeInTheDocument();
    expect(screen.getByText('Time gap (A vs B)')).toBeInTheDocument();
    expect(screen.getByText('Select a route segment to view its ranked attempts.')).toBeInTheDocument();
    expect(screen.getByText('Choose an A and a B attempt from the leaderboard to start the race.')).toBeInTheDocument();
  });

  it('retains selected segments and leaderboard rows through independent failed refreshes', () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 1' }));
    state.segmentError = new Error('segment refresh failed');
    state.leaderboardError = new Error('leaderboard refresh failed');
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No ranked attempts on this segment yet.')).toBeInTheDocument();
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    expect(warnings).toHaveLength(2);
    fireEvent.click(within(warnings[0]).getByRole('button', { name: 'Refresh' }));
    expect(state.segmentRefetch).toHaveBeenCalledTimes(1);
    expect(state.leaderboardRefetch).not.toHaveBeenCalled();
    fireEvent.click(within(warnings[1]).getByRole('button', { name: 'Refresh' }));
    expect(state.leaderboardRefetch).toHaveBeenCalledTimes(1);
    state.segmentError = null;
    state.leaderboardError = null;
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 1' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows twelve segments per page and navigates through every result', () => {
    renderPage();
    const list = screen.getByRole('listbox', { name: 'Route segments' });
    expect(within(list).getAllByRole('option')).toHaveLength(12);
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByText('Showing 1–12 of 25')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(within(list).getAllByRole('option')).toHaveLength(12);
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 13' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Open leaderboard for Route 1' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 25' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByText('Showing 25–25 of 25')).toBeInTheDocument();
  });

  it('clears the selected leaderboard and ghost when the page changes', () => {
    renderPage();
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 1' }));
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No ranked attempts on this segment yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.queryByText('No ranked attempts on this segment yet.')).not.toBeInTheDocument();
    expect(state.selectedIds[state.selectedIds.length - 1]).toBeNull();
  });

  it('honors a shared page URL and clamps it after the result count shrinks', async () => {
    const page = renderPage('/segments?page=3');
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 25' })).toBeInTheDocument();
    state.segments = Array.from({ length: 13 }, (_, index) => segment(index + 1));
    page.rerender(<MemoryRouter initialEntries={['/segments?page=3']}><SegmentsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Showing 13–13 of 13')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 13' })).toBeInTheDocument();
  });

  it('returns to the first page and clears the race when the vehicle changes', async () => {
    const page = renderPage('/segments?page=2');
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 13' }));
    expect(screen.getByText('No ranked attempts on this segment yet.')).toBeInTheDocument();
    state.vehicleId = 8;
    page.rerender(<MemoryRouter initialEntries={['/segments?page=2']}><SegmentsPage /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Open leaderboard for Route 1' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.queryByText('No ranked attempts on this segment yet.')).not.toBeInTheDocument();
  });

  it('omits pagination for a single page', () => {
    state.segments = [segment(1)];
    renderPage();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it.each([
    { input: undefined, expected: '—' },
    { input: null, expected: '—' },
    { input: NaN, expected: '—' },
    { input: Infinity, expected: '—' },
    { input: -Infinity, expected: '—' },
    { input: '', expected: '—' },
    { input: '2', expected: '—' },
    { input: 0, expected: '0.00s' },
    { input: -0, expected: '0.00s' },
    { input: -4, expected: '−4.00s' },
    { input: 4, expected: '+4.00s' },
    { input: -1.25, expected: '−1.25s' },
    { input: 1.25, expected: '+1.25s' },
  ])('formats the time-gap axis and tooltip for $input as $expected', ({ input, expected }) => {
    state.chartInputs = [input];
    state.ghost = {
      segment: { ...segment(1) },
      a: { drive_id: 1, duration_s: 60, series: [] },
      b: { drive_id: 2, duration_s: 60, series: [] },
      split_deltas: [{ fraction: 0.5, delta_s: 0 }],
      winner_drive_id: null,
      margin_s: 0,
    };
    renderPage();
    expect(screen.getByTestId('chart-axis-values')).toHaveTextContent(expected);
    expect(screen.getByTestId('chart-tooltip-values')).toHaveTextContent(expected);
    expect(screen.getByText('Below the line, Attempt A is ahead; above it, Attempt B leads.')).toBeInTheDocument();
  });

  it('uses a neutral theme-aware zero reference without changing dashes, opacity, or split signs', () => {
    state.chartInputs = [-1.25, 0, 1.25];
    state.ghost = {
      segment: segment(1),
      a: { drive_id: 1, duration_s: 60, series: [
        { fraction_of_distance: 0.5, elapsed_s: 30, speed_mps: 10 },
      ] },
      b: { drive_id: 2, duration_s: 61, series: [
        { fraction_of_distance: 0.5, elapsed_s: 31, speed_mps: 10 },
      ] },
      split_deltas: [
        { fraction: 0.25, delta_s: -1.25 },
        { fraction: 0.5, delta_s: 0 },
        { fraction: 0.75, delta_s: 1.25 },
      ],
      winner_drive_id: 1,
      margin_s: 1,
    };
    renderPage();

    const reference = screen.getByTestId('gap-reference');
    expect(reference).toHaveAttribute('stroke', chartTokens.axisStroke);
    expect(reference).toHaveAttribute('stroke', 'var(--text-muted)');
    expect(reference).toHaveAttribute('y1', '0');
    expect(reference).toHaveAttribute('y2', '0');
    expect(reference).toHaveAttribute('stroke-dasharray', '4 3');
    expect(reference).toHaveAttribute('stroke-opacity', '0.7');
    expect(screen.getByTestId('gap-chart')).toHaveAttribute('data-points', JSON.stringify([
      { frac: 0.25, delta: -1.25 },
      { frac: 0.5, delta: 0 },
      { frac: 0.75, delta: 1.25 },
    ]));
    const chart = screen.getByTestId('gap-chart');
    for (const value of ['−1.25s', '0.00s', '+1.25s']) {
      expect(within(chart).getByTestId('chart-axis-values')).toHaveTextContent(value);
      expect(within(chart).getByTestId('chart-tooltip-values')).toHaveTextContent(value);
    }
    expect(screen.getByText('Below the line, Attempt A is ahead; above it, Attempt B leads.')).toBeInTheDocument();
    expect(screen.getByText('Elapsed time along the route')).toBeInTheDocument();
  });

  it('shows measured zero and signed fractional gaps in the leaderboard', () => {
    state.leaderboardRows = [0, -1.25, 1.25, NaN].map((delta, index) => ({
      rank: index + 1,
      drive_id: index + 1,
      started_at: '2026-10-14T12:00:00Z',
      duration_s: 60,
      distance_m: 1000,
      wh_per_km: 150,
      delta_to_best_s: delta,
      is_pr: index === 0,
    }));
    renderPage();
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 1' }));
    expect(screen.getByText('0.00s')).toBeInTheDocument();
    expect(screen.getByText('−1.25s')).toBeInTheDocument();
    expect(screen.getByText('+1.25s')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('—');
  });

  it('keeps every leaderboard field available on mobile with adjacent 44px race targets and compact desktop restoration', () => {
    state.leaderboardRows = [{
      rank: 1, drive_id: 1, started_at: '2026-10-14T12:00:00Z',
      duration_s: 60, distance_m: 1000, wh_per_km: 150,
      delta_to_best_s: 0, is_pr: true,
    }];
    renderPage();
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 1' }));
    const table = screen.getByRole('table');
    for (const label of ['#', 'Date', 'Time', 'Wh/km', 'Δ to best', 'Race']) {
      expect(within(table).getByRole('columnheader', { name: label })).not.toHaveClass('hidden');
    }
    for (const cell of within(table).getAllByRole('cell')) {
      expect(cell).not.toHaveClass('hidden');
    }
    const a = within(table).getByRole('button', { name: 'A (selected)' });
    const b = within(table).getByRole('button', { name: 'B' });
    expect(a.parentElement).toBe(b.parentElement);
    expect(a.parentElement).toHaveClass('inline-flex', 'gap-1');
    for (const button of [a, b]) {
      expect(button).toHaveClass(
        'h-11', 'w-11', 'min-h-11', 'min-w-11', 'shrink-0',
        'md:h-7', 'md:w-7', 'md:min-h-0', 'md:min-w-0',
      );
    }
    const ordering = screen.getByRole('group', { name: 'Order by' });
    expect(ordering).toHaveClass('flex-wrap', 'gap-1');
    for (const button of within(ordering).getAllByRole('button')) {
      expect(button).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0');
    }
  });

  it('operates ordering and exclusive A/B selection with the keyboard without losing focus', async () => {
    const user = userEvent.setup();
    state.leaderboardRows = [1, 2, 3].map((id) => ({
      rank: id, drive_id: id, started_at: `2026-10-${10 + id}T12:00:00Z`,
      duration_s: 60 + id, distance_m: 1000, wh_per_km: 150 - id,
      delta_to_best_s: id - 1, is_pr: id === 1,
    }));
    state.efficiencyRows = [...state.leaderboardRows].reverse();
    renderPage();
    const segmentOption = screen.getByRole('option', { name: 'Open leaderboard for Route 1' });
    segmentOption.focus();
    await user.keyboard('{Enter}');
    const efficiency = screen.getByRole('button', { name: 'By efficiency' });
    efficiency.focus();
    await user.keyboard(' ');
    expect(efficiency).toHaveAttribute('aria-pressed', 'true');
    expect(efficiency).toHaveFocus();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('3')).toBeInTheDocument();
    const a = within(rows[0]).getByRole('button', { name: 'A' });
    a.focus();
    await user.keyboard('{Enter}');
    expect(a).toHaveAttribute('aria-pressed', 'true');
    expect(a).toHaveFocus();
    await user.tab();
    const b = within(rows[0]).getByRole('button', { name: 'B' });
    expect(b).toHaveFocus();
    await user.keyboard(' ');
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(a).toHaveAttribute('aria-pressed', 'false');
    expect(b).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(b).toHaveAttribute('aria-pressed', 'false');
    const time = screen.getByRole('button', { name: 'By time' });
    time.focus();
    await user.keyboard('{Enter}');
    expect(time).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('1');
  });
});
