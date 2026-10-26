import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';
import type { OdometerMilestoneResult } from '../lib/odometerMilestones';

const {
  historyMock,
  datePreferences,
  pageTitleMock,
  selectedVehicleMock,
  setStoredNumberMock,
  storedNumberMock,
  unitsMock,
} = vi.hoisted(() => ({
  historyMock: vi.fn(),
  datePreferences: { tz: 'UTC' },
  pageTitleMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  setStoredNumberMock: vi.fn(),
  storedNumberMock: vi.fn(),
  unitsMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | Record<string, unknown>, values?: Record<string, unknown>) =>
      Object.entries(values ?? (typeof fallback === 'string' ? {} : fallback)).reduce(
        (text, [name, value]) =>
          text.replaceAll(`{{${name}}}`, String(value)),
        typeof fallback === 'string' ? fallback : String(fallback.defaultValue ?? _key),
      ),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: (...args: unknown[]) => historyMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ tz: datePreferences.tz }),
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
  PageLayout: ({
    title,
    subtitle,
    contextActions,
    children,
  }: {
    title: string;
    subtitle: string;
    contextActions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {contextActions}
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
  const { MilestoneControls } = await vi.importActual<
    typeof import('../components/odometer-milestones/MilestoneControls')
  >('../components/odometer-milestones/MilestoneControls');
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
      data-base-km={summary.baseOdometerKm}
      data-current-km={summary.currentOdometerKm}
      data-months={summary.monthly.map(month => month.month).join(',')}
    >
      {status(state, summary)}
    </section>
  );

  return {
    MilestoneControls,
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

vi.mock('../components/operationalbrief-a-m/MilestoneBrief', async () => {
  const { MilestoneKpis } = await import('../components/odometer-milestones');
  return { MilestoneBrief: MilestoneKpis };
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
  datePreferences.tz = 'UTC';
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
  it('recomputes selected-zone months without changing the frozen clock, raw rows or calibration owner', () => {
    const rows = [{ ...eligibleDrive(), startTs: '2026-08-01T00:30:00Z' }];
    const original = JSON.stringify(rows);
    historyMock.mockReturnValue(query({ data: rows }));
    const view = render(<MilestonesPage />);
    const monthly = screen.getByTestId('milestone-monthly');
    const asOf = monthly.getAttribute('data-as-of');
    const calibrationKey = storedNumberMock.mock.calls[0][0];
    expect(monthly).toHaveAttribute('data-months', '2026-08');
    datePreferences.tz = 'America/Los_Angeles';
    view.rerender(<MilestonesPage />);
    expect(monthly).toHaveAttribute('data-months', '2026-07');
    expect(monthly).toHaveAttribute('data-current-km', '10');
    expect(monthly).toHaveAttribute('data-as-of', asOf);
    expect(storedNumberMock).toHaveBeenNthCalledWith(3, calibrationKey, 0);
    expect(historyMock).toHaveBeenLastCalledWith('42', 1000);
    expect(JSON.stringify(rows)).toBe(original);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
  });

  it('mounts every workspace section and requests the maximum history window', () => {
    render(<MilestonesPage />);

    expect(
      screen.getByRole('heading', { name: 'Odometer milestones' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(historyMock).toHaveBeenCalledWith('42', 1_000);
    expect(pageTitleMock).toHaveBeenCalledWith('Odometer milestones');
  });

  it('threads loading, error, and empty states to every mounted section', () => {
    historyMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    const view = render(<MilestonesPage />);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('loading');
    }

    historyMock.mockReturnValue(
      query({ data: undefined, isError: true, error: new Error('unavailable') }),
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

  it('retains calibration, eight sections and frozen as-of evidence after a failed refresh', () => {
    const retry = vi.fn();
    const drives = [eligibleDrive()];
    historyMock.mockReturnValue(query({
      data: drives, isError: true, error: new Error('refresh unavailable'), refetch: retry,
    }));
    render(<MilestonesPage />);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(historyMock).toHaveBeenCalledWith('42', 1_000);
    expect(drives[0].distanceM).toBe(10_000);
  });

  it('preserves the no-vehicle recovery state and disables history scope', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<MilestonesPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Odometer milestones',
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
    expect(input).toHaveValue(10000);
    expect(screen.getByText('mi')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '12345' } });
    fireEvent.blur(input);
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

  it.each([
    { name: 'kilometre ladder limit', distance: 'km', rejected: '1000000000', expectedKm: 12_345 },
    { name: 'mile ladder limit', distance: 'mi', rejected: '1000000000', expectedKm: 19_867.35168 },
    { name: 'mile conversion overflow', distance: 'mi', rejected: String(Number.MAX_VALUE), expectedKm: 19_867.35168 },
  ])('rejects $name before saving and recovers after a valid edit', ({ distance, rejected, expectedKm }) => {
    unitsMock.mockReturnValue({ unitPrefs: { distance } });
    render(<MilestonesPage />);

    const input = screen.getByLabelText(
      'Odometer immediately before the chronologically first eligible returned drive',
    );
    const initialThreshold = screen.getByTestId('milestone-progress')
      .getAttribute('data-next-km');
    const initialAsOf = screen.getByTestId('milestone-progress')
      .getAttribute('data-as-of');

    fireEvent.change(input, { target: { value: rejected } });
    fireEvent.blur(input);

    expect(setStoredNumberMock).not.toHaveBeenCalled();
    expect(storedNumberMock).toHaveBeenCalledWith(
      'teslasync:milestones-base-km:v2:vehicle:42:origin:1785585600000:1', 0,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid number');
    expect(screen.getByRole('group', { name: 'Window-start odometer' })).toContainElement(input);
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
      expect(screen.getByTestId(id)).toHaveAttribute('data-next-km', initialThreshold);
      expect(screen.getByTestId(id)).toHaveAttribute('data-as-of', initialAsOf);
    }

    fireEvent.change(input, { target: { value: '12345' } });
    fireEvent.blur(input);

    expect(setStoredNumberMock).toHaveBeenCalledOnce();
    expect(setStoredNumberMock.mock.calls[0]?.[0]).toBeCloseTo(expectedKm, 8);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(historyMock).toHaveBeenCalledWith('42', 1_000);
  });
});

describe('MilestonesPage persisted calibration contract', () => {
  const inputName = 'Odometer immediately before the chronologically first eligible returned drive';
  const firstKey = 'teslasync:milestones-base-km:v2:vehicle:42:origin:1785585600000:1';

  beforeEach(async () => {
    localStorage.clear();
    const { useStoredNumber } = await vi.importActual<
      typeof import('@/hooks/useStoredNumber')
    >('@/hooks/useStoredNumber');
    storedNumberMock.mockImplementation(useStoredNumber);
  });

  afterEach(() => {
    localStorage.clear();
    storedNumberMock.mockReset();
  });

  it('keeps the global saved value unassigned and recoverable without inventing its owner', () => {
    localStorage.setItem('teslasync:milestones-base-km:v1', '12345.678901234');
    render(<MilestonesPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('without a vehicle or history-window assignment');
    expect(screen.getByText('12345.678901234')).toBeInTheDocument();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('error');
    const input = screen.getByRole('spinbutton', { name: inputName });
    expect(input).toHaveValue(null);
    fireEvent.change(input, { target: { value: '9876.54321' } });
    fireEvent.blur(input);
    expect(localStorage.getItem(firstKey)).toBe('9876.54321');
    expect(localStorage.getItem('teslasync:milestones-base-km:v1')).toBe('12345.678901234');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
  });

  it('isolates vehicles, changed eligible origins, and restores exact saved calibration on return', () => {
    localStorage.setItem(firstKey, '12345.678901234');
    const view = render(<MilestonesPage />);
    expect(screen.getByTestId('milestone-progress')).toHaveAttribute('data-base-km', '12345.678901234');
    const input = screen.getByRole('spinbutton', { name: inputName });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(localStorage.getItem(firstKey)).toBe('12345.678901234');
    selectedVehicleMock.mockReturnValue({ vehicleId: 43 });
    historyMock.mockReturnValue(query({ data: [{ ...eligibleDrive(), vehicleId: 43, id: 2 }] }));
    view.rerender(<MilestonesPage />);
    expect(screen.getByRole('spinbutton', { name: inputName })).toHaveValue(0);
    expect(screen.getByTestId('milestone-progress')).toHaveAttribute('data-base-km', '0');
    selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
    historyMock.mockReturnValue(query({ data: [{ ...eligibleDrive(), id: 3, startTs: '2026-08-02T12:00:00.000Z' }] }));
    view.rerender(<MilestonesPage />);
    expect(screen.getByTestId('milestone-progress')).toHaveAttribute('data-base-km', '0');
    historyMock.mockReturnValue(query({ data: [eligibleDrive()] }));
    view.rerender(<MilestonesPage />);
    expect(screen.getByRole('spinbutton', { name: inputName })).toHaveValue(12345.678901234);
  });

  it.each(['1000000000', '-1', 'Infinity', 'not-a-number', ''])(
    'preserves invalid stored %j, shows recovery, and accepts a valid replacement',
    (raw) => {
      localStorage.setItem(firstKey, raw);
      render(<MilestonesPage />);
      expect(screen.getByRole('alert')).toHaveTextContent('saved calibration cannot be used');
      expect(localStorage.getItem(firstKey)).toBe(raw);
      const input = screen.getByRole('spinbutton', { name: inputName });
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent('saved calibration');
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('error');
      fireEvent.change(input, { target: { value: '321.987654' } });
      fireEvent.blur(input);
      expect(localStorage.getItem(firstKey)).toBe('321.987654');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    },
  );

  it('validates cross-tab commits, preserves rejected drafts, and synchronizes external recovery', () => {
    localStorage.setItem(firstKey, '456.789');
    render(<MilestonesPage />);
    const input = screen.getByRole('spinbutton', { name: inputName });
    fireEvent.change(input, { target: { value: '1000000000' } });
    fireEvent.blur(input);
    expect(input).toHaveValue(1000000000);
    expect(screen.getByTestId('milestone-progress')).toHaveAttribute('data-base-km', '456.789');
    fireEvent(window, new StorageEvent('storage', { key: firstKey, newValue: '1000000000' }));
    expect(screen.getByRole('alert')).toHaveTextContent('saved calibration cannot be used');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('error');
    fireEvent(window, new StorageEvent('storage', { key: firstKey, newValue: '789.1234567' }));
    expect(input).toHaveValue(789.1234567);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('milestone-progress')).toHaveAttribute('data-base-km', '789.1234567');
  });

  it('anchors only to the model-admitted first drive and never writes an unresolved source', () => {
    const excluded = { ...eligibleDrive(), id: 0, startTs: '2020-01-01T00:00:00Z', distanceM: 0 };
    historyMock.mockReturnValue(query({ data: [excluded, eligibleDrive()] }));
    const view = render(<MilestonesPage />);
    fireEvent.change(screen.getByRole('spinbutton', { name: inputName }), { target: { value: '123.456' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: inputName }));
    expect(localStorage.getItem(firstKey)).toBe('123.456');
    historyMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    view.rerender(<MilestonesPage />);
    expect(screen.getByRole('spinbutton', { name: inputName })).toBeDisabled();
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('loading');
    expect(localStorage.getItem(firstKey)).toBe('123.456');
  });
});
