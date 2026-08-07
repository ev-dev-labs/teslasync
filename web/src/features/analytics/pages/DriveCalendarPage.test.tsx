import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const { useDrivesMock, selectedVehicleMock, pageTitleMock } = vi.hoisted(() => ({
  useDrivesMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  pageTitleMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (...args: unknown[]) => useDrivesMock(...args),
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
    CalendarSummaryCards: (props: { isLoading: boolean; error: unknown }) => (
      <section data-testid="calendar-summary">{status(props)}</section>
    ),
    DriveCalendarHeatmap: (props: { isLoading: boolean; error: unknown }) => (
      <section data-testid="calendar-heatmap">{status(props)}</section>
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

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query());
});

describe('DriveCalendarPage', () => {
  it('keeps every bento section mounted for a resolved empty calendar', () => {
    render(<DriveCalendarPage />);

    expect(screen.getByRole('heading', { name: 'Drive Calendar' })).toBeInTheDocument();
    expect(screen.getByText('A year of driving at a glance, with streaks')).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', { limit: 1000 });
  });

  it.each([
    ['loading', query({ isLoading: true })],
    ['error', query({ isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every independent section', (expected, result) => {
    useDrivesMock.mockReturnValue(result);
    render(<DriveCalendarPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('preserves the no-vehicle selection state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<DriveCalendarPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Drive Calendar');
    expect(screen.queryByTestId('calendar-heatmap')).not.toBeInTheDocument();
  });
});
