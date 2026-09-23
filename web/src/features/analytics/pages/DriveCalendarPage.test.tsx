import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

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

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/layout', () => ({
  PageContainer: ({
    title,
    subtitle,
    actions,
    children,
  }: {
    title: string;
    subtitle: string;
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
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

function renderCalendar(path = '/drive-calendar') {
  return render(<MemoryRouter initialEntries={[path]}>
    <DriveCalendarPage />
    <LocationProbe />
  </MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useHistoryMock.mockReturnValue(query());
});

describe('DriveCalendarPage', () => {
  it('keeps every bento section mounted for a resolved empty calendar', () => {
    renderCalendar();

    expect(screen.getByRole('heading', { name: 'Drive Calendar' })).toBeInTheDocument();
    expect(screen.getByText('A year of driving at a glance, with streaks')).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useHistoryMock).toHaveBeenCalledWith('42', expect.any(String), expect.any(String));
    expect(screen.getByRole('button', { name: 'Last 52 weeks' })).toBeInTheDocument();
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

  it('loads a selected previous year, preserves other URL parameters, and steps between years', () => {
    renderCalendar('/drive-calendar?year=2024&vehicle_id=42');
    expect(screen.getByTestId('calendar-heatmap')).toHaveAttribute('data-year', '2024');
    const [, start, end] = useHistoryMock.mock.lastCall!;
    expect(new Date(start)).toEqual(new Date(2024, 0, 1));
    expect(new Date(end)).toEqual(new Date(2025, 0, 1));

    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(screen.getByTestId('location')).toHaveTextContent('year=2025');
    expect(screen.getByTestId('location')).toHaveTextContent('vehicle_id=42');
    expect(screen.getByTestId('calendar-heatmap')).toHaveAttribute('data-year', '2025');

    fireEvent.click(screen.getByRole('button', { name: 'Last 52 weeks' }));
    expect(screen.getByTestId('location')).not.toHaveTextContent('year=');
    expect(screen.getByTestId('location')).toHaveTextContent('vehicle_id=42');
  });

  it('jumps straight to an older year without scrolling through a year list', () => {
    renderCalendar();
    const yearInput = screen.getByRole('spinbutton', { name: 'Jump to year' });
    fireEvent.change(yearInput, { target: { value: '2014' } });
    fireEvent.blur(yearInput);
    expect(screen.getByTestId('location')).toHaveTextContent('year=2014');
    expect(screen.getByTestId('calendar-heatmap')).toHaveAttribute('data-year', '2014');
  });

  it('shows totals from every loaded drive in a year with more than 1,000 sessions', () => {
    useHistoryMock.mockReturnValue(query({
      data: Array.from({ length: 1001 }, (_, id) => ({
        id: id + 1,
        startTs: new Date(2024, 0, 1, 9).toISOString(),
        distanceM: 1000,
      })),
    }));
    renderCalendar('/drive-calendar?year=2024');
    expect(screen.getByTestId('calendar-summary')).toHaveAttribute('data-drives', '1001');
  });

  it('rejects out-of-range years instead of requesting a misleading empty calendar', () => {
    renderCalendar();
    const yearInput = screen.getByRole('spinbutton', { name: 'Jump to year' });
    fireEvent.change(yearInput, { target: { value: '1800' } });
    fireEvent.blur(yearInput);
    expect(yearInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a year from 1900');
    expect(screen.getByTestId('location')).not.toHaveTextContent('year=');
  });
});
