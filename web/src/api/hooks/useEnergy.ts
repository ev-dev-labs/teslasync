import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type {
  EnergyStats,
  BatteryHealth,
  BatteryHealthAnalytics,
  BatteryCellSummary,
  DegradationData,
  EnergyFlowData,
  VampireDrainStats,
  VampireDrainEvent,
  ProjectedRangeData,
  SleepEfficiencyData,
  TeslaEnergyHistoryEntry,
  TeslaBackupEvent,
  TeslaWCChargingEntry,
} from '@/types/energy';

export function useEnergyStats(vehicleId: string | null, days = 30) {
  return useQuery({
    queryKey: ['energy-stats', vehicleId, days],
    queryFn: () => request<EnergyStats>(`/vehicles/${vehicleId}/energy?days=${days}`),
    enabled: vehicleId !== null,
  });
}

export function useBatteryHealth(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-health', vehicleId],
    queryFn: () => request<BatteryHealth>(`/vehicles/${vehicleId}/battery`),
    enabled: vehicleId !== null,
  });
}

export function useBatteryCells(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-cells', vehicleId],
    queryFn: () => request<BatteryCellSummary>(`/vehicles/${vehicleId}/battery/cells`),
    enabled: vehicleId !== null,
    retry: false,
    staleTime: Infinity,
  });
}

export function useBatteryHealthAnalytics(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-health-analytics', vehicleId],
    queryFn: () => request<BatteryHealthAnalytics>(`/analytics/battery-health?vehicle_id=${vehicleId}`),
    enabled: vehicleId !== null,
  });
}

export function useBatteryDegradation(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-degradation', vehicleId],
    queryFn: () => request<DegradationData>(`/analytics/battery-degradation?vehicle_id=${vehicleId}`),
    enabled: vehicleId !== null,
  });
}

export function useEnergyFlow(vehicleId: string | null) {
  return useQuery({
    queryKey: ['energy-flow', vehicleId],
    queryFn: () => request<EnergyFlowData>(`/vehicles/${vehicleId}/energy/flow`),
    enabled: vehicleId !== null,
    refetchInterval: 5000,
    retry: false,
    staleTime: Infinity,
  });
}

export function useVampireDrainStats(vehicleId: string | null) {
  return useQuery({
    queryKey: ['vampire-drain-stats', vehicleId],
    queryFn: () => request<VampireDrainStats>(`/vampire-drain/stats?vehicle_id=${vehicleId}`),
    enabled: vehicleId !== null,
  });
}

export function useVampireDrainEvents(vehicleId: string | null, limit = 50) {
  return useQuery({
    queryKey: ['vampire-drain-events', vehicleId, limit],
    queryFn: () => request<VampireDrainEvent[]>(`/vampire-drain?vehicle_id=${vehicleId}&limit=${limit}`),
    enabled: vehicleId !== null,
    select: safeArray,
  });
}

export function useProjectedRange(vehicleId: string | null) {
  return useQuery({
    queryKey: ['projected-range', vehicleId],
    queryFn: () => request<ProjectedRangeData>(`/vehicles/${vehicleId}/battery/projected-range`),
    enabled: vehicleId !== null,
    retry: false,
    staleTime: Infinity,
  });
}

export function useSleepEfficiency(vehicleId: string | null, days = 30) {
  return useQuery({
    queryKey: ['sleep-efficiency', vehicleId, days],
    queryFn: () => request<SleepEfficiencyData>(`/analytics/sleep?vehicle_id=${vehicleId}&days=${days}`),
    enabled: vehicleId !== null,
  });
}

// ---------------------------------------------------------------------------
// Tesla Energy Site History hooks
// ---------------------------------------------------------------------------

export function useTeslaEnergyHistory(
  siteId?: number,
  period = 'day',
  since?: string,
  until?: string,
) {
  const params = new URLSearchParams({ period });
  if (since) params.set('since', since);
  if (until) params.set('until', until);

  return useQuery({
    queryKey: ['tesla-energy-history', siteId, period, since, until],
    queryFn: () =>
      request<TeslaEnergyHistoryEntry[]>(
        `/tesla/energy-sites/${siteId}/energy-history?${params.toString()}`,
      ),
    enabled: !!siteId,
    staleTime: 5 * 60_000,
    select: safeArray,
  });
}

export function useTeslaBackupHistory(
  siteId?: number,
  since?: string,
  until?: string,
) {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (until) params.set('until', until);

  return useQuery({
    queryKey: ['tesla-backup-history', siteId, since, until],
    queryFn: () =>
      request<TeslaBackupEvent[]>(
        `/tesla/energy-sites/${siteId}/backup-history?${params.toString()}`,
      ),
    enabled: !!siteId,
    staleTime: 5 * 60_000,
    select: safeArray,
  });
}

export function useTeslaWCChargingHistory(
  siteId?: number,
  since?: string,
  until?: string,
) {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (until) params.set('until', until);

  return useQuery({
    queryKey: ['tesla-wc-charging-history', siteId, since, until],
    queryFn: () =>
      request<TeslaWCChargingEntry[]>(
        `/tesla/energy-sites/${siteId}/charging-history?${params.toString()}`,
      ),
    enabled: !!siteId,
    staleTime: 5 * 60_000,
    select: safeArray,
  });
}

interface RefreshParams {
  siteId: number;
  start_date?: string;
  end_date?: string;
  time_zone?: string;
  period?: string;
}

export function useRefreshTeslaEnergyHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, period = 'day', start_date, end_date, time_zone }: RefreshParams) => {
      const params = new URLSearchParams({ period });
      if (start_date) params.set('start_date', start_date);
      if (end_date) params.set('end_date', end_date);
      if (time_zone) params.set('time_zone', time_zone);
      return request<{ entries: TeslaEnergyHistoryEntry[]; upserted: number }>(
        `/tesla/energy-sites/${siteId}/energy-history/refresh?${params.toString()}`,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-energy-history'] });
    },
  });
}

export function useRefreshTeslaBackupHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, period = 'day', start_date, end_date, time_zone }: RefreshParams) => {
      const params = new URLSearchParams({ period });
      if (start_date) params.set('start_date', start_date);
      if (end_date) params.set('end_date', end_date);
      if (time_zone) params.set('time_zone', time_zone);
      return request<{ entries: TeslaBackupEvent[]; upserted: number }>(
        `/tesla/energy-sites/${siteId}/backup-history/refresh?${params.toString()}`,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-backup-history'] });
    },
  });
}

export function useRefreshTeslaWCChargingHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, start_date, end_date, time_zone }: RefreshParams) => {
      const params = new URLSearchParams();
      if (start_date) params.set('start_date', start_date);
      if (end_date) params.set('end_date', end_date);
      if (time_zone) params.set('time_zone', time_zone);
      return request<{ entries: TeslaWCChargingEntry[]; upserted: number }>(
        `/tesla/energy-sites/${siteId}/charging-history/refresh?${params.toString()}`,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-wc-charging-history'] });
    },
  });
}
