import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo, type ComponentProps, type ReactNode } from 'react';

import type { GhostResponse, LeaderboardRow, SegmentSummary } from '@/api/hooks/useSegments';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import { formatDateShort } from '@/lib/dateFormat';
import type { DateFormatter } from '@/hooks/useDateFormat';

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
  reduceMotion: false,
  hiddenSeries: new Set<string>(),
  elapsedLine: vi.fn(),
  segmentRefetch: vi.fn(),
  leaderboardRefetch: vi.fn(),
  ghostRefetch: vi.fn(),
  formatDateShort: vi.fn<DateFormatter>(),
  ghostArgs: [] as Array<[number | null, number | null, number | null]>,
  translations: {} as Record<string, string>,
}));

vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: string, values?: Record<string, unknown>) =>
    (state.translations[key] ?? fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
  return { useTranslation: () => ({ t }) };
});

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: state.reduceMotion, durationMs: state.reduceMotion ? 0 : 250 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateShort: state.formatDateShort }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/hooks/useUnits', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useUnits')>();
  return {
    ...actual,
    useUnits: () => ({ ...actual.useUnits(), formatDistance: (meters: number) => `${meters} m` }),
  };
});
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div>Vehicle select</div>,
}));
vi.mock('@/components/layout', async (importActual) => {
  const actual = await importActual<typeof import('@/components/layout')>();
  return {
    ...actual,
    PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
    ChartCard: ({ children, ...props }: ComponentProps<typeof actual.ChartCard>) => (
      <actual.ChartCard {...props}>
        {typeof children === 'function' ? (context) => children({
          ...context,
          hiddenSeries: context.hiddenSeries ? {
            ...context.hiddenSeries,
            isHidden: (key) => state.hiddenSeries.has(key),
          } : null,
        }) : children}
      </actual.ChartCard>
    ),
  };
});
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/charts', async (importActual) => ({
  ...await importActual<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  // The chart wrappers below are DOM doubles, so cartesian children that need
  // Recharts context are inert here.
  XAxis: () => null,
  Area: () => null,
  ChartGradient: () => null,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: (props: ComponentProps<typeof import('@/components/charts').Line>) => {
    state.elapsedLine(props);
    return null;
  },
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
    const data = useMemo(() => id == null || !state.leaderboardHasData ? undefined : {
      segment: { id, name: `Route ${id}` },
      by_time: state.leaderboardRows,
      by_efficiency: state.efficiencyRows,
    }, [id, state.leaderboardHasData, state.leaderboardRows, state.efficiencyRows]);
    return {
      data,
      isLoading: !state.leaderboardHasData && state.leaderboardFetchStatus === 'fetching',
      isPending: !state.leaderboardHasData,
      fetchStatus: state.leaderboardFetchStatus,
      isError: state.leaderboardError != null,
      error: state.leaderboardError,
      refetch: state.leaderboardRefetch,
    };
  },
  useSegmentGhost: (segmentId: number | null, a: number | null, b: number | null) => {
    state.ghostArgs.push([segmentId, a, b]);
    return {
    data: state.ghost,
    isLoading: !state.ghost && state.ghostFetchStatus === 'fetching',
    isPending: !state.ghost,
    fetchStatus: state.ghostFetchStatus,
    isError: state.ghostError != null,
    error: state.ghostError,
    refetch: state.ghostRefetch,
    };
  },
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
  it('selects segments with native toggle buttons that keep Tab, Enter and Space semantics', () => {
    renderPage();
    const list = screen.getByRole('group', { name: 'Route segments' });
    const card = within(list).getByRole('button', { name: 'Open leaderboard for Route 1' });
    expect(card.tagName).toBe('BUTTON');
    expect(card).toHaveAttribute('type', 'button');
    expect(card).not.toHaveAttribute('role');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(card).not.toHaveAttribute('aria-selected');
    card.focus();
    expect(card).toHaveFocus();
    fireEvent.click(card);
    expect(within(list).getByRole('button', { name: 'Open leaderboard for Route 1' })).toHaveAttribute('aria-pressed', 'true');
  });

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
    state.reduceMotion = false;
    state.hiddenSeries = new Set();
    state.elapsedLine.mockClear();
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    state.segmentRefetch.mockClear();
    state.leaderboardRefetch.mockClear();
    state.ghostRefetch.mockClear();
    state.ghostArgs = [];
    state.translations = {};
    state.formatDateShort = vi.fn((value) => formatDateShort(value, { locale: 'en-US', tz: 'UTC' }));
  });

  it('updates leaderboard and ghost dates from display preferences without changing attempt identity or raw timestamps', () => {
    const timestamps = ['2026-10-14T00:30:00Z', '2026-10-14T01:30:00Z', '2026-10-14T02:30:00Z'];
    state.leaderboardRows = timestamps.map((started_at, index) => Object.freeze({
      rank: index + 1, drive_id: index + 101, started_at,
      duration_s: 60 + index, distance_m: 1000, wh_per_km: 150,
      delta_to_best_s: index, is_pr: index === 0,
    }));
    state.efficiencyRows = [...state.leaderboardRows].reverse();
    state.ghost = {
      segment: segment(1),
      a: { drive_id: 103, duration_s: 62, series: [] },
      b: { drive_id: 102, duration_s: 61, series: [] },
      split_deltas: [], winner_drive_id: 102, margin_s: 1,
    };
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'By efficiency' }));
    const table = screen.getByRole('table');
    const firstRow = within(table).getAllByRole('row')[1];
    const pickA = within(firstRow).getByRole('button', { name: 'Attempt A · Oct 14 · #103' });
    pickA.focus();
    fireEvent.click(pickA);
    expect(pickA).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).getAllByText('Oct 14')).toHaveLength(3);
    const brief = screen.getByTestId('segment-ghost-brief');
    expect(within(brief).getByText('Attempt B · Oct 14')).toBeInTheDocument();
    expect(within(brief).getAllByText('Oct 14')).toHaveLength(2);
    expect(state.ghostArgs.at(-1)).toEqual([1, 103, 102]);

    state.formatDateShort = vi.fn((value) => formatDateShort(value, {
      locale: 'de-DE', tz: 'America/Los_Angeles',
    }));
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(within(table).getAllByText('13. Okt.')).toHaveLength(3);
    expect(within(brief).getByText('Attempt B · 13. Okt.')).toBeInTheDocument();
    expect(within(brief).getAllByText('13. Okt.')).toHaveLength(2);
    expect(screen.queryByText('Oct 14')).not.toBeInTheDocument();
    expect(pickA).toHaveFocus();
    expect(pickA).toHaveAccessibleName('Attempt A · 13. Okt. · #103');
    expect(pickA).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'By efficiency' })).toHaveAttribute('aria-pressed', 'true');
    expect(state.ghostArgs.at(-1)).toEqual([1, 103, 102]);
    expect(state.leaderboardRows.map((row) => row.started_at)).toEqual(timestamps);
    for (const timestamp of timestamps) {
      expect(state.formatDateShort).toHaveBeenCalledWith(timestamp);
    }
  });

  it('localizes attempt labels with distinct row context while keeping visible letters and pressed state', () => {
    state.translations = {
      'segments.ghost.racerA': 'Versuch A',
      'segments.ghost.racerB': 'Versuch B',
      'segments.table.attemptLabel': '{{attempt}} für #{{driveId}} am {{date}}',
    };
    state.leaderboardRows = [101, 102, 103].map((drive_id, index) => ({
      rank: index + 1, drive_id, started_at: '2026-10-14T12:00:00Z',
      duration_s: 60 + index, distance_m: 1000, wh_per_km: 150,
      delta_to_best_s: index, is_pr: index === 0,
    }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 1' }));
    const table = screen.getByRole('table');
    for (const id of [101, 102, 103]) {
      for (const letter of ['A', 'B']) {
        const button = within(table).getByRole('button', {
          name: `Versuch ${letter} für #${id} am Oct 14`,
        });
        expect(button).toHaveTextContent(new RegExp(`^${letter}$`));
        expect(button).toHaveAttribute('aria-pressed',
          String((letter === 'A' && id === 101) || (letter === 'B' && id === 102)));
      }
    }
    const a = within(table).getByRole('button', { name: 'Versuch A für #103 am Oct 14' });
    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-pressed', 'true');
    expect(a).toHaveAccessibleName('Versuch A für #103 am Oct 14');
    expect(within(table).getByRole('button', { name: 'Versuch A für #101 am Oct 14' }))
      .toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-pressed', 'false');
    expect(a).toHaveAccessibleName('Versuch A für #103 am Oct 14');
    expect(state.ghostArgs.at(-1)).toEqual([1, null, 102]);
    expect(table.querySelector('[aria-label*="selected"]')).toBeNull();
  });

  it('suppresses elapsed animation for the reduced-motion/low-bandwidth preference without changing samples or hidden-series identities', () => {
    const a = [
      { fraction_of_distance: 0, elapsed_s: 0, speed_mps: 0 },
      { fraction_of_distance: 0.5001, elapsed_s: 30.125, speed_mps: 10 },
      { fraction_of_distance: 0.5001, elapsed_s: 30.126, speed_mps: 10 },
    ];
    const b = [{ fraction_of_distance: 0.5002, elapsed_s: 31, speed_mps: 9 }];
    state.ghost = {
      segment: segment(1),
      a: { drive_id: 101, duration_s: 60, series: a },
      b: { drive_id: 102, duration_s: 61, series: b },
      split_deltas: [{ fraction: 0.5, delta_s: -1 }],
      winner_drive_id: 101, margin_s: 1,
    };
    state.hiddenSeries = new Set(['b']);
    const view = renderPage();
    const lines = () => state.elapsedLine.mock.calls.slice(-2).map(([props]) => props);
    const initialLines = lines();
    expect(initialLines).toEqual([
      expect.objectContaining({
        dataKey: 'a', name: 'Attempt A', hide: false, isAnimationActive: true,
        animationDuration: 700, connectNulls: false,
        data: a.map((point) => ({ frac: point.fraction_of_distance, a: point.elapsed_s })),
      }),
      expect.objectContaining({
        dataKey: 'b', name: 'Attempt B', hide: true, isAnimationActive: true,
        animationDuration: 700, connectNulls: false,
        data: b.map((point) => ({ frac: point.fraction_of_distance, b: point.elapsed_s })),
      }),
    ]);
    const table = screen.getByRole('table', { name: 'Elapsed time along the route — data table' });
    const tableContent = table.textContent;
    const gapPoints = screen.getByTestId('gap-chart').getAttribute('data-points');

    state.reduceMotion = true;
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(lines()).toEqual(initialLines.map((props) => ({ ...props, isAnimationActive: false })));
    lines().forEach((props, index) => expect(props.data).toBe(initialLines[index].data));
    expect(table).toHaveTextContent(tableContent ?? '');
    expect(screen.getByTestId('gap-chart')).toHaveAttribute('data-points', gapPoints);
    expect(state.ghost.a.series).toBe(a);
    expect(state.ghost.b.series).toBe(b);

    state.hiddenSeries = new Set(['a']);
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(lines().map(({ dataKey, hide, isAnimationActive }) => ({ dataKey, hide, isAnimationActive }))).toEqual([
      { dataKey: 'a', hide: true, isAnimationActive: false },
      { dataKey: 'b', hide: false, isAnimationActive: false },
    ]);

    state.reduceMotion = false;
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(lines().map(({ dataKey, hide, isAnimationActive }) => ({ dataKey, hide, isAnimationActive }))).toEqual([
      { dataKey: 'a', hide: true, isAnimationActive: true },
      { dataKey: 'b', hide: false, isAnimationActive: true },
    ]);
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
    expect(screen.getByText('Time gap (A vs B)', { selector: '[data-card-title]' })).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 1' }));
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
    assertOperationalBriefDisclosure(screen.getByTestId('segment-ghost-brief'), 'Loading source');

    state.ghostFetchStatus = 'paused';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Not enough shared telemetry to align these two attempts.')).not.toBeInTheDocument();
    expect(screen.getByTestId('segment-ghost-brief')).toBeInTheDocument();
    assertOperationalBriefDisclosure(screen.getByTestId('segment-ghost-brief'), 'Source unavailable');
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
    assertOperationalBriefDisclosure(brief, 'Source available');
    expect(within(brief).getAllByText('0:00')).toHaveLength(2);
    expect(screen.getAllByText('Not enough shared telemetry to align these two attempts.')).toHaveLength(2);

    state.ghostError = new Error('ghost refresh failed');
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(screen.getByText('Dead heat')).toBeInTheDocument();
    assertOperationalBriefDisclosure(brief, 'Retained source');
    assertOperationalBriefDisclosure(brief, 'Source available', { absent: true });
    expect(within(brief).getAllByText('0:00')).toHaveLength(2);
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(state.ghostRefetch).toHaveBeenCalledTimes(2);
    state.ghostError = null;
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('Dead heat')).toBeInTheDocument();
    assertOperationalBriefDisclosure(brief, 'Source available');
    assertOperationalBriefDisclosure(brief, 'Retained source', { absent: true });
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
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 1' }));
    const brief = screen.getByTestId('segment-ghost-brief');
    assertOperationalBriefDisclosure(brief, 'Source available');

    state.ghostError = refresh === 'failed' ? new Error('ghost refresh failed') : null;
    state.ghostFetchStatus = refresh === 'paused' ? 'paused' : 'idle';
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    assertOperationalBriefDisclosure(brief, 'Retained source');
    assertOperationalBriefDisclosure(brief, 'Source available', { absent: true });
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
    assertOperationalBriefDisclosure(brief, 'Source available');
    assertOperationalBriefDisclosure(brief, 'Retained source', { absent: true });
    expect(within(brief).getByText('1:01')).toBeInTheDocument();
    expect(within(brief).getByText('1:02')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('keeps leaderboard and ghost shells visible before a segment is selected', () => {
    renderPage();
    expect(screen.getByText('Leaderboard')).toBeInTheDocument();
    expect(screen.getAllByText('Ghost Race').length).toBeGreaterThan(0);
    expect(screen.getByTestId('segment-ghost-brief')).toBeInTheDocument();
    expect(screen.getByText('Elapsed time along the route', { selector: '[data-card-title]' })).toBeInTheDocument();
    expect(screen.getByText('Time gap (A vs B)', { selector: '[data-card-title]' })).toBeInTheDocument();
    expect(screen.getByText('Select a route segment to view its ranked attempts.')).toBeInTheDocument();
    expect(screen.getByText('Choose an A and a B attempt from the leaderboard to start the race.')).toBeInTheDocument();
  });

  it('retains selected segments and leaderboard rows through independent failed refreshes', () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 1' }));
    state.segmentError = new Error('segment refresh failed');
    state.leaderboardError = new Error('leaderboard refresh failed');
    view.rerender(<MemoryRouter><SegmentsPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Open leaderboard for Route 1' })).toHaveAttribute('aria-pressed', 'true');
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
    expect(screen.getByRole('button', { name: 'Open leaderboard for Route 1' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows twelve segments per page and navigates through every result', () => {
    renderPage();
    const list = screen.getByRole('group', { name: 'Route segments' });
    expect(within(list).getAllByRole('button', { name: /^Open leaderboard for / })).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Open leaderboard for Route 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByText('Showing 1–12 of 25')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(within(list).getAllByRole('button', { name: /^Open leaderboard for / })).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Open leaderboard for Route 13' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open leaderboard for Route 1' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(within(list).getAllByRole('button', { name: /^Open leaderboard for / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open leaderboard for Route 25' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByText('Showing 25–25 of 25')).toBeInTheDocument();
  });

  it('clears the selected leaderboard and ghost when the page changes', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 1' }));
    expect(screen.getByRole('button', { name: 'Open leaderboard for Route 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('No ranked attempts on this segment yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.queryByText('No ranked attempts on this segment yet.')).not.toBeInTheDocument();
    expect(state.selectedIds[state.selectedIds.length - 1]).toBeNull();
  });

  it('honors a shared page URL and clamps it after the result count shrinks', async () => {
    const page = renderPage('/segments?page=3');
    expect(screen.getByRole('button', { name: 'Open leaderboard for Route 25' })).toBeInTheDocument();
    state.segments = Array.from({ length: 13 }, (_, index) => segment(index + 1));
    page.rerender(<MemoryRouter initialEntries={['/segments?page=3']}><SegmentsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Showing 13–13 of 13')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open leaderboard for Route 13' })).toBeInTheDocument();
  });

  it('returns to the first page and clears the race when the vehicle changes', async () => {
    const page = renderPage('/segments?page=2');
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 13' }));
    expect(screen.getByText('No ranked attempts on this segment yet.')).toBeInTheDocument();
    state.vehicleId = 8;
    page.rerender(<MemoryRouter initialEntries={['/segments?page=2']}><SegmentsPage /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open leaderboard for Route 1' })).toBeInTheDocument());
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
    expect(screen.getByText('Elapsed time along the route', { selector: '[data-card-title]' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 1' }));
    expect(screen.getByText('0.00s')).toBeInTheDocument();
    expect(screen.getByText('−1.25s')).toBeInTheDocument();
    expect(screen.getByText('+1.25s')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('—');
  });

  it('exposes every independent elapsed sample without merging close or duplicate route fractions', () => {
    const a = [
      { fraction_of_distance: 0, elapsed_s: 0, speed_mps: 0 },
      { fraction_of_distance: 0.5001, elapsed_s: 30.125, speed_mps: 10 },
      { fraction_of_distance: 0.5001, elapsed_s: 30.126, speed_mps: 10 },
    ];
    const b = Array.from({ length: 505 }, (_, index) => ({
      fraction_of_distance: index / 504, elapsed_s: index + 0.0001, speed_mps: 10,
    }));
    state.ghost = {
      segment: segment(1),
      a: { drive_id: 1, duration_s: 60, series: a },
      b: { drive_id: 2, duration_s: 61, series: b },
      split_deltas: [], winner_drive_id: 1, margin_s: 1,
    };
    renderPage();
    const table = screen.getByRole('table', { name: 'Elapsed time along the route — data table' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(a.length + b.length);
    const cellText = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent);
    for (const [index, point] of a.entries()) {
      expect(cellText(rows[index])).toEqual([`${point.fraction_of_distance * 100}%`, `${point.elapsed_s}s`, '—']);
    }
    for (const [index, point] of b.entries()) {
      expect(cellText(rows[a.length + index])).toEqual([`${point.fraction_of_distance * 100}%`, '—', `${point.elapsed_s}s`]);
    }
    expect(state.ghost.a.series).toEqual(a);
    expect(state.ghost.b.series).toEqual(b);
  });

  it('distinguishes missing and invalid samples from zero and retains every signed fractional gap', () => {
    const inputs = [undefined, null, NaN, Infinity, -Infinity, '', '2', 0, -0, -4, 4, -1.25, 1.25, -0.0001, 0.0001];
    const expected = ['—', '—', '—', '—', '—', '—', '—', '0s', '0s', '−4s', '+4s', '−1.25s', '+1.25s', '−0.0001s', '+0.0001s'];
    state.ghost = {
      segment: segment(1),
      a: { drive_id: 1, duration_s: 60, series: inputs.map((value) => Object.assign(
        { fraction_of_distance: 0.5001, elapsed_s: 0, speed_mps: 0 }, { elapsed_s: value },
      )) },
      b: { drive_id: 2, duration_s: 61, series: [] },
      split_deltas: inputs.map((value) => Object.assign({ fraction: 0.5001, delta_s: 0 }, { delta_s: value })),
      winner_drive_id: 1, margin_s: 1,
    };
    renderPage();
    const elapsed = screen.getByRole('table', { name: 'Elapsed time along the route — data table' });
    const gaps = screen.getByRole('table', { name: 'Time gap (A vs B) — data table' });
    const elapsedRows = within(elapsed).getAllByRole('row').slice(1);
    const gapRows = within(gaps).getAllByRole('row').slice(1);
    expect(elapsedRows).toHaveLength(inputs.length);
    expect(gapRows).toHaveLength(inputs.length);
    expected.forEach((value, index) => {
      expect(within(gapRows[index]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['50.01%', value]);
      expect(within(elapsedRows[index]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
        '50.01%', value.replace(/^\+/, ''), '—',
      ]);
    });
  });

  it('keeps every leaderboard field available on mobile with adjacent 44px race targets and compact desktop restoration', () => {
    state.leaderboardRows = [{
      rank: 1, drive_id: 1, started_at: '2026-10-14T12:00:00Z',
      duration_s: 60, distance_m: 1000, wh_per_km: 150,
      delta_to_best_s: 0, is_pr: true,
    }];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open leaderboard for Route 1' }));
    const table = screen.getByRole('table');
    for (const label of ['#', 'Date', 'Time', 'Wh/km', 'Δ to best', 'Race']) {
      expect(within(table).getByRole('columnheader', { name: label })).not.toHaveClass('hidden');
    }
    for (const cell of within(table).getAllByRole('cell')) {
      expect(cell).not.toHaveClass('hidden');
    }
    const a = within(table).getByRole('button', { name: 'Attempt A · Oct 14 · #1' });
    const b = within(table).getByRole('button', { name: 'Attempt B · Oct 14 · #1' });
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
    const segmentOption = screen.getByRole('button', { name: 'Open leaderboard for Route 1' });
    segmentOption.focus();
    await user.keyboard('{Enter}');
    const efficiency = screen.getByRole('button', { name: 'By efficiency' });
    efficiency.focus();
    await user.keyboard(' ');
    expect(efficiency).toHaveAttribute('aria-pressed', 'true');
    expect(efficiency).toHaveFocus();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('3')).toBeInTheDocument();
    const a = within(rows[0]).getByRole('button', { name: 'Attempt A · Oct 13 · #3' });
    a.focus();
    await user.keyboard('{Enter}');
    expect(a).toHaveAttribute('aria-pressed', 'true');
    expect(a).toHaveFocus();
    await user.tab();
    const b = within(rows[0]).getByRole('button', { name: 'Attempt B · Oct 13 · #3' });
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
