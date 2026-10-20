import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useRangeState, SHARED_RANGE_STORAGE_KEY } from '@/hooks/useRangeState';
import { deriveDataState } from '@/api/dataState';
import { Button } from '@/components/ui';

const { useHistoryMock, selectedVehicleMock, pageTitleMock } = vi.hoisted(() => ({
  useHistoryMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  pageTitleMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: { year?: number }) =>
      fallback.replace('{{year}}', String(options?.year ?? '')),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveCalendarHistory: (...args: unknown[]) => useHistoryMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('@/components/layout', () => ({
  PageLayout: ({
    title,
    subtitle,
    actions,
    query,
    children,
  }: {
    title: string;
    subtitle?: string;
    actions?: ReactNode;
    query?: unknown;
    children: ReactNode;
  }) => (
    <main data-has-local-actions={Boolean(actions)} data-has-freshness-chip={Boolean(query)}>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </main>
  ),
  Grid: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className} data-testid="calendar-grid">{children}</div>
  ),
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

vi.mock('../components/drive-calendar', () => {
  const status = (props: { isLoading: boolean; error: unknown }) =>
    props.isLoading ? 'loading' : props.error ? 'error' : 'ready';
  return {
    CalendarSummaryCards: (props: {
      isLoading: boolean;
      error: unknown;
      onRetry: () => void;
      calendar: { totalDrives: number; totalDistanceM: number; currentStreak: number; days: unknown[] };
    }) => (
      <section data-testid="calendar-summary" data-drives={props.calendar.totalDrives}
        data-distance-m={props.calendar.totalDistanceM} data-streak={props.calendar.currentStreak}
        data-days={props.calendar.days.length}>{status(props)}
        {props.error ? <Button onClick={props.onRetry}>Retry calendar source</Button> : null}
      </section>
    ),
    DriveCalendarHeatmap: (props: { isLoading: boolean; error: unknown; className?: string }) => (
      <section className={props.className} data-testid="calendar-heatmap">{status(props)}</section>
    ),
    MonthlyActivityChart: (props: { isLoading: boolean; error: unknown }) => (
      <section data-testid="calendar-monthly">{status(props)}</section>
    ),
    WeekdayPatternChart: (props: { isLoading: boolean; error: unknown }) => (
      <section data-testid="calendar-weekdays">{status(props)}</section>
    ),
    RhythmInsightsPanel: (props: { isLoading: boolean; error: unknown }) => (
      <section data-testid="calendar-rhythm">{status(props)}</section>
    ),
    TopDrivingDaysPanel: (props: { isLoading: boolean; error: unknown }) => (
      <section data-testid="calendar-top-days">{status(props)}</section>
    ),
  };
});

import DriveCalendarPage from './DriveCalendarPage';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

const SECTION_IDS = [
  'calendar-summary',
  'calendar-heatmap',
  'calendar-monthly',
  'calendar-weekdays',
  'calendar-rhythm',
  'calendar-top-days',
];

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.search}</span>;
}

function HeaderRangeProbe() {
  const { setRange } = useRangeState();
  return (
    <button type="button" onClick={() => setRange({ start: '2025-01-01', end: '2025-12-31' })}>
      Set header range
    </button>
  );
}

function renderCalendar(path = '/drive-calendar') {
  return render(<MemoryRouter initialEntries={[path]}>
    <DriveCalendarPage />
    <LocationProbe />
    <HeaderRangeProbe />
  </MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.removeItem(SHARED_RANGE_STORAGE_KEY);
  selectedVehicleMock.mockReturnValue({
    vehicleId: 42,
    vehiclesState: deriveDataState({ data: [{ id: 42 }], isSuccess: true }),
  });
  useHistoryMock.mockReturnValue(query());
});

describe('DriveCalendarPage', () => {
  it('keeps every bento section mounted for a resolved empty calendar', () => {
    renderCalendar();

    expect(screen.getByRole('heading', { name: 'Drive calendar' })).toBeInTheDocument();
    expect(screen.getByText('Driving activity and streaks in the selected period')).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useHistoryMock).toHaveBeenCalledWith('42', expect.any(String), expect.any(String));
    expect(screen.queryByRole('button', { name: 'Last 52 weeks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Jump to year' })).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-has-local-actions', 'false');
    expect(screen.getByRole('main')).toHaveAttribute('data-has-freshness-chip', 'false');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-drives', '0');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-distance-m', '0');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry unavailable sources/i })).not.toBeInTheDocument();
  });

  it.each([
    ['/drive-calendar?from=2024-07-01&to=2024-09-30', '2xl:grid-cols-[minmax(min(100%,15rem),max-content)_minmax(0,3fr)_minmax(0,2fr)]', false],
    ['/drive-calendar?from=2024-01-01&to=2024-12-31', 'xl:grid-cols-5', true],
  ])('sizes the selected-period panel for %s without hiding activity sections', (path, columns, fullWidth) => {
    renderCalendar(path);
    const activity = screen.getByRole('region', { name: 'Driving activity' });
    expect(activity.querySelector('[data-testid="calendar-grid"]')).toHaveClass(columns);
    expect(screen.getByTestId('calendar-heatmap')).toHaveClass(fullWidth ? 'xl:col-span-5' : 'min-w-0');
    for (const id of ['calendar-heatmap', 'calendar-monthly', 'calendar-weekdays']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it.each([
    ['loading', query({
      data: undefined, isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching',
    })],
    ['error', query({ data: undefined, isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every independent section', (expected, result) => {
    useHistoryMock.mockReturnValue(result);
    renderCalendar();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
  });

  it('surfaces an initial paused request with recovery without inferring offline or empty results', () => {
    const retry = vi.fn();
    const path = '/drive-calendar?from=2024-07-01&to=2024-09-30';
    useHistoryMock.mockReturnValue(query({
      data: undefined, isPending: true, fetchStatus: 'paused', refetch: retry,
    }));
    const view = renderCalendar(path);

    expect(screen.getByRole('alert')).toHaveTextContent('Refresh paused');
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('loading');
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Drive calendar' }));
    expect(retry).toHaveBeenCalledOnce();

    useHistoryMock.mockReturnValue(query({ isSuccess: true, fetchStatus: 'idle' }));
    view.rerender(<MemoryRouter initialEntries={[path]}><DriveCalendarPage /></MemoryRouter>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-drives', '0');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-distance-m', '0');
  });

  it('retains all six independently mounted sections during a failed history refresh', () => {
    const retry = vi.fn();
    const data = [{ id: 1, startTs: new Date(2024, 6, 1, 9).toISOString(), distanceM: 1000 }];
    useHistoryMock.mockReturnValue(query({
      data, isError: true, error: new Error('refresh unavailable'), refetch: retry,
    }));
    const path = '/drive-calendar?from=2024-07-01&to=2024-09-30';
    const view = renderCalendar(path);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-drives', '1');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-distance-m', '1000');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(useHistoryMock).toHaveBeenCalledWith('42', expect.any(String), expect.any(String));

    useHistoryMock.mockReturnValue(query({ data, isSuccess: true, fetchStatus: 'idle' }));
    view.rerender(<MemoryRouter initialEntries={[path]}><DriveCalendarPage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-distance-m', '1000');
  });

  it('preserves onboarding only for an authoritatively resolved empty fleet', () => {
    selectedVehicleMock.mockReturnValue({
      vehicleId: null,
      vehiclesState: deriveDataState({ data: [], isSuccess: true }, { unavailable: true }),
    });
    renderCalendar();

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Drive calendar');
    expect(screen.queryByTestId('calendar-heatmap')).not.toBeInTheDocument();
    expect(useHistoryMock).toHaveBeenCalledWith(undefined, expect.any(String), expect.any(String));
  });

  it.each(['fetching', 'idle', 'paused'] as const)(
    'keeps unresolved fleet sections loading when the prerequisite is %s, then renders the resolved vehicle',
    (fetchStatus) => {
      const retry = vi.fn();
      selectedVehicleMock.mockReturnValue({
        vehicleId: null,
        vehiclesState: deriveDataState({ isPending: true, fetchStatus, refetch: retry }),
      });
      const view = renderCalendar();
      expect(screen.queryByTestId('no-vehicle')).not.toBeInTheDocument();
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('loading');
      expect(useHistoryMock).toHaveBeenLastCalledWith(undefined, expect.any(String), expect.any(String));
      if (fetchStatus === 'paused') {
        expect(screen.getByRole('alert')).toHaveTextContent('Refresh paused');
        fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Drive calendar' }));
        expect(retry).toHaveBeenCalledOnce();
      }

      selectedVehicleMock.mockReturnValue({
        vehicleId: 42,
        vehiclesState: deriveDataState({ data: [{ id: 42 }], isSuccess: true }),
      });
      useHistoryMock.mockReturnValue(query({
        data: [{ id: 1, startTs: new Date().toISOString(), distanceM: 1000 }],
      }));
      view.rerender(<MemoryRouter><DriveCalendarPage /></MemoryRouter>);
      expect(screen.queryByTestId('no-vehicle')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
      expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-distance-m', '1000');
      expect(useHistoryMock).toHaveBeenLastCalledWith('42', expect.any(String), expect.any(String));
    },
  );

  it('surfaces fatal fleet failure in every section and retries the fleet rather than disabled history', () => {
    const retry = vi.fn();
    const historyRetry = vi.fn();
    selectedVehicleMock.mockReturnValue({
      vehicleId: null,
      vehiclesState: deriveDataState({ isError: true, error: new Error('fleet unavailable'), refetch: retry }),
    });
    useHistoryMock.mockReturnValue(query({ refetch: historyRetry }));
    renderCalendar();

    expect(screen.queryByTestId('no-vehicle')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry calendar source' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(historyRetry).not.toHaveBeenCalled();
  });

  it('does not treat a failed refresh of an empty fleet as confirmed onboarding or empty history', () => {
    selectedVehicleMock.mockReturnValue({
      vehicleId: null,
      vehiclesState: deriveDataState({
        data: [], isError: true, error: new Error('fleet refresh unavailable'),
      }, { unavailable: true }),
    });
    renderCalendar();

    expect(screen.queryByTestId('no-vehicle')).not.toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('loading');
  });

  it.each([42, 84])('consumes the existing resolved URL/store ID %s even before fleet loading succeeds', (vehicleId) => {
    selectedVehicleMock.mockReturnValue({
      vehicleId,
      vehiclesState: deriveDataState({ isError: true, error: new Error('fleet unavailable') }),
    });
    useHistoryMock.mockReturnValue(query({
      data: [{ id: 1, startTs: new Date().toISOString(), distanceM: 2000 }],
    }));
    renderCalendar();

    expect(screen.queryByTestId('no-vehicle')).not.toBeInTheDocument();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-distance-m', '2000');
    expect(useHistoryMock).toHaveBeenCalledWith(String(vehicleId), expect.any(String), expect.any(String));
  });

  it('translates a bookmarked year into shared range URLs and preserves the vehicle parameter', () => {
    renderCalendar('/drive-calendar?year=2024&vehicle_id=42');
    expect(screen.getByTestId('location')).toHaveTextContent('from=2024-01-01');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2024-12-31');
    expect(screen.getByTestId('location')).not.toHaveTextContent('year=');
    const [, start, end] = useHistoryMock.mock.lastCall!;
    expect(new Date(start)).toEqual(new Date(2024, 0, 1));
    expect(new Date(end)).toEqual(new Date(2025, 0, 1));

    fireEvent.click(screen.getByRole('button', { name: 'Set header range' }));
    expect(screen.getByTestId('location')).toHaveTextContent('from=2025-01-01');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2025-12-31');
    expect(screen.getByTestId('location')).toHaveTextContent('vehicle_id=42');
    const [, nextStart, nextEnd] = useHistoryMock.mock.lastCall!;
    expect(new Date(nextStart)).toEqual(new Date(2025, 0, 1));
    expect(new Date(nextEnd)).toEqual(new Date(2026, 0, 1));
  });

  it('uses the calendar default when a bookmarked rolling 24-hour preset is unavailable', () => {
    renderCalendar('/drive-calendar?time_scope=24h');
    const [, start, end] = useHistoryMock.mock.lastCall!;
    expect(Date.now() - new Date(start).getTime()).toBeGreaterThan(6 * 86_400_000);
    expect(Date.now() - new Date(start).getTime()).toBeLessThan(8 * 86_400_000);
    expect(new Date(end).getTime() - Date.now()).toBeGreaterThan(0);
    expect(new Date(end).getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
  });

  it('shows totals from every loaded drive in a year with more than 1,000 sessions', () => {
    useHistoryMock.mockReturnValue(query({
      data: Array.from({ length: 1001 }, (_, id) => ({
        id: id + 1,
        startTs: new Date(2024, 0, 1, 9).toISOString(),
        distanceM: 1000,
      })),
    }));
    renderCalendar('/drive-calendar?from=2024-01-01&to=2024-12-31');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-drives', '1001');
  });

  it('refreshes day bounds and streaks after midnight without changing custom range or raw SI totals', () => {
    vi.useFakeTimers();
    let view: ReturnType<typeof render> | undefined;
    try {
      vi.setSystemTime(new Date(2024, 0, 2, 23, 59));
      useHistoryMock.mockReturnValue(query({
        data: [
          { id: 1, startTs: new Date(2024, 0, 1, 9).toISOString(), distanceM: 1000 },
          { id: 2, startTs: new Date(2024, 0, 2, 9).toISOString(), distanceM: 2000 },
        ],
      }));
      const path = '/drive-calendar?from=2024-01-01&to=2024-12-31&time_scope=custom';
      view = renderCalendar(path);
      expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-days', '3');
      expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-streak', '2');

      for (const [day, days, streak] of [[3, 4, 2], [4, 5, 0]]) {
        vi.setSystemTime(new Date(2024, 0, day!, 0, 1));
        view.rerender(<MemoryRouter initialEntries={[path]}>
          <DriveCalendarPage />
          <LocationProbe />
          <HeaderRangeProbe />
        </MemoryRouter>);
        expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-days', String(days));
        expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-streak', String(streak));
        expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-distance-m', '3000');
        expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-drives', '2');
        expect(screen.getByTestId('location')).toHaveTextContent('time_scope=custom');
        expect(useHistoryMock).toHaveBeenLastCalledWith(
          '42', new Date(2024, 0, 1).toISOString(), new Date(2025, 0, 1).toISOString(),
        );
        for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
      }
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('rejects invalid bookmarked years instead of requesting a misleading calendar', () => {
    renderCalendar('/drive-calendar?year=1800');
    expect(screen.getByText(/Choose a year from 1900/)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('year=1800');
    expect(useHistoryMock).not.toHaveBeenCalled();
  });

  it('prioritizes an explicit global range over a bookmarked year', () => {
    renderCalendar('/drive-calendar?year=2024&from=2026-01-01&to=2026-01-31');
    expect(screen.getByTestId('location')).not.toHaveTextContent('year=');
    const [, start, end] = useHistoryMock.mock.lastCall!;
    expect(new Date(start)).toEqual(new Date(2026, 0, 1));
    expect(new Date(end)).toEqual(new Date(2026, 1, 1));
  });
});
