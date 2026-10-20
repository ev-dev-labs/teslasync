import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import { getWorkspaceRouteScope } from '@/lib/workspaceScope';
import type { CareScore } from '../lib/batteryCare';
import type { CareSectionState } from '../components/battery-care-modernization/state';

const {
  chargingHistoryMock,
  driveHistoryMock,
  selectedVehicleMock,
  pageTitleMock,
  careSummaryMock,
} = vi.hoisted(() => ({
  chargingHistoryMock: vi.fn(),
  driveHistoryMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  pageTitleMock: vi.fn(),
  careSummaryMock: vi.fn<(care: CareScore, state: CareSectionState) => void>(),
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
    CareSummary: ({ care, state }: { care: CareScore; state: State }) => {
      careSummaryMock(care, state);
      return section('battery-care-kpis', state);
    },
    CareRisk: ({ state }: { state: State }) => section('battery-care-score', state),
    CareEnergy: ({ state }: { state: State }) => section('battery-care-energy', state),
    CareMonthlyTrend: ({ state }: { state: State }) => section('battery-care-trend', state),
    SocEvidence: ({ state, kind }: { state: State; kind: 'finish' | 'arrival' }) =>
      section(kind === 'finish' ? 'battery-care-targets' : 'battery-care-arrivals', state),
  };
});

import BatteryCarePage from './BatteryCarePage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/battery-care']}><BatteryCarePage /></MemoryRouter>,
  );
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


// Match the accepted mounted Battery Care fixtures; the clock never drifts.
const NOW = Date.UTC(2026, 9, 4, 12);
const stamp = new Date(NOW).toISOString();

function session(id: number, endSoc: number | null = 95): ChargingSession {
  return {
    id: String(id), vehicle_id: '42', charger_type: 'AC',
    start_soc_pct: 20, end_soc_pct: endSoc,
    total_energy_added_wh: 10_000, peak_power_w: 7_000,
    cost_decimal: null, started_at: stamp, start_ts: stamp,
    startedAt: stamp, duration_min: 60,
  };
}

function drive(id: number, arrival: number | null = 5): Drive {
  return {
    id, vehicleId: 42, startTs: stamp, endTs: stamp,
    durationS: 3600, distanceM: 20_000,
    startAddress: null, endAddress: null,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 30, endBatteryPct: arrival,
    energyUsedWh: null, regenEnergyWh: null,
    avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
    outsideTempAvgC: null, insideTempAvgC: null,
    score: null, endedStatus: null, createdAt: stamp, updatedAt: stamp,
  };
}

function summaryInputs() {
  const inputs = careSummaryMock.mock.calls.at(-1);
  if (!inputs) throw new Error('Expected the mounted care summary');
  return { care: inputs[0], state: inputs[1] };
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
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  chargingHistoryMock.mockReturnValue(query());
  driveHistoryMock.mockReturnValue(query());
});

