import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { GhostResponse, LeaderboardRow, SegmentSummary } from '@/api/hooks/useSegments';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  segments: [] as SegmentSummary[],
  selectedIds: [] as Array<number | null>,
  segmentError: null as Error | null,
  leaderboardError: null as Error | null,
  ghost: undefined as GhostResponse | undefined,
  leaderboardRows: [] as LeaderboardRow[],
  chartInputs: [] as unknown[],
  segmentRefetch: vi.fn(),
  leaderboardRefetch: vi.fn(),
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
  ComposedChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    data: { segments: state.segments },
    isLoading: false,
    error: state.segmentError,
    refetch: state.segmentRefetch,
  }),
  useSegmentLeaderboard: (id: number | null) => {
    state.selectedIds.push(id);
    return {
      data: id == null ? undefined : {
        segment: { id, name: `Route ${id}` },
        by_time: state.leaderboardRows,
        by_efficiency: [],
      },
      isLoading: false,
      error: state.leaderboardError,
      refetch: state.leaderboardRefetch,
    };
  },
  useSegmentGhost: () => ({
    data: state.ghost,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
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
    state.ghost = undefined;
    state.leaderboardRows = [];
    state.chartInputs = [];
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
    state.segmentRefetch.mockClear();
    state.leaderboardRefetch.mockClear();
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
});
