// Force a non-UTC zone BEFORE anything renders so datetime-local defaults
// built from UTC slices (rather than local wall-clock) fail the specs below.
process.env.TZ = 'America/New_York';

import { type ComponentType, type ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { toLocalDatetimeStr } from '@/lib/dateFormat';

const mocks = vi.hoisted(() => {
  const noData: unknown = undefined;
  return {
    twinMutate: vi.fn(),
    journeyMutate: vi.fn(),
    siteMutate: vi.fn(),
    federatedMutate: vi.fn(),
    resilienceMutate: vi.fn(),
    causalMutate: vi.fn(),
    tcoMutate: vi.fn(),
    firmwareData: noData,
    survivalData: noData,
    hazardsData: noData,
    sentinelData: noData,
    forensicsData: noData,
    federatedData: noData,
    causalData: noData,
    readError: null as Error | null,
    readLoading: false,
    readFetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  };
});

function query(data: unknown) {
  return {
    data,
    isLoading: mocks.readLoading,
    isFetching: false,
    isError: mocks.readError != null,
    isStale: false,
    error: mocks.readError,
    fetchStatus: mocks.readFetchStatus,
  };
}

function mutation(mutate: ReturnType<typeof vi.fn>) {
  return { mutate, data: undefined, error: null, isPending: false };
}

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useFirmwareCanary: () => query(mocks.firmwareData),
  useComponentSurvival: () => query(mocks.survivalData),
  useRoadHazards: () => query(mocks.hazardsData),
  useBehavioralSentinel: () => query(mocks.sentinelData),
  useChargingForensics: () => query(mocks.forensicsData),
  useFederatedModelCards: () => query(mocks.federatedData),
  useCausalExperiments: () => query(mocks.causalData),
  useRunTwinLab: () => mutation(mocks.twinMutate),
  useRunJourneyAssurance: () => mutation(mocks.journeyMutate),
  useRunChargingSiteTwin: () => mutation(mocks.siteMutate),
  useStartFederatedRound: () => mutation(mocks.federatedMutate),
  useCreateResiliencePlan: () => mutation(mocks.resilienceMutate),
  useCreateCausalExperiment: () => mutation(mocks.causalMutate),
  useRunTCOOptimizer: () => mutation(mocks.tcoMutate),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicle: { id: 7, display_name: 'Orion' },
    vehicles: [{ id: 7, display_name: 'Orion' }],
    setVehicleId: vi.fn(),
  }),
}));

// StormGuardPanel (embedded in EmergencyResiliencePage) stays idle: its own
// contract tests cover behaviour; here it must only not fire live queries.
vi.mock('@/api/hooks/useStormguard', () => ({
  useStormguardStatus: () => ({ data: undefined, isLoading: true, isError: false }),
  useStormguardEvents: () => ({ data: [], isLoading: false, isError: false }),
  useSaveStormguardConfig: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
    formatDistance: (value: number | null | undefined) => value == null ? '—' : `${value / 1000} km`,
    formatSpeed: (value: number | null | undefined) => value == null ? '—' : `${value} km/h`,
    formatTemperature: (value: number | null | undefined) => value == null ? '—' : `${value}°C`,
    formatPressure: (value: number | null | undefined) => value == null ? '—' : `${value} bar`,
    formatEnergy: (value: number | null | undefined) => value == null ? '—' : `${value / 1000} kWh`,
    formatDuration: (value: number | null | undefined) => value == null ? '—' : `${value / 3600} h`,
    formatPower: (value: number | null | undefined) => value == null ? '—' : `${value / 1000} kW`,
  }),
}));

import BehavioralSentinelPage from './BehavioralSentinelPage';
import CausalExperimentationPage from './CausalExperimentationPage';
import ChargingForensicsPage from './ChargingForensicsPage';
import ChargingSiteTwinPage from './ChargingSiteTwinPage';
import ComponentSurvivalPage from './ComponentSurvivalPage';
import EmergencyResiliencePage from './EmergencyResiliencePage';
import FederatedLearningStudioPage from './FederatedLearningStudioPage';
import FirmwareCanaryPage from './FirmwareCanaryPage';
import JourneyAssurancePage from './JourneyAssurancePage';
import RoadHazardMeshPage from './RoadHazardMeshPage';
import TCOOptimizerPage from './TCOOptimizerPage';
import TwinLabPage from './TwinLabPage';

