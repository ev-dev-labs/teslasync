import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import type {
  AdvancedPage,
  CausalExperiment,
  ChargingForensicsPage,
  ChargingForensicsItem,
  ChargingSiteTwinRequest,
  ChargingSiteTwinResponse,
  ComponentSurvival,
  CreateCausalExperimentRequest,
  FederatedRoundResult,
  FederatedStatusPage,
  FirmwareCanary,
  HazardPage,
  JourneyAssuranceRequest,
  JourneyAssuranceResponse,
  ResiliencePlanRequest,
  ResiliencePlanResponse,
  SentinelPage,
  StartFederatedRoundRequest,
  TCOOptimizerRequest,
  TCOOptimizerResponse,
  TwinLabRequest,
  TwinLabResponse,
} from '@/types/advancedIntelligence';

const ROOT = '/advanced-intelligence';

export const advancedIntelligenceKeys = {
  all: ['advanced-intelligence'] as const,
  firmwareCanary: (vehicleId: number | null, limit: number, offset: number) =>
    [...advancedIntelligenceKeys.all, 'firmware-canary', vehicleId, limit, offset] as const,
  componentSurvival: (vehicleId: number | null, limit: number, offset: number) =>
    [...advancedIntelligenceKeys.all, 'component-survival', vehicleId, limit, offset] as const,
  roadHazards: (vehicleId: number | null, limit: number, offset: number) =>
    [...advancedIntelligenceKeys.all, 'road-hazards', vehicleId, limit, offset] as const,
  behavioralSentinel: (vehicleId: number | null, limit: number, offset: number) =>
    [...advancedIntelligenceKeys.all, 'behavioral-sentinel', vehicleId, limit, offset] as const,
  chargingForensics: (vehicleId: number | null, limit: number, offset: number) =>
    [...advancedIntelligenceKeys.all, 'charging-forensics', vehicleId, limit, offset] as const,
  federatedStatus: (vehicleId: number | null, limit: number, offset: number) =>
    [...advancedIntelligenceKeys.all, 'federated-learning', vehicleId, limit, offset] as const,
  causalExperiments: (vehicleId: number | null, limit: number, offset: number) =>
    [...advancedIntelligenceKeys.all, 'causal-experiments', vehicleId, limit, offset] as const,
};

function listPath(path: string, vehicleId: number, limit: number, offset: number): string {
  const params = new URLSearchParams({
    vehicle_id: String(vehicleId),
    limit: String(limit),
    offset: String(offset),
  });
  return `${ROOT}/${path}?${params.toString()}`;
}

function useAdvancedList<T>(
  key: readonly unknown[],
  path: string,
  vehicleId: number | null,
  limit: number,
  offset: number,
) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) => {
      if (vehicleId == null || vehicleId <= 0) {
        throw new Error('vehicle_id must be a positive integer');
      }
      return request<T>(listPath(path, vehicleId, limit, offset), { signal });
    },
    enabled: vehicleId != null && vehicleId > 0,
  });
}

export function useFirmwareCanary(vehicleId: number | null, limit = 25, offset = 0) {
  return useAdvancedList<AdvancedPage<FirmwareCanary>>(
    advancedIntelligenceKeys.firmwareCanary(vehicleId, limit, offset),
    'firmware-canary', vehicleId, limit, offset,
  );
}

export function useComponentSurvival(vehicleId: number | null, limit = 25, offset = 0) {
  return useAdvancedList<AdvancedPage<ComponentSurvival>>(
    advancedIntelligenceKeys.componentSurvival(vehicleId, limit, offset),
    'component-survival', vehicleId, limit, offset,
  );
}

export function useRoadHazards(vehicleId: number | null, limit = 25, offset = 0) {
  return useAdvancedList<HazardPage>(
    advancedIntelligenceKeys.roadHazards(vehicleId, limit, offset),
    'road-hazards', vehicleId, limit, offset,
  );
}

export function useBehavioralSentinel(vehicleId: number | null, limit = 25, offset = 0) {
  return useAdvancedList<SentinelPage>(
    advancedIntelligenceKeys.behavioralSentinel(vehicleId, limit, offset),
    'behavioral-sentinel', vehicleId, limit, offset,
  );
}

export function useChargingForensics(vehicleId: number | null, limit = 25, offset = 0) {
  return useAdvancedList<ChargingForensicsPage>(
    advancedIntelligenceKeys.chargingForensics(vehicleId, limit, offset),
    'charging-forensics', vehicleId, limit, offset,
  );
}

