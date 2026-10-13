import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';

import type { Drive } from '@/types/driving';
import type { DrivingRhythm } from '../lib/drivingRhythm';

type SectionState = {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
};

type SectionProbe = {
  summary: DrivingRhythm;
  state: SectionState;
  retained?: boolean;
};

const {
  pageTitleMock,
  sectionPropsMock,
  selectedVehicleMock,
  useHistoryMock,
  rangeOptionsMock,
  sharedRange,
  brokenSectionMock,
} = vi.hoisted(() => ({
  pageTitleMock: vi.fn(),
  sectionPropsMock: vi.fn<(id: string, probe: SectionProbe) => void>(),
  selectedVehicleMock: vi.fn(),
  useHistoryMock: vi.fn(),
  rangeOptionsMock: vi.fn(),
  sharedRange: { set: (_range: { start: string; end: string }) => {} },
  brokenSectionMock: vi.fn<(id: string) => void>(),
}));

vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: vi.fn() }));

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
  useDriveCalendarHistory: (...args: unknown[]) => useHistoryMock(...args),
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
    useRangeState: (options: unknown) => {
      rangeOptionsMock(options);
      const [range, setRange] = React.useState({
        start: '2025-01-01',
        end: '2026-08-07',
      });
      sharedRange.set = setRange;
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
  PageLayout: ({
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
  const renderSection = (
    testId: string,
    summary: DrivingRhythm,
    state: State,
    retained?: boolean,
  ) => {
    brokenSectionMock(testId);
    const status = state.error
      ? 'error'
      : state.isLoading
        ? 'loading'
        : summary.total === 0
          ? 'empty'
          : 'ready';
    sectionPropsMock(testId, { summary, state, retained });
    return <section data-testid={testId}>{status}</section>;
  };

  return {
    DrivingRhythmKpis: (props: State & { summary: DrivingRhythm; retained?: boolean }) =>
      renderSection('driving-rhythm-kpis', props.summary, {
        isLoading: props.isLoading,
        error: props.error,
        onRetry: props.onRetry,
      }, props.retained),
    WeeklyPunchcard: (props: { summary: DrivingRhythm; state: State }) =>
      renderSection('driving-rhythm-punchcard', props.summary, props.state),
    HourlyDistribution: (props: { summary: DrivingRhythm; state: State }) =>
      renderSection('driving-rhythm-hourly', props.summary, props.state),
    WeekdayWeekendComparison: (props: {
      summary: DrivingRhythm;
      state: State;
    }) =>
      renderSection('driving-rhythm-comparison', props.summary, props.state),
    MonthlyRhythmTrend: (props: { summary: DrivingRhythm; state: State }) =>
      renderSection('driving-rhythm-monthly', props.summary, props.state),
    DepartureConsistency: (props: { summary: DrivingRhythm; state: State }) =>
      renderSection('driving-rhythm-consistency', props.summary, props.state),
    StrongestSlots: (props: { summary: DrivingRhythm; state: State }) =>
      renderSection('driving-rhythm-slots', props.summary, props.state),
    DrivingRhythmMethodology: (props: {
      summary: DrivingRhythm;
      state: State;
    }) => renderSection('driving-rhythm-method', props.summary, props.state),
  };
});

vi.mock('../components/operationalbrief-a-m/DrivingRhythmBrief', async () => ({
  DrivingRhythmBrief: (await import('../components/driving-rhythm')).DrivingRhythmKpis,
}));

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
  brokenSectionMock.mockReset();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useHistoryMock.mockReturnValue(query({ data: [drive(1)] }));
});

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
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
    expect(useHistoryMock).toHaveBeenCalledWith('42', '2025-01-01', '2026-08-07');
    expect(rangeOptionsMock).toHaveBeenCalledWith({
      persistKey: 'driving-rhythm.range',
      defaultPresetId: 'all',
      inheritSharedPreference: false,
    });
    expect(screen.queryByTestId('driving-rhythm-range')).not.toBeInTheDocument();
    expect(pageTitleMock).toHaveBeenCalledWith('Driving Rhythm');
  });

  it('re-queries after the shared header changes the range without a local picker', async () => {
    render(<DrivingRhythmPage />);
    act(() => sharedRange.set({ start: '2026-07-01', end: '2026-07-31' }));
    expect(screen.queryByTestId('driving-rhythm-range')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(useHistoryMock).toHaveBeenLastCalledWith('42', '2026-07-01', '2026-07-31'),
    );
  });

  it('includes all 1,001 loaded drives rather than truncating the rhythm analysis', () => {
    useHistoryMock.mockReturnValue(query({
      data: Array.from({ length: 1001 }, (_, index) => ({ ...drive(1), id: index + 1 })),
    }));
    render(<DrivingRhythmPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    const summary = sectionPropsMock.mock.calls.find(([id]) => id === 'driving-rhythm-method')?.[1]?.summary;
    expect(summary).toMatchObject({ total: 1001, observed: 1001, historyCapReached: false, windowLimit: null });
  });

  it.each([
    ['loading', query({ data: undefined, isLoading: true })],
    [
      'error',
      query({ data: undefined, isError: true, error: new Error('rhythm unavailable') }),
    ],
  ])('propagates the %s state to every mounted section', (expected, result) => {
    useHistoryMock.mockReturnValue(result);
    render(<DrivingRhythmPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('propagates an empty returned window while keeping every shell mounted', () => {
    useHistoryMock.mockReturnValue(query({ data: [] }));
    render(<DrivingRhythmPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('empty');
    }
  });

  it('shares one retry callback across all error sections', () => {
    const refetch = vi.fn();
    useHistoryMock.mockReturnValue(
      query({
        data: undefined,
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
    expect(useHistoryMock).toHaveBeenCalledWith(undefined, '2025-01-01', '2026-08-07');
    expect(
      screen.queryByTestId('driving-rhythm-punchcard'),
    ).not.toBeInTheDocument();
  });

  it.each(SECTION_IDS)('isolates and retries a render failure in %s without losing neighboring evidence', (failedId) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    brokenSectionMock.mockImplementation((id) => {
      if (id === failedId) throw new Error('Synthetic rhythm widget failure');
    });
    render(<DrivingRhythmPage />);

    expect(screen.queryByTestId(failedId)).not.toBeInTheDocument();
    expect(screen.getByText('Synthetic rhythm widget failure')).toBeInTheDocument();
    for (const id of SECTION_IDS.filter((id) => id !== failedId)) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    brokenSectionMock.mockReset();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useHistoryMock.mock.results[0]?.value.refetch).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });

  it.each([
    { case: 'failed refresh', result: { isError: true, error: new Error('Synthetic refresh failure') } },
    { case: 'paused refresh', result: { fetchStatus: 'paused' } },
  ])('retains historical analysis during $case and exposes source retry', ({ result }) => {
    const refetch = vi.fn();
    useHistoryMock.mockReturnValue(query({ data: [drive(1)], refetch, ...result }));
    render(<DrivingRhythmPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    const brief = sectionPropsMock.mock.calls.find(([id]) => id === 'driving-rhythm-kpis')?.[1];
    expect(brief?.retained).toBe(true);
    expect(brief?.state.error).toBeNull();
    expect(brief?.summary).toMatchObject({ total: 1, totalDistanceM: 10_000, predictability: null });
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/connection lost|paused offline/i)).not.toBeInTheDocument();
  });

  it('preserves local DST grouping, chronological months, SI zero and missing-distance coverage', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-11-03T08:00:00Z'));
    const rows = [
      { ...drive(1), startTs: '2025-11-02T09:30:00Z', distanceM: null },
      { ...drive(2), startTs: '2025-03-09T10:30:00Z', distanceM: 1250 },
      { ...drive(3), startTs: '2025-11-02T08:30:00Z', distanceM: 0 },
      { ...drive(4), startTs: 'invalid', distanceM: 500 },
      { ...drive(5), startTs: '2025-11-04T08:00:00Z', distanceM: 500 },
    ];
    useHistoryMock.mockReturnValue(query({ data: rows }));
    render(<DrivingRhythmPage />);

    const summary = sectionPropsMock.mock.calls.find(([id]) => id === 'driving-rhythm-method')?.[1]?.summary;
    expect(summary).toMatchObject({
      total: 3, observed: 5, excluded: 2, invalidTimestampCount: 1,
      futureTimestampCount: 1, totalDistanceM: 1250, distanceMeasuredDrives: 2,
      invalidDistanceCount: 1, timeZone: 'America/Los_Angeles', predictability: null,
      favorite: { day: 0, hour: 1, count: 2 },
    });
    expect(summary?.matrix[0]?.[1]).toBe(2);
    expect(summary?.matrix[0]?.[3]).toBe(1);
    expect(summary?.monthly.map(({ month, drives }) => ({ month, drives }))).toEqual([
      { month: '2025-03', drives: 1 }, { month: '2025-11', drives: 2 },
    ]);
    expect(summary?.strongestSlots[0]).toMatchObject({
      day: 0, hour: 1, count: 2, distanceM: 0, measuredDistanceDrives: 1, qualified: false,
    });
    expect(rows[0]?.distanceM).toBeNull();
    expect(rows[2]?.distanceM).toBe(0);
  });

  it('keeps the timestamp eligibility clock frozen across shared range changes', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-01-01T08:00:00Z'));
    useHistoryMock.mockReturnValue(query({
      data: [drive(1), { ...drive(2), startTs: '2025-01-01T08:00:01Z' }],
    }));
    render(<DrivingRhythmPage />);
    clock.mockReturnValue(Date.parse('2025-01-03T08:00:00Z'));
    act(() => sharedRange.set({ start: '2025-01-01', end: '2025-01-03' }));
    const summary = sectionPropsMock.mock.calls.filter(([id]) => id === 'driving-rhythm-method').at(-1)?.[1]?.summary;
    expect(summary).toMatchObject({ total: 1, futureTimestampCount: 1, analysisNowMs: Date.parse('2025-01-01T08:00:00Z') });
  });

  it.each([
    { case: 'below predictability floor', count: 4, expected: null },
    { case: 'at predictability floor', count: 5, expected: 100 },
  ])('preserves source-derived scores $case without inventing missing values', ({ count, expected }) => {
    useHistoryMock.mockReturnValue(query({
      data: Array.from({ length: count }, (_, index) => ({
        ...drive(index + 1), startTs: '2025-01-01T08:00:00Z', distanceM: 0,
      })),
    }));
    render(<DrivingRhythmPage />);
    const summary = sectionPropsMock.mock.calls.find(([id]) => id === 'driving-rhythm-method')?.[1]?.summary;
    expect(summary?.predictability).toBe(expected);
    expect(summary?.monthly[0]?.predictability).toBe(expected);
    expect(summary?.dayProfiles.find(({ day }) => day === 3)).toMatchObject({
      drives: count, medianDepartureMinute: 0, consistencyDeviationS: 0, consistencySupported: true,
    });
    expect(summary?.dayProfiles.find(({ day }) => day === 1)).toMatchObject({
      drives: 0, medianDepartureMinute: null, consistencyDeviationS: null, consistencySupported: false,
    });
    expect(summary?.strongestSlots[0]).toMatchObject({ count, qualified: true, distanceM: 0, measuredDistanceDrives: count });
  });
});