function renderPage(Page: ComponentType) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>{children}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<Page />, { wrapper: Providers });
}

beforeEach(() => {
  Object.assign(mocks, {
    firmwareData: undefined,
    survivalData: undefined,
    hazardsData: undefined,
    sentinelData: undefined,
    forensicsData: undefined,
    federatedData: undefined,
    causalData: undefined,
    readError: null,
    readLoading: false,
    readFetchStatus: 'idle',
  });
  [
    mocks.twinMutate, mocks.journeyMutate, mocks.siteMutate, mocks.federatedMutate,
    mocks.resilienceMutate, mocks.causalMutate, mocks.tcoMutate,
  ].forEach((mock) => mock.mockReset());
});

describe('advanced intelligence page routes', () => {
  const pages: Array<[string, ComponentType]> = [
    ['Twin lab', TwinLabPage],
    ['Firmware canary', FirmwareCanaryPage],
    ['Component survival', ComponentSurvivalPage],
    ['Road hazard mesh', RoadHazardMeshPage],
    ['Behavioral sentinel', BehavioralSentinelPage],
    ['Charging forensics', ChargingForensicsPage],
    ['Journey assurance', JourneyAssurancePage],
    ['Charging site twin', ChargingSiteTwinPage],
    ['Federated learning studio', FederatedLearningStudioPage],
    ['Emergency resilience', EmergencyResiliencePage],
    ['Causal experimentation', CausalExperimentationPage],
    ['TCO optimizer', TCOOptimizerPage],
  ];

  it.each(pages)('smoke-renders the %s route shell', (title, Page) => {
    renderPage(Page);
    expect(screen.getByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    expect(screen.queryByLabelText('Select vehicle')).not.toBeInTheDocument();
  });
});

describe('critical advanced intelligence interactions', () => {
  it.each([
    BehavioralSentinelPage, CausalExperimentationPage, ChargingForensicsPage,
    ComponentSurvivalPage, FederatedLearningStudioPage, FirmwareCanaryPage, RoadHazardMeshPage,
  ])('keeps source-independent notices and evidence shells on initial query failure', Page => {
    mocks.readError = new Error('initial evidence failure');
    renderPage(Page);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.getAllByText('Intelligence evidence could not be loaded.').length).toBeGreaterThan(0);
    expect(screen.getByText('Explicitly unsupported')).toBeInTheDocument();
  });

  it('keeps independent creation and confirmation reachable when experiment history fails', () => {
    mocks.readError = new Error('history unavailable');
    renderPage(CausalExperimentationPage);
    fireEvent.click(screen.getByRole('button', { name: 'Review experiment' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.causalMutate).not.toHaveBeenCalled();
  });

  it('discloses a paused unresolved source without claiming that no hazards exist', () => {
    mocks.readFetchStatus = 'paused';
    renderPage(RoadHazardMeshPage);
    expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
    expect(screen.queryByText('No coarse-cell hazard clusters meet the privacy and evidence thresholds.')).not.toBeInTheDocument();
    expect(screen.getByText(/No exact coordinates, routes, or driver identities/)).toBeInTheDocument();
  });

  it('retains ordered sentinel findings, confidence, explanations and caveats after a refresh failure', () => {
    mocks.sentinelData = {
      items: [
        { finding_type: 'identity-observation', observed_at: '2026-08-01T00:00:00Z', severity: 'high', confidence_pct: 72.5,
          explanation: 'First explanation', evidence: [{ source: 'first-source', summary: 'First supporting observation' }], limitations: ['No intent inferred'] },
        { finding_type: 'telemetry-observation', observed_at: '2026-08-02T00:00:00Z', severity: 'medium', confidence_pct: 35,
          explanation: 'Second explanation', evidence: [], limitations: ['No compromise inferred'] },
      ],
      total: 2,
    };
    mocks.readError = new Error('refresh failure');
    renderPage(BehavioralSentinelPage);
    const first = screen.getByText('First explanation');
    const second = screen.getByText('Second explanation');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('No intent inferred')).toBeInTheDocument();
    expect(screen.getByText('No compromise inferred')).toBeInTheDocument();
    expect(screen.getByText(/72.*confidence/)).toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    expect(screen.getByText('Anomaly is not attribution')).toBeInTheDocument();
  });

  it('submits all Twin Lab scenarios as confirmed canonical SI values', () => {
    renderPage(TwinLabPage);
    expect(screen.getAllByLabelText(/Scenario name/i)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add scenario' }));
    expect(screen.getAllByLabelText(/Scenario name/i)).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Run confirmed simulation' }));
    expect(mocks.twinMutate).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 7,
      confirmed: true,
      scenarios: expect.arrayContaining([
        expect.objectContaining({ distance_m: 50000, speed_mps: 22, horizon_s: 3600 }),
      ]),
    }));
    expect(mocks.twinMutate.mock.calls[0]?.[0].scenarios).toHaveLength(3);
  });

  it('confirmation-gates a federated round and never claims raw upload', () => {
    renderPage(FederatedLearningStudioPage);
    expect(screen.getByText(/Raw vehicle data never leaves/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Model name/i), { target: { value: 'local-efficiency' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review privacy spend' }));
    expect(mocks.federatedMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/never uploads raw vehicle data/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start local round' }));
    expect(mocks.federatedMutate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      vehicle_id: 7,
      model_name: 'local-efficiency',
      confirmed: true,
    }));
    expect(typeof mocks.federatedMutate.mock.calls[0]?.[1]?.onSuccess).toBe('function');
  });

  it('confirmation-gates causal estimation and discloses non-causality', () => {
    renderPage(CausalExperimentationPage);
    expect(screen.getByText(/Association is not proof of causality/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review experiment' }));
    expect(mocks.causalMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create estimate' }));
    expect(mocks.causalMutate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      vehicle_id: 7,
      intervention_kind: 'charging_schedule',
      metric: 'charging_success_pct',
      confirmed: true,
    }));
    expect(typeof mocks.causalMutate.mock.calls[0]?.[1]?.onSuccess).toBe('function');
  });

  it('seeds the journey departure default in local wall-clock, not UTC', () => {
    renderPage(JourneyAssurancePage);
    const input = screen.getByLabelText(/departure/i) as HTMLInputElement;
    // The page stamps its default just before this assertion runs; accept an
    // exact match or a one-minute-older value if a minute edge intervened.
    const candidates = [0, -60_000].map((skew) =>
      toLocalDatetimeStr(new Date(Date.now() + 24 * 3_600_000 + skew)).slice(0, 16),
    );
    expect(candidates).toContain(input.value);
    // … and it must never be the raw UTC slice the old code produced here.
    expect(input.value).not.toBe(
      new Date(Date.now() + 24 * 3_600_000).toISOString().slice(0, 16),
    );
  });

  it('seeds the causal experiment window defaults in local wall-clock, not UTC', () => {
    renderPage(CausalExperimentationPage);
    const cases: Array<[RegExp, number]> = [
      [/baseline start/i, 8],
      [/baseline end/i, 6],
      [/treatment start/i, 5],
      [/treatment end/i, 2],
    ];
    for (const [label, daysAgo] of cases) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      const candidates = [0, -60_000].map((skew) =>
        toLocalDatetimeStr(new Date(Date.now() - daysAgo * 86_400_000 + skew)).slice(0, 16),
      );
      expect(candidates).toContain(input.value);
      expect(input.value).not.toBe(
        new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 16),
      );
    }
  });

  it('renders unsupported charging fields as unsupported rather than zero', () => {
    mocks.forensicsData = {
      items: [{
        session_id: 44,
        started_at: '2026-08-01T00:00:00Z',
        ended_at: null,
        vehicle_energy_wh: 12000,
        meter_energy_wh: null,
        estimated_loss_wh: null,
        estimated_loss_low_wh: null,
        estimated_loss_high_wh: null,
        recorded_cost_minor: null,
        expected_cost_minor: null,
        cost_discrepancy_minor: null,
        currency: null,
        status: 'partial',
        evidence: [],
        limitations: ['Meter source unavailable.'],
      }],
      total: 1,
      limit: 15,
      offset: 0,
      data_quality: {
        status: 'limited',
        sample_count: 1,
        coverage_pct: null,
        window_start: null,
        window_end: null,
        reasons: [],
      },
      generated_at: '2026-08-01T00:00:00Z',
    };
    renderPage(ChargingForensicsPage);
    expect(screen.getAllByText('Unsupported').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/Meter source unavailable/)).toBeInTheDocument();
  });
});
