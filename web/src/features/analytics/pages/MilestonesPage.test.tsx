import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';
import type { OdometerMilestoneResult } from '../lib/odometerMilestones';

const {
  historyMock,
  pageTitleMock,
  selectedVehicleMock,
  setStoredNumberMock,
  storedNumberMock,
  unitsMock,
} = vi.hoisted(() => ({
  historyMock: vi.fn(),
  pageTitleMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  setStoredNumberMock: vi.fn(),
  storedNumberMock: vi.fn(),
  unitsMock: vi.fn(),
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
  useDriveHistory: (...args: unknown[]) => historyMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useStoredNumber', () => ({
  useStoredNumber: (...args: unknown[]) => storedNumberMock(...args),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
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

vi.mock('../components/odometer-milestones', async () => {
  const { Input } =
    await vi.importActual<typeof import('@/components/ui')>(
      '@/components/ui',
    );
  type State = { isLoading: boolean; error: unknown };
  type SectionProps = {
    summary: OdometerMilestoneResult;
    state: State;
  };
  const status = (state: State, summary: OdometerMilestoneResult) =>
    state.error
      ? 'error'
      : state.isLoading
        ? 'loading'
        : summary.accounting.eligibleRows === 0
          ? 'empty'
          : 'ready';
  const section = (
    testId: string,
    state: State,
    summary: OdometerMilestoneResult,
  ) => (
    <section
      data-testid={testId}
      data-next-km={summary.segment.nextMilestoneKm}
      data-next-display={
        summary.segment.nextMilestoneKm / summary.method.milestoneUnitKm
      }
      data-as-of={summary.asOfMs}
    >
      {status(state, summary)}
    </section>
  );

  return {
    MilestoneControls: (props: {
      baseDisplay: number;
      distanceUnit: string;
      onBaseChange: (value: string) => void;
    }) => (
      <Input
        aria-label="Odometer immediately before the chronologically first eligible returned drive"
        defaultValue={props.baseDisplay}
        onChange={(event) => props.onBaseChange(event.target.value)}
        suffix={props.distanceUnit}
      />
    ),
    MilestoneKpis: (props: {
      summary: OdometerMilestoneResult;
      isLoading: boolean;
      error: unknown;
    }) =>
      section(
        'milestone-kpis',
        { isLoading: props.isLoading, error: props.error },
        props.summary,
      ),
    MilestoneProgress: (props: SectionProps) =>
      section('milestone-progress', props.state, props.summary),
    OdometerGrowthChart: (props: SectionProps) =>
      section('milestone-growth', props.state, props.summary),
    MonthlyDistanceChart: (props: SectionProps) =>
      section('milestone-monthly', props.state, props.summary),
    ReachedMilestones: (props: SectionProps) =>
      section('milestone-reached', props.state, props.summary),
    UpcomingRoadmap: (props: SectionProps) =>
      section('milestone-roadmap', props.state, props.summary),
    PaceForecastScenarios: (props: SectionProps) =>
      section('milestone-scenarios', props.state, props.summary),
    MilestoneMethodology: (props: SectionProps) =>
      section('milestone-method', props.state, props.summary),
  };
});

import MilestonesPage from './MilestonesPage';

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
    startTs: '2026-08-01T12:00:00.000Z',
    endTs: '2026-08-01T12:30:00.000Z',
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
  'milestone-kpis',
  'milestone-progress',
  'milestone-growth',
  'milestone-monthly',
  'milestone-reached',
  'milestone-roadmap',
  'milestone-scenarios',
  'milestone-method',
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-07T17:44:07.751-07:00'));
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  historyMock.mockReturnValue(query({ data: [eligibleDrive()] }));
  storedNumberMock.mockReturnValue([0, setStoredNumberMock]);
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MilestonesPage', () => {
  it('mounts every workspace section and requests the maximum history window', () => {
    render(<MilestonesPage />);

    expect(
      screen.getByRole('heading', { name: 'Odometer Milestones' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(historyMock).toHaveBeenCalledWith('42', 1_000);
    expect(pageTitleMock).toHaveBeenCalledWith('Odometer Milestones');
  });

  it('threads loading, error, and empty states to every mounted section', () => {
    historyMock.mockReturnValue(query({ isLoading: true }));
    const view = render(<MilestonesPage />);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }

    historyMock.mockReturnValue(
      query({ isError: true, error: new Error('unavailable') }),
    );
    view.rerender(<MilestonesPage />);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('error');
    }

    historyMock.mockReturnValue(query({ data: [] }));
    view.rerender(<MilestonesPage />);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('empty');
    }
  });

  it('preserves the no-vehicle recovery state and disables history scope', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<MilestonesPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Odometer Milestones',
    );
    expect(historyMock).toHaveBeenCalledWith(undefined, 1_000);
    expect(screen.queryByTestId('milestone-progress')).not.toBeInTheDocument();
  });

  it('converts mile calibration edits back to canonical kilometres', () => {
    const kmPerMile = 1.609344;
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    storedNumberMock.mockReturnValue([
      10_000 * kmPerMile,
      setStoredNumberMock,
    ]);
    render(<MilestonesPage />);

    const input = screen.getByLabelText(
      'Odometer immediately before the chronologically first eligible returned drive',
    );
    expect(input).toHaveValue('10000');
    expect(screen.getByText('mi')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '12345' } });
    expect(setStoredNumberMock).toHaveBeenCalledOnce();
    expect(setStoredNumberMock.mock.calls[0]?.[0]).toBeCloseTo(
      12_345 * kmPerMile,
      8,
    );
  });

  it.each([
    ['km', 10_000],
    ['mi', 16_093.44],
  ])(
    'keeps the next milestone round in %s at the render boundary',
    (distance, expectedKm) => {
      unitsMock.mockReturnValue({ unitPrefs: { distance } });
      historyMock.mockReturnValue(query({ data: [] }));
      render(<MilestonesPage />);

      const kpis = screen.getByTestId('milestone-kpis');
      expect(Number(kpis.getAttribute('data-next-km'))).toBeCloseTo(
        expectedKm,
        8,
      );
      expect(Number(kpis.getAttribute('data-next-display'))).toBeCloseTo(
        10_000,
        8,
      );
    },
  );

  it('freezes Date.now once for the lifetime of the page mount', () => {
    const view = render(<MilestonesPage />);
    const firstAsOf = screen
      .getByTestId('milestone-kpis')
      .getAttribute('data-as-of');

    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    view.rerender(<MilestonesPage />);

    expect(
      screen.getByTestId('milestone-kpis').getAttribute('data-as-of'),
    ).toBe(firstAsOf);
  });
});
