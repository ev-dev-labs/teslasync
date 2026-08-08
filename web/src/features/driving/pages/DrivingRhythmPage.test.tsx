import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';

const {
  pageTitleMock,
  sectionPropsMock,
  selectedVehicleMock,
  useDrivesMock,
} = vi.hoisted(() => ({
  pageTitleMock: vi.fn(),
  sectionPropsMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  useDrivesMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replaceAll(`{{${name}}}`, String(value)),
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

vi.mock('@/hooks/useRangeState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useRangeState: () => {
      const [range, setRange] = React.useState({
        start: '2025-01-01',
        end: '2026-08-07',
      });
      return {
        ...range,
        timezone: 'America/Los_Angeles',
        setRange,
      };
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
            props.onChange({
              start: '2026-07-01',
              end: '2026-07-31',
            }),
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

vi.mock('../components/driving-rhythm', () => {
  type State = {
    isLoading: boolean;
    error: unknown;
    onRetry: () => void;
  };
  type Summary = { total: number };
  const renderSection = (
    testId: string,
    summary: Summary,
    state: State,
  ) => {
    const status = state.error
      ? 'error'
      : state.isLoading
        ? 'loading'
        : summary.total === 0
          ? 'empty'
          : 'ready';
    sectionPropsMock(testId, { summary, state });
    return <section data-testid={testId}>{status}</section>;
  };

  return {
    DrivingRhythmKpis: (props: Summary & State & { summary: Summary }) =>
      renderSection('driving-rhythm-kpis', props.summary, {
        isLoading: props.isLoading,
        error: props.error,
        onRetry: props.onRetry,
      }),
    WeeklyPunchcard: (props: { summary: Summary; state: State }) =>
      renderSection('driving-rhythm-punchcard', props.summary, props.state),
    HourlyDistribution: (props: { summary: Summary; state: State }) =>
      renderSection('driving-rhythm-hourly', props.summary, props.state),
    WeekdayWeekendComparison: (props: {
      summary: Summary;
      state: State;
    }) =>
      renderSection('driving-rhythm-comparison', props.summary, props.state),
    MonthlyRhythmTrend: (props: { summary: Summary; state: State }) =>
      renderSection('driving-rhythm-monthly', props.summary, props.state),
    DepartureConsistency: (props: { summary: Summary; state: State }) =>
      renderSection('driving-rhythm-consistency', props.summary, props.state),
    StrongestSlots: (props: { summary: Summary; state: State }) =>
      renderSection('driving-rhythm-slots', props.summary, props.state),
    DrivingRhythmMethodology: (props: {
      summary: Summary;
      state: State;
    }) => renderSection('driving-rhythm-method', props.summary, props.state),
  };
});

import DrivingRhythmPage from './DrivingRhythmPage';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
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

function drive(id: number): Drive {
  return {
    id,
    vehicleId: 42,
    startTs: `2025-01-0${id}T08:00:00.000Z`,
    endTs: null,
    durationS: 600,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 1_500,
    regenEnergyWh: null,
    avgSpeedMps: 20,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

const SECTION_IDS = [
  'driving-rhythm-kpis',
  'driving-rhythm-punchcard',
  'driving-rhythm-hourly',
  'driving-rhythm-comparison',
  'driving-rhythm-monthly',
  'driving-rhythm-consistency',
  'driving-rhythm-slots',
  'driving-rhythm-method',
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query({ data: [drive(1)] }));
});

describe('DrivingRhythmPage', () => {
  it('mounts every section and requests the full selected server window', () => {
    render(<DrivingRhythmPage />);

    expect(
      screen.getByRole('heading', { name: 'Driving Rhythm' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', {
      start: '2025-01-01',
      end: '2026-08-07',
      limit: 1000,
    });
    expect(screen.getByTestId('driving-rhythm-range')).toHaveAttribute(
      'data-range',
      '2025-01-01:2026-08-07',
    );
    expect(pageTitleMock).toHaveBeenCalledWith('Driving Rhythm');
  });

  it('preserves RangePicker behavior and re-queries after a scope change', async () => {
    render(<DrivingRhythmPage />);
    fireEvent.click(screen.getByTestId('driving-rhythm-range'));

    await waitFor(() =>
      expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
        start: '2026-07-01',
        end: '2026-07-31',
        limit: 1000,
      }),
    );
  });

  it.each([
    ['loading', query({ isLoading: true })],
    [
      'error',
      query({ isError: true, error: new Error('rhythm unavailable') }),
    ],
  ])('propagates the %s state to every mounted section', (expected, result) => {
    useDrivesMock.mockReturnValue(result);
    render(<DrivingRhythmPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('propagates an empty returned window while keeping every shell mounted', () => {
    useDrivesMock.mockReturnValue(query({ data: [] }));
    render(<DrivingRhythmPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('empty');
    }
  });

  it('shares one retry callback across all error sections', () => {
    const refetch = vi.fn();
    useDrivesMock.mockReturnValue(
      query({
        isError: true,
        error: new Error('offline'),
        refetch,
      }),
    );
    render(<DrivingRhythmPage />);

    const retries = sectionPropsMock.mock.calls.map(
      ([, probe]: [
        string,
        { state: { onRetry: () => void } },
      ]) => probe.state.onRetry,
    );
    expect(new Set(retries).size).toBe(1);
    retries[0]?.();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps no-vehicle recovery and disables the drives query by id', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<DrivingRhythmPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Driving Rhythm',
    );
    expect(useDrivesMock).toHaveBeenCalledWith(undefined, {
      start: '2025-01-01',
      end: '2026-08-07',
      limit: 1000,
    });
    expect(
      screen.queryByTestId('driving-rhythm-punchcard'),
    ).not.toBeInTheDocument();
  });
});
