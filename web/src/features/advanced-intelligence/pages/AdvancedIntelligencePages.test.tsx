import { type ComponentType, type ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';

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
  };
});

function query(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isStale: false,
    error: null,
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
  });
  [
    mocks.twinMutate, mocks.journeyMutate, mocks.siteMutate, mocks.federatedMutate,
    mocks.resilienceMutate, mocks.causalMutate, mocks.tcoMutate,
  ].forEach((mock) => mock.mockReset());
});

describe('advanced intelligence page routes', () => {
  const pages: Array<[string, ComponentType]> = [
    ['Twin Lab', TwinLabPage],
    ['Firmware Canary', FirmwareCanaryPage],
    ['Component Survival', ComponentSurvivalPage],
    ['Road Hazard Mesh', RoadHazardMeshPage],
    ['Behavioral Sentinel', BehavioralSentinelPage],
    ['Charging Forensics', ChargingForensicsPage],
    ['Journey Assurance', JourneyAssurancePage],
    ['Charging Site Twin', ChargingSiteTwinPage],
    ['Federated Learning Studio', FederatedLearningStudioPage],
    ['Emergency Resilience', EmergencyResiliencePage],
    ['Causal Experimentation', CausalExperimentationPage],
    ['TCO Optimizer', TCOOptimizerPage],
  ];

  it.each(pages)('smoke-renders the %s route shell', (title, Page) => {
    renderPage(Page);
    expect(screen.getByRole('heading', { name: title, level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('Select vehicle')).toBeInTheDocument();
  });
});

describe('critical advanced intelligence interactions', () => {
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
