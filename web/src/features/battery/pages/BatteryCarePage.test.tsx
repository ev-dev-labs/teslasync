import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const {
  chargingHistoryMock,
  driveHistoryMock,
  selectedVehicleMock,
  pageTitleMock,
} = vi.hoisted(() => ({
  chargingHistoryMock: vi.fn(),
  driveHistoryMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  pageTitleMock: vi.fn(),
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
          text.replace(new RegExp(`{{${name}}}`, 'g'), String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useCharging', () => ({
  useChargingHistory: (...args: unknown[]) => chargingHistoryMock(...args),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveHistory: (...args: unknown[]) => driveHistoryMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: () =>
      React.createElement('div', { 'data-testid': 'vehicle-select' }),
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

vi.mock('../components/battery-care', () => {
  interface State {
    isLoading: boolean;
    error: unknown;
  }
  interface SectionProps {
    state: State;
  }
  const status = (state: State) =>
    state.isLoading ? 'loading' : state.error ? 'error' : 'ready';
  const section = (testId: string, state: State) => (
    <section data-testid={testId}>{status(state)}</section>
  );
  return {
    BatteryCareKpiBand: (props: SectionProps) =>
      section('battery-care-kpis', props.state),
    CareScoreBreakdown: (props: SectionProps) =>
      section('battery-care-score', props.state),
    EndSocDistribution: (props: SectionProps) =>
      section('battery-care-targets', props.state),
    ChargingEnergyMix: (props: SectionProps) =>
      section('battery-care-energy', props.state),
    ArrivalSocEvidence: (props: SectionProps) =>
      section('battery-care-arrivals', props.state),
    MonthlyCareTrend: (props: SectionProps) =>
      section('battery-care-trend', props.state),
    RankedCareHabits: (props: SectionProps) =>
      section('battery-care-habits', props.state),
    BatteryCareMethodology: (props: SectionProps) =>
      section('battery-care-methodology', props.state),
  };
});

import BatteryCarePage from './BatteryCarePage';

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

const ALL_SECTIONS = [
  'battery-care-kpis',
  'battery-care-score',
  'battery-care-targets',
  'battery-care-energy',
  'battery-care-arrivals',
  'battery-care-trend',
  'battery-care-habits',
  'battery-care-methodology',
];

const CHARGING_DEPENDENT = [
  'battery-care-kpis',
  'battery-care-score',
  'battery-care-targets',
  'battery-care-energy',
  'battery-care-trend',
  'battery-care-habits',
  'battery-care-methodology',
];

const DRIVE_DEPENDENT = [
  'battery-care-kpis',
  'battery-care-score',
  'battery-care-arrivals',
  'battery-care-trend',
  'battery-care-habits',
  'battery-care-methodology',
];

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  chargingHistoryMock.mockReturnValue(query());
  driveHistoryMock.mockReturnValue(query());
});

describe('BatteryCarePage', () => {
  it('mounts all analytical sections and requests both 1,000-row windows', () => {
    render(<BatteryCarePage />);

    expect(
      screen.getByRole('heading', { name: 'Battery Care' }),
    ).toBeInTheDocument();
    for (const testId of ALL_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent('ready');
    }
    expect(chargingHistoryMock).toHaveBeenCalledWith('42', 1_000);
    expect(driveHistoryMock).toHaveBeenCalledWith('42', 1_000);
  });

  it('propagates charging loading only to charging-dependent sections', () => {
    chargingHistoryMock.mockReturnValue(query({ isLoading: true }));
    render(<BatteryCarePage />);

    for (const testId of CHARGING_DEPENDENT) {
      expect(screen.getByTestId(testId)).toHaveTextContent('loading');
    }
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent(
      'ready',
    );
  });

  it('propagates drive errors only to drive-dependent sections', () => {
    driveHistoryMock.mockReturnValue(
      query({ isError: true, error: new Error('drive unavailable') }),
    );
    render(<BatteryCarePage />);

    for (const testId of DRIVE_DEPENDENT) {
      expect(screen.getByTestId(testId)).toHaveTextContent('error');
    }
    expect(screen.getByTestId('battery-care-targets')).toHaveTextContent(
      'ready',
    );
    expect(screen.getByTestId('battery-care-energy')).toHaveTextContent(
      'ready',
    );
  });

  it('preserves the no-vehicle selection state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<BatteryCarePage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Battery Care');
    expect(screen.queryByTestId('battery-care-kpis')).not.toBeInTheDocument();
  });
});