afterEach(() => {
  vi.restoreAllMocks();
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


  it.each([
    { name: 'loading', source: { data: undefined, isLoading: true } },
    { name: 'error', source: { data: undefined, isError: true, error: new Error('history unavailable') } },
  ])('keeps all eight sections mounted when both histories are $name', ({ name, source }) => {
    chargingHistoryMock.mockReturnValue(query(source));
    driveHistoryMock.mockReturnValue(query(source));
    renderPage();

    for (const testId of ALL_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent(new RegExp(`^${name}$`));
    }
    const { care, state } = summaryInputs();
    expect(state.trust.hasData).toBe(false);
    expect(state.trust.fatalError != null).toBe(name === 'error');
    expect(care.score).toBeNull();
    expect(care.fullChargeShare).toBeNull();
    expect(care.deepDischargeShare).toBeNull();
  });

  it('keeps charging sections ready while drive history is initially loading', () => {
    driveHistoryMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    renderPage();

    for (const testId of COMBINED_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent('partial-loading');
    }
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent(/^loading$/);
    for (const testId of ['battery-care-targets', 'battery-care-energy', 'battery-care-habits', 'battery-care-methodology']) {
      expect(screen.getByTestId(testId)).toHaveTextContent(/^ready$/);
    }
  });

  it('keeps drive evidence ready when charging history initially fails', () => {
    chargingHistoryMock.mockReturnValue(query({
      data: undefined, isError: true, error: new Error('charging unavailable'),
    }));
    renderPage();

    for (const testId of COMBINED_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent('partial-error');
    }
    for (const testId of ['battery-care-targets', 'battery-care-energy']) {
      expect(screen.getByTestId(testId)).toHaveTextContent(/^error$/);
    }
    expect(screen.getByTestId('battery-care-arrivals')).toHaveTextContent(/^ready$/);
    expect(summaryInputs().state.trust.fatalError).toBeNull();
  });

  it('retains calculated evidence on refresh failure and retries only the affected history', () => {
    const sessions = Array.from({ length: 5 }, (_, id) => session(id));
    const drives = Array.from({ length: 5 }, (_, id) => drive(id));
    const retryCharging = vi.fn();
    const retryDriving = vi.fn();
    chargingHistoryMock.mockReturnValue(query({ data: sessions, refetch: retryCharging }));
    driveHistoryMock.mockReturnValue(query({ data: drives, refetch: retryDriving }));
    const view = renderPage();
    const before = summaryInputs().care;
    expect(before.scoreReady).toBe(true);
    expect(before.energyMix.totalEnergyWh).toBe(50_000);

    chargingHistoryMock.mockReturnValue(query({
      data: sessions, refetch: retryCharging, isError: true,
      error: new Error('charging refresh failed'),
    }));
    view.rerender(<MemoryRouter><BatteryCarePage /></MemoryRouter>);

    for (const testId of ALL_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent(/^ready$/);
    }
    const { care, state } = summaryInputs();
    expect(care).toBe(before);
    expect(state.trust.fatalError).toBeNull();
    expect(state.sources[0].state).toMatchObject({
      data: sessions, status: 'stale', provenance: 'historical', updatedAt: 1,
      fatalError: null, refreshError: expect.any(Error),
    });
    expect(state.sources[0].state.data).toBe(sessions);
    expect(state.sources[1].state.data).toBe(drives);
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toHaveTextContent('Sessions returned may be out of date');
    expect(warnings[0]).toHaveTextContent('Previously loaded data remains visible');
    fireEvent.click(within(warnings[0]).getByRole('button', { name: 'Refresh' }));
    expect(retryCharging).toHaveBeenCalledTimes(1);
    expect(retryDriving).not.toHaveBeenCalled();
  });

  it('retains paused drive evidence without inventing a fatal or offline failure', () => {
    const drives = [drive(1)];
    driveHistoryMock.mockReturnValue(query({ data: drives, fetchStatus: 'paused' }));
    renderPage();

    for (const testId of ALL_SECTIONS) {
      expect(screen.getByTestId(testId)).toHaveTextContent(/^ready$/);
    }
    const { care, state } = summaryInputs();
    expect(care.medianArrivalSocPct).toBe(5);
    expect(state.sources[1].state).toMatchObject({
      isRefreshBlocked: true, status: 'stale', fatalError: null, refreshError: null,
    });
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    expect(warnings).toHaveLength(2);
    for (const warning of warnings) {
      expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
      expect(warning).toHaveTextContent('Drives returned may be out of date');
      expect(warning).not.toHaveTextContent('offline');
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('passes authoritatively empty histories as unknown evidence rather than healthy zeroes', () => {
    renderPage();

    for (const testId of ALL_SECTIONS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    const { care, state } = summaryInputs();
    expect(state.sources.every(source => source.state.hasData)).toBe(true);
    expect(state.trust.fatalError).toBeNull();
    expect(care).toMatchObject({
      score: null, scoreReady: false, medianEndSocPct: null,
      medianArrivalSocPct: null, fullChargeShare: null,
      deepDischargeShare: null, dcEnergyShare: null,
      coverage: { returnedSessions: 0, returnedDrives: 0 },
    });
    expect(care.monthly).toHaveLength(6);
    expect(care.monthly.every(month => month.score === null)).toBe(true);
  });

  it('distinguishes observed zero SoC from missing session ends and drive arrivals', () => {
    chargingHistoryMock.mockReturnValue(query({ data: [session(1, 0), session(2, null)] }));
    driveHistoryMock.mockReturnValue(query({ data: [drive(1, 0), drive(2, null)] }));
    renderPage();

    expect(summaryInputs().care).toMatchObject({
      sessionsAnalyzed: 1, drivesAnalyzed: 1,
      medianEndSocPct: 0, medianArrivalSocPct: 0,
      fullChargeShare: 0, deepDischargeShare: 1, dcEnergyShare: 0,
      score: null, scoreReady: false,
      coverage: { excludedEndSocSessions: 1, excludedArrivalDrives: 1 },
    });
  });

  it('forwards raw SI and signed observations without folding unknown energy into the DC denominator', () => {
    // Exact 30,000/10,000/60,000 Wh and -1/0 exclusions from model fixtures.
    const sessions = [
      { ...session(1), charger_type: 'Supercharger', total_energy_added_wh: 30_000 },
      session(2),
      { ...session(3), charger_type: null, total_energy_added_wh: 60_000 },
      { ...session(4, null), total_energy_added_wh: -1 },
      { ...session(5), total_energy_added_wh: 0 },
    ];
    const drives = [drive(1, 50), drive(2, 9), drive(3, null), drive(4, -1), drive(5, 101)];
    chargingHistoryMock.mockReturnValue(query({ data: sessions }));
    driveHistoryMock.mockReturnValue(query({ data: drives }));
    renderPage();

    const { care, state } = summaryInputs();
    expect(state.sources[0].state.data).toBe(sessions);
    expect(state.sources[1].state.data).toBe(drives);
    expect(sessions[3].total_energy_added_wh).toBe(-1);
    expect(sessions[0].peak_power_w).toBe(7_000);
    expect(drives[0]).toMatchObject({ distanceM: 20_000, durationS: 3600 });
    expect(drives[3].endBatteryPct).toBe(-1);
    expect(care.dcEnergyShare).toBe(0.75);
    expect(care.energyMix).toMatchObject({
      totalEnergyWh: 100_000, classifiedEnergyWh: 40_000,
      classificationCoverage: 0.4, energySessions: 3,
    });
    expect(care.energyMix.buckets.find(bucket => bucket.category === 'unknown'))
      .toMatchObject({ energyWh: 60_000, share: 0.6 });
    expect(care.coverage).toMatchObject({
      excludedEnergySessions: 2, unclassifiedEnergySessions: 1,
      excludedArrivalDrives: 3,
    });
    expect(care.score).toBeNull();
  });

  it('preserves header vehicle scope, bounded histories and the mount-time UTC monthly window on selection changes', () => {
    chargingHistoryMock.mockReturnValue(query({ data: [session(1)] }));
    const view = renderPage();
    const originalMonths = summaryInputs().care.monthly.map(month => month.month);
    expect(getWorkspaceRouteScope('/battery-care')).toEqual({ range: false, vehicle: true });
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(pageTitleMock).toHaveBeenCalledWith('Battery Care');

    vi.mocked(Date.now).mockReturnValue(Date.UTC(2027, 1, 1));
    selectedVehicleMock.mockReturnValue({ vehicleId: 0 });
    chargingHistoryMock.mockReturnValue(query());
    view.rerender(<MemoryRouter><BatteryCarePage /></MemoryRouter>);

    expect(chargingHistoryMock).toHaveBeenLastCalledWith('0', 1_000);
    expect(driveHistoryMock).toHaveBeenLastCalledWith('0', 1_000);
    expect(screen.queryByTestId('no-vehicle')).not.toBeInTheDocument();
    expect(summaryInputs().care.coverage.returnedSessions).toBe(0);
    expect(summaryInputs().care.monthly.map(month => month.month)).toEqual(originalMonths);
  });
});
