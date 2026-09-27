import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useRangeState, SHARED_RANGE_STORAGE_KEY } from '@/hooks/useRangeState';

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

vi.mock('@/components/layout', () => ({
  PageContainer: ({
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
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    CalendarSummaryCards: (props: { isLoading: boolean; error: unknown; calendar: { totalDrives: number } }) => (
      <section data-testid="calendar-summary" data-drives={props.calendar.totalDrives}>{status(props)}</section>
    ),
    DriveCalendarHeatmap: (props: { isLoading: boolean; error: unknown; year: number | null }) => (
      <section data-testid="calendar-heatmap" data-year={props.year}>{status(props)}</section>
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
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useHistoryMock.mockReturnValue(query());
});

describe('DriveCalendarPage', () => {
  it('keeps every bento section mounted for a resolved empty calendar', () => {
    renderCalendar();

    expect(screen.getByRole('heading', { name: 'Drive Calendar' })).toBeInTheDocument();
    expect(screen.getByText('Driving activity and streaks in the selected period')).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useHistoryMock).toHaveBeenCalledWith('42', expect.any(String), expect.any(String));
    expect(screen.queryByRole('button', { name: 'Last 52 weeks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Jump to year' })).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-has-local-actions', 'false');
    expect(screen.getByRole('main')).toHaveAttribute('data-has-freshness-chip', 'false');
  });

  it.each([
    ['loading', query({ isLoading: true })],
    ['error', query({ isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every independent section', (expected, result) => {
    useHistoryMock.mockReturnValue(result);
    renderCalendar();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('preserves the no-vehicle selection state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    renderCalendar();

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Drive Calendar');
    expect(screen.queryByTestId('calendar-heatmap')).not.toBeInTheDocument();
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

  it('uses the precise rolling bounds for the shared last-24-hours preset', () => {
    renderCalendar('/drive-calendar?time_scope=24h');
    const [, start, end] = useHistoryMock.mock.lastCall!;
    expect(Date.now() - new Date(start).getTime()).toBeGreaterThanOrEqual(86_390_000);
    expect(Date.now() - new Date(start).getTime()).toBeLessThan(86_410_000);
    expect(Math.abs(Date.now() - new Date(end).getTime())).toBeLessThan(10_000);
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
