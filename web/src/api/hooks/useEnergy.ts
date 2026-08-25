import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { useAsOfDate, AS_OF_QUERY_PARAM } from '@/hooks/useAsOfDate';
import type {
  EnergyStats,
  BatteryHealth,
  BatteryHealthAnalytics,
  BatteryCellSummary,
  DegradationData,
  EnergyFlowData,
  VampireDrainStats,
  VampireDrainEvent,
  VampireDrainEventsResponse,
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

export type EnergyStatsWindow = number | { start: string };

export function useEnergyStats(
  vehicleId: string | null,
  window: EnergyStatsWindow = 30,
) {
  const windowKey = typeof window === 'number' ? `days:${window}` : `start:${window.start}`;
  const query = typeof window === 'number'
    ? `days=${window}`
    : `start=${encodeURIComponent(window.start)}`;

  return useQuery({
    queryKey: ['energy-stats', vehicleId, windowKey],
    queryFn: ({ signal }) => request<EnergyStats>(`/vehicles/${vehicleId}/energy?${query}`, { signal }),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.STANDARD,
  });
}

export function useBatteryHealth(vehicleId: string | null) {
  const { asOf } = useAsOfDate()
  // Propagate the global as-of timestamp so the backend reroutes
  // per-signal SignalAt lookups through signal_log.
  // The query key includes asOf so live and historical reads cache
  // independently and switching between them does not show stale data.
  const path = asOf
    ? `/vehicles/${vehicleId}/battery?${AS_OF_QUERY_PARAM}=${encodeURIComponent(asOf)}`
    : `/vehicles/${vehicleId}/battery`
  return useQuery({
    queryKey: asOf ? ['battery-health', vehicleId, asOf] : ['battery-health', vehicleId],
    queryFn: ({ signal }) => request<BatteryHealth>(path, { signal }),
    enabled: vehicleId !== null,
  });
}

export function useBatteryCells(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-cells', vehicleId],
    queryFn: ({ signal }) => request<BatteryCellSummary>(`/vehicles/${vehicleId}/battery/cells`, { signal }),
    enabled: vehicleId !== null,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useBatteryHealthAnalytics(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-health-analytics', vehicleId],
    queryFn: ({ signal }) => request<BatteryHealthAnalytics>(`/analytics/battery-health?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.ANALYTICS,
    retry: false,
  });
}

export function useBatteryDegradation(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-degradation', vehicleId],
    queryFn: ({ signal }) => request<DegradationData>(`/analytics/battery-degradation?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId !== null,
  });
}

export function useEnergyFlow(vehicleId: string | null) {
  return useQuery({
    queryKey: ['energy-flow', vehicleId],
    queryFn: ({ signal }) => request<EnergyFlowData>(`/vehicles/${vehicleId}/energy/flow`, { signal }),
    enabled: vehicleId !== null,
    refetchInterval: INTERVALS.REALTIME,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

/** Fetches 90-day parked, non-charging drain statistics derived from canonical history. */
export function useVampireDrainStats(vehicleId: string | null) {
  return useQuery({
    queryKey: ['vampire-drain-stats', vehicleId],
    queryFn: ({ signal }) => request<VampireDrainStats>(`/vampire-drain/stats?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.STANDARD,
  });
}

/** Fetches parked, non-charging drain windows and unwraps the API envelope. */
export function useVampireDrainEvents(vehicleId: string | null, limit = 50) {
  return useQuery({
    queryKey: ['vampire-drain-events', vehicleId, limit],
    queryFn: ({ signal }) => request<VampireDrainEventsResponse>(`/vampire-drain?vehicle_id=${vehicleId}&limit=${limit}`, { signal }),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.STANDARD,
    select: (response): VampireDrainEvent[] => safeArray(response?.events),
  });
}

export function useProjectedRange(vehicleId: string | null) {
  return useQuery({
    queryKey: ['projected-range', vehicleId],
    queryFn: ({ signal }) => request<ProjectedRangeData>(`/vehicles/${vehicleId}/battery/projected-range`, { signal }),
    enabled: vehicleId !== null,
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useSleepEfficiency(
  vehicleId: string | null,
  days = 30,
  startDate?: string,
  endDate?: string,
) {
  // When the caller passes an explicit start/end (canonical RangePicker
  // window), prefer those over the rolling-from-now `days` so historical
  // presets like `yesterday`/`lastMonth` and custom calendar picks return
  // the actual chosen window. The `days` param is still sent for backward
  // compatibility with backends that may not yet support start/end (and is
  // ignored by the modern handler when start/end are present).
  const params = new URLSearchParams({
    vehicle_id: vehicleId ?? '',
    days: String(days),
  });
  if (startDate && endDate) {
    params.set('start', startDate);
    params.set('end', endDate);
  }
  return useQuery({
    queryKey: ['sleep-efficiency', vehicleId, days, startDate ?? '', endDate ?? ''],
    queryFn: ({ signal }) =>
      request<SleepEfficiencyData>(
        `/analytics/sleep?${params.toString()}`,
        { signal },
      ),
    enabled: vehicleId !== null,
  });
}

// ---------------------------------------------------------------------------
// Tesla Energy Sites (product discovery from /products)
// ---------------------------------------------------------------------------

export function useTeslaEnergySites() {
  return useQuery({
    queryKey: ['tesla-energy-sites'],
    queryFn: ({ signal }) => request<TeslaEnergySite[]>('/tesla/energy-sites', { signal }),
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function useRefreshTeslaEnergySites() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: () =>
      request<TeslaEnergySite[]>('/tesla/energy-sites/refresh', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-energy-sites'] });
      success('toast.energy.sites.success', 'Energy sites refreshed');
    },
    onError: (err) => error(err, 'toast.energy.sites.error', 'Failed to refresh energy sites'),
  });
}

export function useTeslaEnergySiteInfo(siteId?: number) {
  return useQuery({
    queryKey: ['tesla-site-info', siteId],
    queryFn: ({ signal }) =>
      request<TeslaEnergySiteInfoResponse>(`/tesla/energy-sites/${siteId}/site-info`, { signal }),
    enabled: !!siteId,
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useRefreshTeslaEnergySiteInfo() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (siteId: number) =>
      request<TeslaEnergySiteInfoResponse>(
        `/tesla/energy-sites/${siteId}/site-info/refresh`,
        { method: 'POST' },
      ),
    onSuccess: (_data, siteId) => {
      queryClient.invalidateQueries({ queryKey: ['tesla-site-info', siteId] });
      success('toast.energy.siteInfo.success', 'Site info refreshed');
    },
    onError: (err) => error(err, 'toast.energy.siteInfo.error', 'Failed to refresh site info'),
  });
}

export function useUpdateTOUSettings() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ siteId, settings }: { siteId: number; settings: TOUSettingsPayload }) =>
      request(`/tesla/energy-sites/${siteId}/tou-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }),
    onSuccess: (_data, { siteId }) => {
      invalidateAndBroadcast(queryClient, { queryKey: ['tesla-site-info', siteId] });
      success('toast.energy.tou.success', 'TOU settings saved');
    },
    onError: (err) => error(err, 'toast.energy.tou.error', 'Failed to save TOU settings'),
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
    queryFn: ({ signal }) =>
      request<TeslaEnergyHistoryEntry[]>(
        `/tesla/energy-sites/${siteId}/energy-history?${params.toString()}`, { signal },
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
    queryFn: ({ signal }) =>
      request<TeslaBackupEvent[]>(
        `/tesla/energy-sites/${siteId}/backup-history?${params.toString()}`, { signal },
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
    queryFn: ({ signal }) =>
      request<TeslaWCChargingEntry[]>(
        `/tesla/energy-sites/${siteId}/charging-history?${params.toString()}`, { signal },
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
  const { success, error } = useMutationToast();
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
      success('toast.energy.history.success', 'Energy history refreshed');
    },
    onError: (err) => error(err, 'toast.energy.history.error', 'Failed to refresh energy history'),
  });
}

export function useRefreshTeslaBackupHistory() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
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
      success('toast.energy.backup.success', 'Backup history refreshed');
    },
    onError: (err) => error(err, 'toast.energy.backup.error', 'Failed to refresh backup history'),
  });
}

export function useRefreshTeslaWCChargingHistory() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
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
      success('toast.energy.wcCharging.success', 'Wall Connector charging history refreshed');
    },
    onError: (err) => error(err, 'toast.energy.wcCharging.error', 'Failed to refresh WC charging history'),
  });
}

// ---------------------------------------------------------------------------
// Tesla Energy Live Status hooks (power flow snapshots)
// ---------------------------------------------------------------------------

export function useTeslaEnergyLiveStatus(siteId?: number) {
  return useQuery({
    queryKey: ['tesla-live-status', siteId],
    queryFn: ({ signal }) =>
      request<TeslaEnergyLiveStatus>(`/tesla/energy-sites/${siteId}/live-status`, { signal }),
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
    queryFn: ({ signal }) =>
      request<TeslaEnergyLiveStatus[]>(
        `/tesla/energy-sites/${siteId}/live-status/history?${params.toString()}`, { signal },
      ),
    enabled: !!siteId,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function useRefreshTeslaEnergyLiveStatus() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (siteId: number) =>
      request<TeslaEnergyLiveStatus>(
        `/tesla/energy-sites/${siteId}/live-status/refresh`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tesla-live-status'] });
      queryClient.invalidateQueries({ queryKey: ['tesla-live-status-history'] });
      success('toast.energy.liveStatus.success', 'Live status refreshed');
    },
    onError: (err) => error(err, 'toast.energy.liveStatus.error', 'Failed to refresh live status'),
  });
}