// The advanced-intelligence list endpoints reject `limit > 100` outright
// (handler.parseListRequest bounds it), so a complete export has to page.
const EXPORT_PAGE_SIZE = 100;
// Safety stop so a bad `total` can never spin the loop forever.
const EXPORT_MAX_ROWS = 10_000;

/**
 * Fetch the whole charging-forensics set for CSV export.
 *
 * The table is server-paginated, so exporting only the rows currently on
 * screen would hand the user a dispute packet that silently omits most of
 * the evidence. Pages through at the endpoint's maximum page size instead.
 */
export async function fetchAllChargingForensics(
  vehicleId: number,
  signal?: AbortSignal,
): Promise<ChargingForensicsItem[]> {
  const rows: ChargingForensicsItem[] = [];
  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
    const page = await request<ChargingForensicsPage>(
      listPath('charging-forensics', vehicleId, EXPORT_PAGE_SIZE, offset),
      { signal },
    );
    const items = page.items ?? [];
    rows.push(...items);
    if (items.length < EXPORT_PAGE_SIZE || rows.length >= (page.total ?? rows.length)) break;
  }
  return rows;
}

export function useFederatedModelCards(vehicleId: number | null, limit = 25, offset = 0) {
  return useAdvancedList<FederatedStatusPage>(
    advancedIntelligenceKeys.federatedStatus(vehicleId, limit, offset),
    'federated-learning/model-cards', vehicleId, limit, offset,
  );
}

export function useCausalExperiments(vehicleId: number | null, limit = 25, offset = 0) {
  return useAdvancedList<AdvancedPage<CausalExperiment>>(
    advancedIntelligenceKeys.causalExperiments(vehicleId, limit, offset),
    'causal-experiments', vehicleId, limit, offset,
  );
}

function useSimulationMutation<TRequest, TResponse>(
  path: string,
  successKey: string,
  successFallback: string,
) {
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: TRequest) =>
      request<TResponse>(`${ROOT}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => toast.success(successKey, successFallback),
    onError: (error) =>
      toast.error(error, 'advancedIntelligence.toast.error', 'Advanced intelligence request failed'),
  });
}

export function useRunTwinLab() {
  return useSimulationMutation<TwinLabRequest, TwinLabResponse>(
    'twin-lab/scenarios', 'advancedIntelligence.twin.toast', 'Twin scenarios completed',
  );
}

export function useRunJourneyAssurance() {
  return useSimulationMutation<JourneyAssuranceRequest, JourneyAssuranceResponse>(
    'journey-assurance/scenarios', 'advancedIntelligence.journey.toast', 'Journey assessment completed',
  );
}

export function useRunChargingSiteTwin() {
  return useSimulationMutation<ChargingSiteTwinRequest, ChargingSiteTwinResponse>(
    'charging-site-twin/scenarios', 'advancedIntelligence.site.toast', 'Site scenario completed',
  );
}

export function useCreateResiliencePlan() {
  return useSimulationMutation<ResiliencePlanRequest, ResiliencePlanResponse>(
    'resilience/plans', 'advancedIntelligence.resilience.toast', 'Resilience plan created',
  );
}

export function useRunTCOOptimizer() {
  return useSimulationMutation<TCOOptimizerRequest, TCOOptimizerResponse>(
    'tco-optimizer/scenarios', 'advancedIntelligence.tco.toast', 'TCO alternatives generated',
  );
}

export function useStartFederatedRound() {
  const queryClient = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: StartFederatedRoundRequest) =>
      request<FederatedRoundResult>(`${ROOT}/federated-learning/rounds`, {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...advancedIntelligenceKeys.all, 'federated-learning'],
      });
      toast.success(
        'advancedIntelligence.federated.toast',
        'Privacy-preserving local round completed',
        { vehicle_id: variables.vehicle_id },
      );
    },
    onError: (error) =>
      toast.error(error, 'advancedIntelligence.toast.error', 'Advanced intelligence request failed'),
  });
}

export function useCreateCausalExperiment() {
  const queryClient = useQueryClient();
  const toast = useMutationToast();
  return useMutation({
    mutationFn: (body: CreateCausalExperimentRequest) =>
      request<CausalExperiment>(`${ROOT}/causal-experiments`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [...advancedIntelligenceKeys.all, 'causal-experiments'],
      });
      toast.success(
        'advancedIntelligence.causal.toast',
        'Experiment estimate created',
        { vehicle_id: variables.vehicle_id },
      );
    },
    onError: (error) =>
      toast.error(error, 'advancedIntelligence.toast.error', 'Advanced intelligence request failed'),
  });
}
