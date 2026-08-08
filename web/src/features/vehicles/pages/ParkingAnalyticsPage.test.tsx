import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { Drive } from '@/types/driving';

const {
  useDrivesMock,
  selectedVehicleMock,
  pageTitleMock,
  summarizeParkingMock,
} = vi.hoisted(() => ({
  useDrivesMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  pageTitleMock: vi.fn(),
  summarizeParkingMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replace(new RegExp(`{{${name}}}`, 'g'), String(value)),
        fallback,
      ),
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

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ tz: 'America/Los_Angeles' }),
}));

vi.mock('@/hooks/useRangeState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useRangeState: () => {
      const [range, setRange] = React.useState({
        start: '2026-07-01',
        end: '2026-08-07',
      });
      return { ...range, setRange };
    },
  };
});

vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: () =>
      React.createElement('div', { 'data-testid': 'vehicle-select' }),
    RangePicker: (props: {
      value: { start: string; end: string };
      onChange: (range: { start: string; end: string }) => void;
      triggerTestId?: string;
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': props.triggerTestId,
          'data-range': `${props.value.start}:${props.value.end}`,
          onClick: () =>
            props.onChange({ start: '2026-07-10', end: '2026-07-31' }),
        },
        'range',
      ),
  };
});

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

vi.mock('../components/parking-analytics', () => {
  interface State {
    isLoading: boolean;
    error: unknown;
  }
  const status = (state: State) =>
    state.isLoading ? 'loading' : state.error ? 'error' : 'ready';
  const section = (testId: string, state: State) => (
    <section data-testid={testId}>{status(state)}</section>
  );
  return {
    ParkingKpiBand: (props: State) => section('parking-kpis', props),
    DurationDistributionChart: (props: { state: State }) =>
      section('parking-duration', props.state),
    ParkingTemporalProfile: (props: { state: State }) =>
      section('parking-temporal', props.state),
    MonthlyDwellTrend: (props: { state: State }) =>
      section('parking-monthly', props.state),
    TopParkingLocations: (props: { state: State }) =>
      section('parking-locations', props.state),
    LongestParkingStints: (props: { state: State }) =>
      section('parking-longest', props.state),
    OvernightParkingContext: (props: { state: State }) =>
      section('parking-overnight', props.state),
    ParkingCoverageMethodology: (props: { state: State }) =>
      section('parking-coverage', props.state),
  };
});

vi.mock('../lib/parkingDwell', async () => {
  const actual = await vi.importActual<
    typeof import('../lib/parkingDwell')
  >('../lib/parkingDwell');
  summarizeParkingMock.mockImplementation(actual.summarizeParking);
  return {
    ...actual,
    summarizeParking: summarizeParkingMock,
  };
});

import type { SummarizeParkingOptions } from '../lib/parkingDwell';
import ParkingAnalyticsPage from './ParkingAnalyticsPage';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [] as Drive[],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    ...overrides,
  };
}

const SECTION_IDS = [
  'parking-kpis',
  'parking-duration',
  'parking-temporal',
  'parking-monthly',
  'parking-locations',
  'parking-longest',
  'parking-overnight',
  'parking-coverage',
];

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ParkingAnalyticsPage', () => {
  it('mounts all eight sections and requests the selected server window', () => {
    render(<ParkingAnalyticsPage />);

    expect(
      screen.getByRole('heading', { name: 'Parking Analytics' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', {
      start: '2026-07-01',
      end: '2026-08-07',
      limit: 1_000,
    });
  });

  it('passes newly selected dates and the 1,000-row cap to the hook', async () => {
    render(<ParkingAnalyticsPage />);
    fireEvent.click(screen.getByTestId('parking-analytics-range'));

    await waitFor(() =>
      expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
        start: '2026-07-10',
        end: '2026-07-31',
        limit: 1_000,
      }),
    );
  });

  it.each([
    ['loading', query({ isLoading: true })],
    ['error', query({ isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every mounted section', (expected, result) => {
    useDrivesMock.mockReturnValue(result);
    render(<ParkingAnalyticsPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('freezes the page clock across range-driven render cycles', async () => {
    const frozenNow = Date.parse('2026-08-07T20:00:00.000Z');
    const laterNow = frozenNow + 6 * 3_600_000;
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(frozenNow)
      .mockReturnValue(laterNow);

    render(<ParkingAnalyticsPage />);
    fireEvent.click(screen.getByTestId('parking-analytics-range'));
    await waitFor(() => expect(summarizeParkingMock).toHaveBeenCalledTimes(2));

    const modelOptions = summarizeParkingMock.mock.calls.map(
      (call) => call[1] as SummarizeParkingOptions,
    );
    expect(modelOptions.map((model) => model.nowMs)).toEqual([
      frozenNow,
      frozenNow,
    ]);
    expect(modelOptions[1]).toMatchObject({
      rangeStart: '2026-07-10',
      rangeEnd: '2026-07-31',
      timeZone: 'America/Los_Angeles',
      rowLimit: 1_000,
    });
  });

  it('preserves the no-vehicle selection state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<ParkingAnalyticsPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Parking Analytics',
    );
    expect(screen.queryByTestId('parking-duration')).not.toBeInTheDocument();
  });
});
