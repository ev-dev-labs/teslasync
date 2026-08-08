import type { ChangeEvent, ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/ui', () => ({
  Input: ({
    'aria-label': ariaLabel,
    defaultValue,
    onChange,
    suffix,
  }: {
    'aria-label': string;
    defaultValue: number;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    suffix: ReactNode;
  }) => (
    <label>
      <input
        aria-label={ariaLabel}
        defaultValue={defaultValue}
        onChange={onChange}
      />
      {suffix}
    </label>
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
    }) =>
      section(
        'efficiency-target-kpis',
        props.state,
        props.targetWhPerKm,
      ),
    GoalPulse: (props: { state: State }) =>
      section('efficiency-target-pulse', props.state),
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
    ['loading', query({ isLoading: true })],
    ['error', query({ isError: true, error: new Error('unavailable') })],
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
});
