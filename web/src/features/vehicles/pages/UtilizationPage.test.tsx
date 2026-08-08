import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { Drive } from '@/types/driving';
import type { UtilizationSummary } from '../lib/utilization';

const {
  drivesMock,
  formattingMock,
  pageTitleMock,
  rangeMock,
  sectionStateMock,
  selectedVehicleMock,
} = vi.hoisted(() => ({
  drivesMock: vi.fn(),
  formattingMock: vi.fn(),
  pageTitleMock: vi.fn(),
  rangeMock: vi.fn(),
  sectionStateMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string,
      values?: Record<string, unknown>,
    ) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (...args: unknown[]) => drivesMock(...args),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => formattingMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: (...args: unknown[]) => rangeMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: ({
    value,
    triggerTestId,
  }: {
    value: { start: string; end: string };
    triggerTestId: string;
  }) => (
    <div
      data-testid={triggerTestId}
      data-start={value.start}
      data-end={value.end}
    />
  ),
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

vi.mock('../components/utilization', () => {
  type State = {
    isLoading: boolean;
    error: unknown;
    onRetry: () => void;
  };
  type SectionProps = {
    summary: UtilizationSummary;
    state: State;
  };
  const status = (summary: UtilizationSummary, state: State) =>
    state.error
      ? 'error'
      : state.isLoading
        ? 'loading'
        : summary.accounting.eligibleRows === 0
          ? 'empty'
          : 'ready';
  const section = (
    testId: string,
    summary: UtilizationSummary,
    state: State,
  ) => {
    sectionStateMock(testId, state.onRetry);
    return (
      <section
        data-testid={testId}
        data-as-of={summary.window.asOfMs}
        data-start={summary.window.rangeStart}
        data-end={summary.window.rangeEnd}
      >
        {status(summary, state)}
      </section>
    );
  };

  return {
    UtilizationKpis: ({
      summary,
      isLoading,
      error,
      onRetry,
    }: {
      summary: UtilizationSummary;
      isLoading: boolean;
      error: unknown;
      onRetry: () => void;
    }) =>
      section('utilization-kpis', summary, {
        isLoading,
        error,
        onRetry,
      }),
    TimeCostOverview: (props: SectionProps) =>
      section('utilization-time-cost', props.summary, props.state),
    UtilizationTrend: (props: SectionProps) =>
      section('utilization-trend', props.summary, props.state),
    WeekdayProfile: (props: SectionProps) =>
      section('utilization-weekday', props.summary, props.state),
    DriveDistributions: (props: SectionProps) =>
      section(
        'utilization-distributions',
        props.summary,
        props.state,
      ),
    ActiveDayConsistency: (props: SectionProps) =>
      section(
        'utilization-consistency',
        props.summary,
        props.state,
      ),
    BusiestDays: (props: SectionProps) =>
      section('utilization-busiest', props.summary, props.state),
    UtilizationMethodology: (props: SectionProps) =>
      section('utilization-method', props.summary, props.state),
  };
});

import UtilizationPage from './UtilizationPage';

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

function eligibleDrive(): Drive {
  return {
    id: 1,
    vehicleId: 42,
    startTs: '2026-07-10T12:00:00.000Z',
    endTs: '2026-07-10T12:30:00.000Z',
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 75,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: 10,
    maxSpeedMps: 20,
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
  'utilization-kpis',
  'utilization-time-cost',
  'utilization-trend',
  'utilization-weekday',
  'utilization-distributions',
  'utilization-consistency',
  'utilization-busiest',
  'utilization-method',
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-07T18:26:55.198-07:00'));
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  formattingMock.mockReturnValue({ costPerKwh: 0.15 });
  rangeMock.mockReturnValue({
    start: '2026-07-01',
    end: '2026-07-31',
    setRange: vi.fn(),
  });
  drivesMock.mockReturnValue(query({ data: [eligibleDrive()] }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('UtilizationPage', () => {
  it('mounts all sections and sends the selected date scope with the maximum limit', () => {
    render(<UtilizationPage />);

    expect(
      screen.getByRole('heading', { name: 'Utilization' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(drivesMock).toHaveBeenCalledWith('42', {
      start: '2026-07-01',
      end: '2026-07-31',
      limit: 1000,
    });
    expect(screen.getByTestId('utilization-range')).toHaveAttribute(
      'data-start',
      '2026-07-01',
    );
    expect(screen.getByTestId('utilization-range')).toHaveAttribute(
      'data-end',
      '2026-07-31',
    );
    expect(pageTitleMock).toHaveBeenCalledWith('Utilization');

    const retryCallbacks = sectionStateMock.mock.calls.map(
      (call) => call[1],
    );
    expect(new Set(retryCallbacks).size).toBe(1);
  });

  it('threads loading, error, and empty states to every mounted section', () => {
    drivesMock.mockReturnValue(query({ isLoading: true }));
    const view = render(<UtilizationPage />);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }

    drivesMock.mockReturnValue(
      query({
        isError: true,
        error: new Error('drive history unavailable'),
      }),
    );
    view.rerender(<UtilizationPage />);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('error');
    }

    drivesMock.mockReturnValue(query({ data: [] }));
    view.rerender(<UtilizationPage />);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('empty');
    }
  });

  it('updates the server scope when the selected range changes', () => {
    const view = render(<UtilizationPage />);
    rangeMock.mockReturnValue({
      start: '2026-06-01',
      end: '2026-06-30',
      setRange: vi.fn(),
    });

    view.rerender(<UtilizationPage />);

    expect(drivesMock).toHaveBeenLastCalledWith('42', {
      start: '2026-06-01',
      end: '2026-06-30',
      limit: 1000,
    });
    expect(screen.getByTestId('utilization-trend')).toHaveAttribute(
      'data-start',
      '2026-06-01',
    );
    expect(screen.getByTestId('utilization-trend')).toHaveAttribute(
      'data-end',
      '2026-06-30',
    );
  });

  it('freezes the as-of clock for the lifetime of the page mount', () => {
    const view = render(<UtilizationPage />);
    const firstAsOf = screen
      .getByTestId('utilization-kpis')
      .getAttribute('data-as-of');

    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    view.rerender(<UtilizationPage />);

    expect(
      screen
        .getByTestId('utilization-kpis')
        .getAttribute('data-as-of'),
    ).toBe(firstAsOf);
  });

  it('keeps the no-vehicle recovery state and disables the ranged query', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<UtilizationPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Utilization',
    );
    expect(drivesMock).toHaveBeenCalledWith(undefined, {
      start: '2026-07-01',
      end: '2026-07-31',
      limit: 1000,
    });
    expect(
      screen.queryByTestId('utilization-method'),
    ).not.toBeInTheDocument();
  });
});
