import type { ChangeEvent, ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drive } from '@/types/driving';
import type { TargetSummary } from '../lib/efficiencyTarget';

const {
  historyMock,
  pageTitleMock,
  selectedVehicleMock,
  setStoredNumberMock,
  storedNumberMock,
  unitsMock,
  pulseRenderMock,
} = vi.hoisted(() => ({
  historyMock: vi.fn(),
  pageTitleMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  setStoredNumberMock: vi.fn(),
  storedNumberMock: vi.fn(),
  unitsMock: vi.fn(),
  pulseRenderMock: vi.fn(),
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

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/ui', () => ({
  Input: ({
    'aria-label': ariaLabel,
    value,
    label,
    error,
    hint,
    onChange,
    suffix,
  }: {
    'aria-label': string;
    value: string;
    label: string;
    error?: string;
    hint?: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    suffix: ReactNode;
  }) => (
    <label>
      {label}
      <input
        aria-label={ariaLabel}
        aria-invalid={error ? 'true' : undefined}
        value={value}
        onChange={onChange}
      />
      {suffix}
      {error && <span role="alert">{error}</span>}
      {hint && <span>{hint}</span>}
    </label>
  ),
  Caption: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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

vi.mock('../components/efficiency-target', () => {
  type State = { isLoading: boolean; error: unknown };
  const status = (state: State) =>
    state.error ? 'error' : state.isLoading ? 'loading' : 'ready';
  const section = (testId: string, state: State, target?: number) => (
    <section data-testid={testId} data-target={target}>
      {status(state)}
    </section>
  );

  return {
    EfficiencyTargetKpis: (props: {
      state: State;
      targetWhPerKm: number;
      retained: boolean;
    }) =>
      <div data-testid="target-trust" data-retained={props.retained}>
        {section('efficiency-target-kpis', props.state, props.targetWhPerKm)}
      </div>,
    GoalPulse: (props: { state: State; summary: TargetSummary }) => {
      pulseRenderMock();
      return (
        <section data-testid="efficiency-target-pulse">
          {status(props.state)}
          <output aria-label="Observed consumption">{props.summary.overallWhPerKm ?? 'unknown'}</output>
          <output aria-label="Completed weeks">{props.summary.completedWeeks.length}</output>
          <output aria-label="Active consumption">{props.summary.activeWeek?.whPerKm ?? 'unknown'}</output>
          <output aria-label="Completed target gap">{props.summary.latestCompletedWeek?.targetGapWhPerKm ?? 'unknown'}</output>
          <output aria-label="Eligible drives">{props.summary.analyzed}</output>
        </section>
      );
    },
    TargetConsistencyChart: (props: { state: State }) =>
      section('efficiency-target-consistency', props.state),
    WeeklyTargetChart: (props: {
      state: State;
      targetWhPerKm: number;
    }) =>
      section(
        'efficiency-target-weekly',
        props.state,
        props.targetWhPerKm,
      ),
    WeekdayEfficiencyChart: (props: { state: State }) =>
      section('efficiency-target-weekday', props.state),
    RecentWeekScorecard: (props: { state: State }) =>
      section('efficiency-target-scorecard', props.state),
    TargetMethodology: (props: { state: State }) =>
      section('efficiency-target-method', props.state),
  };
});

vi.mock('../components/operationalbrief-a-m/EfficiencyTargetBrief', async () => ({
  EfficiencyTargetBrief: (await import('../components/efficiency-target')).EfficiencyTargetKpis,
}));

import EfficiencyTargetPage from './EfficiencyTargetPage';

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

function drive(startTs: string, distanceM: number, energyUsedWh: number | null): Drive {
  return {
    id: 1,
    vehicleId: 42,
    startTs,
    endTs: startTs,
    durationS: 600,
    distanceM,
    energyUsedWh,
    regenEnergyWh: null,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: null,
    endBatteryPct: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: startTs,
    updatedAt: startTs,
  };
}

const SECTION_IDS = [
  'efficiency-target-kpis',
  'efficiency-target-pulse',
  'efficiency-target-consistency',
  'efficiency-target-weekly',
  'efficiency-target-weekday',
  'efficiency-target-scorecard',
  'efficiency-target-method',
];

beforeEach(() => {
  vi.clearAllMocks();
  pulseRenderMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 7, 12));
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  historyMock.mockReturnValue(query());
  storedNumberMock.mockReturnValue([160, setStoredNumberMock]);
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EfficiencyTargetPage', () => {
  it('mounts every workspace section and requests the maximum history window', () => {
    render(<EfficiencyTargetPage />);

    expect(
      screen.getByRole('heading', { name: 'Efficiency Target' }),
    ).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(historyMock).toHaveBeenCalledWith('42', 1000);
    expect(pageTitleMock).toHaveBeenCalledWith('Efficiency Target');
  });

  it.each([
    ['loading', query({ data: undefined, isLoading: true })],
    ['error', query({ data: undefined, isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every mounted section', (expected, result) => {
    historyMock.mockReturnValue(result);
    render(<EfficiencyTargetPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('preserves the no-vehicle recovery state and disables history scope', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<EfficiencyTargetPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent(
      'Efficiency Target',
    );
    expect(historyMock).toHaveBeenCalledWith(undefined, 1000);
    expect(
      screen.queryByTestId('efficiency-target-weekly'),
    ).not.toBeInTheDocument();
  });

  it('renders miles at the boundary and persists edits back in Wh/km', () => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    render(<EfficiencyTargetPage />);

    const input = screen.getByLabelText('Weekly consumption target');
    expect(input).toHaveValue('257');
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(screen.getByTestId('efficiency-target-kpis')).toHaveAttribute(
      'data-target',
      '160',
    );

    fireEvent.change(input, { target: { value: '300' } });
    expect(setStoredNumberMock).toHaveBeenCalledOnce();
    expect(setStoredNumberMock.mock.calls[0]?.[0]).toBeCloseTo(
      300 / 1.609344,
      8,
    );
  });

  it('synchronizes external saved targets and unit changes without persisting a display conversion', () => {
    const { rerender } = render(<EfficiencyTargetPage />);
    const input = screen.getByLabelText('Weekly consumption target');
    expect(input).toHaveValue('160');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid number');

    storedNumberMock.mockReturnValue([200, setStoredNumberMock]);
    rerender(<EfficiencyTargetPage />);
    expect(input).toHaveValue('200');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('efficiency-target-weekly')).toHaveAttribute('data-target', '200');

    unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    rerender(<EfficiencyTargetPage />);
    expect(input).toHaveValue('322');
    expect(screen.getByText('Wh/mi')).toBeInTheDocument();
    expect(setStoredNumberMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'empty draft', text: '' },
    { name: 'zero draft', text: '0' },
    { name: 'negative draft', text: '-5' },
    { name: 'nonfinite draft', text: 'Infinity' },
  ])('retains the saved goal and exposes validation for $name', ({ text }) => {
    render(<EfficiencyTargetPage />);
    const input = screen.getByLabelText('Weekly consumption target');
    fireEvent.change(input, { target: { value: text } });

    expect(input).toHaveValue(text);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid number');
    expect(setStoredNumberMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('efficiency-target-weekly')).toHaveAttribute('data-target', '160');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
  });

  it('commits a positive target without rounding its canonical goal', () => {
    const { rerender } = render(<EfficiencyTargetPage />);
    const input = screen.getByLabelText('Weekly consumption target');
    fireEvent.change(input, { target: { value: '165.5' } });
    expect(setStoredNumberMock).toHaveBeenCalledWith(165.5);
    storedNumberMock.mockReturnValue([165.5, setStoredNumberMock]);
    rerender(<EfficiencyTargetPage />);
    expect(input).toHaveValue('165.5');
    expect(screen.getByTestId('efficiency-target-weekly')).toHaveAttribute('data-target', '165.5');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps retained source evidence and offers its own retry after a refresh failure', () => {
    const refetch = vi.fn();
    historyMock.mockReturnValue(query({
      data: [drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 1500)],
      isError: true,
      error: new Error('history refresh failed'),
      refetch,
    }));
    render(<EfficiencyTargetPage />);

    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByLabelText('Observed consumption')).toHaveTextContent('150');
    expect(screen.getByTestId('target-trust')).toHaveAttribute('data-retained', 'true');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps paused evidence without inventing a failure or offline vehicle state', () => {
    historyMock.mockReturnValue(query({ fetchStatus: 'paused' }));
    render(<EfficiencyTargetPage />);

    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByTestId('target-trust')).toHaveAttribute('data-retained', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Observed consumption')).toHaveTextContent('unknown');
  });

  it('preserves weighted SI evidence and signed target gaps without treating missing measurements as zero', () => {
    historyMock.mockReturnValue(query({
      data: [
        drive(new Date(2026, 6, 28, 12).toISOString(), 10000, 1500),
        drive(new Date(2026, 6, 29, 12).toISOString(), 20000, 3300),
        drive(new Date(2026, 7, 4, 12).toISOString(), 10000, 1700),
        drive(new Date(2026, 7, 5, 12).toISOString(), 10000, null),
      ],
    }));
    render(<EfficiencyTargetPage />);

    expect(screen.getByLabelText('Observed consumption')).toHaveTextContent('162.5');
    expect(screen.getByLabelText('Completed weeks')).toHaveTextContent('1');
    expect(screen.getByLabelText('Active consumption')).toHaveTextContent('170');
    expect(screen.getByLabelText('Completed target gap')).toHaveTextContent('0');
    expect(screen.getByLabelText('Eligible drives')).toHaveTextContent('3');
  });

  it('includes later successful history and completes the active week at the local Monday boundary', () => {
    vi.setSystemTime(new Date(2026, 7, 9, 23, 59));
    const earlier = drive(new Date(2026, 7, 4, 12).toISOString(), 10000, 1500);
    historyMock.mockReturnValue(query({ data: [earlier] }));
    const { rerender } = render(<EfficiencyTargetPage />);
    expect(screen.getByLabelText('Completed weeks')).toHaveTextContent('0');
    expect(screen.getByLabelText('Active consumption')).toHaveTextContent('150');

    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByLabelText('Completed weeks')).toHaveTextContent('1');
    expect(screen.getByLabelText('Active consumption')).toHaveTextContent('unknown');
    expect(screen.getByLabelText('Completed target gap')).toHaveTextContent('-10');

    vi.setSystemTime(new Date(2026, 7, 10, 12));
    historyMock.mockReturnValue(query({
      data: [earlier, drive(new Date(2026, 7, 10, 11).toISOString(), 10000, 1700)],
      dataUpdatedAt: Date.now(),
    }));
    rerender(<EfficiencyTargetPage />);
    expect(screen.getByLabelText('Eligible drives')).toHaveTextContent('2');
    expect(screen.getByLabelText('Active consumption')).toHaveTextContent('170');
  });

  it('contains one widget render failure while preserving the target and neighboring sections', () => {
    pulseRenderMock.mockImplementation(() => { throw new Error('pulse rendering failed'); });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<EfficiencyTargetPage />);
      expect(screen.queryByTestId('efficiency-target-pulse')).not.toBeInTheDocument();
      for (const id of SECTION_IDS.filter((id) => id !== 'efficiency-target-pulse')) {
        expect(screen.getByTestId(id)).toHaveTextContent('ready');
      }
      expect(screen.getByLabelText('Weekly consumption target')).toHaveValue('160');
      expect(screen.getByRole('alert')).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
