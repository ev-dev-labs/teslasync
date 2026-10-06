import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

vi.mock('@/components/layout', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout')>(),
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

vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
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
    RankedCareHabits: (props: SectionProps) =>
      section('battery-care-habits', props.state),
    BatteryCareMethodology: (props: SectionProps) =>
      section('battery-care-methodology', props.state),
  };
});

vi.mock('../components/battery-care-modernization', async importOriginal => {
  const actual = await importOriginal<typeof import('../components/battery-care-modernization')>();
  type State = import('../components/battery-care-modernization/state').CareSectionState;
  const section = (id: string, state: State) => {
    const failed = state.sources.some(source => source.state.fatalError);
    const pending = state.sources.some(source => !source.state.hasData && !source.state.fatalError);
    const status = state.trust.fatalError ? 'error'
      : !state.trust.hasData ? 'loading'
        : failed ? 'partial-error' : pending ? 'partial-loading' : 'ready';
    return <section data-testid={id}>{status}</section>;
  };
  return {
    ...actual,
    CareSummary: ({ state }: { state: State }) => section('battery-care-kpis', state),
    CareRisk: ({ state }: { state: State }) => section('battery-care-score', state),
    CareEnergy: ({ state }: { state: State }) => section('battery-care-energy', state),
    CareMonthlyTrend: ({ state }: { state: State }) => section('battery-care-trend', state),
    SocEvidence: ({ state, kind }: { state: State; kind: 'finish' | 'arrival' }) =>
      section(kind === 'finish' ? 'battery-care-targets' : 'battery-care-arrivals', state),
  };
});

import BatteryCarePage from './BatteryCarePage';

function renderPage() {
  return render(<MemoryRouter><BatteryCarePage /></MemoryRouter>);
}

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

const COMBINED_SECTIONS = [
  'battery-care-kpis',
  'battery-care-score',
  'battery-care-trend',
];

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  chargingHistoryMock.mockReturnValue(query());
  driveHistoryMock.mockReturnValue(query());
});

describe('BatteryCarePage', () => {
  it('mounts all analytical sections and requests both 1,000-row windows', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { name: 'Battery Care' }),
    ).toBeInTheDocument();
    for (const testId of ALL_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent('ready');
    }
    expect(chargingHistoryMock).toHaveBeenCalledWith('42', 1_000);
    expect(driveHistoryMock).toHaveBeenCalledWith('42', 1_000);
  });

  it('scopes initial charging loading without hiding independently available drive evidence', () => {
    chargingHistoryMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    renderPage();

    for (const testId of COMBINED_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent('partial-loading');
    }
    for (const testId of ['battery-care-targets', 'battery-care-energy']) {
      expect(screen.getByTestId(testId)).toHaveTextContent(/^loading$/);
    }
    for (const testId of ['battery-care-habits', 'battery-care-methodology']) {
      expect(screen.getByTestId(testId)).toHaveTextContent('ready');
    }
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent(
      'ready',
    );
  });

  it('scopes initial drive errors without replacing independent charging evidence', () => {
    driveHistoryMock.mockReturnValue(
      query({ data: undefined, isError: true, error: new Error('drive unavailable') }),
    );
    renderPage();

    for (const testId of COMBINED_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent('partial-error');
    }
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent(/^error$/);
    for (const testId of ['battery-care-habits', 'battery-care-methodology']) {
      expect(screen.getByTestId(testId)).toHaveTextContent('ready');
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
    renderPage();

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Battery Care');
    expect(screen.queryByTestId('battery-care-kpis')).not.toBeInTheDocument();
  });
});
