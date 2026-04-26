import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
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
  TeslaEnergyLiveStatus,
  TeslaEnergySite,
  TeslaEnergySiteInfoResponse,
  TOUSettingsPayload,
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
    staleTime: STALE_TIMES.STATIC,
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
    refetchInterval: INTERVALS.REALTIME,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
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
    staleTime: STALE_TIMES.STATIC,
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
// Tesla Energy Sites (product discovery from /products)
// ---------------------------------------------------------------------------

export function useTeslaEnergySites() {
  return useQuery({
    queryKey: ['tesla-energy-sites'],
    queryFn: () => request<TeslaEnergySite[]>('/tesla/energy-sites'),
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function useRefreshTeslaEnergySites() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: () =>
      request<TeslaEnergySite[]>('/tesla/energy-sites/refresh', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-energy-sites'] });
      toast.success('Energy sites refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh energy sites: ${err.message}`);
    },
  });
}

export function useTeslaEnergySiteInfo(siteId?: number) {
  return useQuery({
    queryKey: ['tesla-site-info', siteId],
    queryFn: () =>
      request<TeslaEnergySiteInfoResponse>(`/tesla/energy-sites/${siteId}/site-info`),
    enabled: !!siteId,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useRefreshTeslaEnergySiteInfo() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (siteId: number) =>
      request<TeslaEnergySiteInfoResponse>(
        `/tesla/energy-sites/${siteId}/site-info/refresh`,
        { method: 'POST' },
      ),
    onSuccess: (_data, siteId) => {
      queryClient.invalidateQueries({ queryKey: ['tesla-site-info', siteId] });
      toast.success('Site info refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh site info: ${err.message}`);
    },
  });
}

export function useUpdateTOUSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ siteId, settings }: { siteId: number; settings: TOUSettingsPayload }) =>
      request(`/tesla/energy-sites/${siteId}/tou-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }),
    onSuccess: (_data, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ['tesla-site-info', siteId] });
      toast.success('TOU settings saved');
    },
    onError: (err: Error) => {
      toast.error(`Failed to save TOU settings: ${err.message}`);
    },
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
    staleTime: STALE_TIMES.SLOW,
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
    staleTime: STALE_TIMES.SLOW,
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
    staleTime: STALE_TIMES.SLOW,
    select: safeArray,
  });
}

interface RefreshParams{
  siteId: number;
  start_date?: string;
  end_date?: string;
  time_zone?: string;
  period?: string;
}

export function useRefreshTeslaEnergyHistory() {
  const queryClient = useQueryClient();
  const toast = useToast();
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
      toast.success('Energy history refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh energy history: ${err.message}`);
    },
  });
}

export function useRefreshTeslaBackupHistory() {
  const queryClient = useQueryClient();
  const toast = useToast();
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
      toast.success('Backup history refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh backup history: ${err.message}`);
    },
  });
}

export function useRefreshTeslaWCChargingHistory() {
  const queryClient = useQueryClient();
  const toast = useToast();
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
      toast.success('Wall Connector charging history refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh WC charging history: ${err.message}`);
    },
  });
}

// ---------------------------------------------------------------------------
// Tesla Energy Live Status hooks (power flow snapshots)
// ---------------------------------------------------------------------------

export function useTeslaEnergyLiveStatus(siteId?: number) {
  return useQuery({
    queryKey: ['tesla-live-status', siteId],
    queryFn: () =>
      request<TeslaEnergyLiveStatus>(`/tesla/energy-sites/${siteId}/live-status`),
    enabled: !!siteId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useTeslaEnergyLiveStatusHistory(
  siteId?: number,
  since?: string,
  until?: string,
  limit?: number,
) {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (until) params.set('until', until);
  if (limit) params.set('limit', String(limit));

  return useQuery({
    queryKey: ['tesla-live-status-history', siteId, since, until, limit],
    queryFn: () =>
      request<TeslaEnergyLiveStatus[]>(
        `/tesla/energy-sites/${siteId}/live-status/history?${params.toString()}`,
      ),
    enabled: !!siteId,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function useRefreshTeslaEnergyLiveStatus() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (siteId: number) =>
      request<TeslaEnergyLiveStatus>(
        `/tesla/energy-sites/${siteId}/live-status/refresh`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-live-status'] });
      queryClient.invalidateQueries({ queryKey: ['tesla-live-status-history'] });
      toast.success('Live status refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh live status: ${err.message}`);
    },
  });
}
