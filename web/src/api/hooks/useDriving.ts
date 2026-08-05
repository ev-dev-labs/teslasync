import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES, INTERVALS } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import type { Drive as ApiDrive } from '../types';
import type {
  Drive,
  DriveDetail,
  DrivePosition,
  DriveTelemetryPoint,
  DriveScore,
  DrivingStats,
  DrivingDynamicsData,
  AccelerationDistributionData,
  DrivetrainHealthData,
  SpeedProfileData,
  RegenEfficiencyData,
  RouteEfficiencyData,
  DrivingCoachData,
  TripPlan,
  TripPlanRequest,
  GeocodeResult,
} from '@/types/driving';
import type {
  DriveDiagnosticResponse,
  DriveDiagnosticWindow,
} from '@/types/admin-diagnostics';

/** Fetches paginated driving sessions for a vehicle, optionally filtered by date range. */
export const getDrives = (vehicleId: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ApiDrive[]>(`/drives?${params}`)
}

export const drivingKeys = {
  drives: (vehicleId?: string) => ['drives', vehicleId] as const,
  history: (vehicleId?: string, limit = 1000) =>
    ['drives', vehicleId, 'history', limit] as const,
  // Detail key is namespaced under 'drive' (singular) so it never collides
  // with `drives(vehicleId)` when the vehicleId numerically equals the drive
  // id. The collision swapped the cached value between `Drive[]` (list) and
  // `DriveDetail` (object) on every navigation between /drives and
  // /drives/{id}, surfacing as "No telemetry recorded" + NaNm + "In progress"
  // because `Drive[].distanceM`, `.endTs`, `.durationS`, `.telemetry` are
  // all undefined on an array.
  drive: (id: string) => ['drive', id] as const,
  score: (vehicleId?: string) => ['drive-score', vehicleId] as const,
  stats: (vehicleId?: string) => ['driving-stats', vehicleId] as const,
  dynamics: (vehicleId?: string) => ['driving-dynamics', vehicleId] as const,
  accelerationDistribution: (vehicleId?: string) => ['acceleration-distribution', vehicleId] as const,
  drivetrainHealth: (vehicleId?: string) => ['drivetrain-health', vehicleId] as const,
  speedProfile: (vehicleId?: string) => ['speed-profile', vehicleId] as const,
  regenEfficiency: (vehicleId?: string) => ['regen-efficiency', vehicleId] as const,
  routeEfficiency: (vehicleId?: string) => ['route-efficiency', vehicleId] as const,
  coach: (vehicleId?: string, days?: number) => ['driving-coach', vehicleId, days] as const,
  whyEnded: (driveId: string, window: DriveDiagnosticWindow) =>
    ['drive', driveId, 'why-ended', window] as const,
};

export function useDrives(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drives(vehicleId),
    queryFn: ({ signal }) =>
      request<Drive[]>(vehicleId ? `/drives?vehicle_id=${vehicleId}` : '/drives', { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

/**
 * Fetches a deliberately larger, isolated history window for client-side
 * analytical models. The list page keeps its existing lightweight query and
 * cache key; analytical pages opt into this hook so an annual/cumulative model
 * is never silently trained on the API's default 50-row page.
 *
 * The backend caps one request at 1,000 rows. Callers must still describe the
 * result as an observed history window rather than guaranteed lifetime data.
 */
export function useDriveHistory(vehicleId?: string, limit = 1000) {
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  return useQuery({
    queryKey: drivingKeys.history(vehicleId, boundedLimit),
    queryFn: ({ signal }) =>
      request<Drive[]>(
        `/drives?vehicle_id=${encodeURIComponent(String(vehicleId))}&limit=${boundedLimit}`,
        { signal },
      ),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.MODERATE,
    select: safeArray,
  });
}

export function useDrive(id: string) {
  return useQuery({
    queryKey: drivingKeys.drive(id),
    queryFn: ({ signal }) => request<DriveDetail>(`/drives/${id}`, { signal }),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.live === true ? INTERVALS.FAST : false;
    },
  });
}

export function useDriveScore(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.score(vehicleId),
    queryFn: ({ signal }) =>
      request<DriveScore>(
        vehicleId ? `/drives/score?vehicle_id=${vehicleId}` : '/drives/score', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivingStats(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.stats(vehicleId),
    queryFn: ({ signal }) =>
      request<DrivingStats>(
        vehicleId ? `/drives/stats?vehicle_id=${vehicleId}` : '/drives/stats', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivingDynamics(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.dynamics(vehicleId),
    queryFn: ({ signal }) =>
      request<DrivingDynamicsData>(
        vehicleId ? `/drives/dynamics?vehicle_id=${vehicleId}` : '/drives/dynamics', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useAccelerationDistribution(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.accelerationDistribution(vehicleId),
    queryFn: ({ signal }) =>
      request<AccelerationDistributionData>(
        vehicleId
          ? `/drives/acceleration-distribution?vehicle_id=${vehicleId}`
          : '/drives/acceleration-distribution', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivetrainHealth(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drivetrainHealth(vehicleId),
    queryFn: ({ signal }) =>
      request<DrivetrainHealthData>(
        vehicleId
          ? `/drivetrain/health?vehicle_id=${vehicleId}`
          : '/drivetrain/health', { signal },
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useSpeedProfile(vehicleId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: [...drivingKeys.speedProfile(vehicleId), start, end],
    queryFn: ({ signal }) => {
      if (!vehicleId) return request<SpeedProfileData>('/analytics/speed-profile', { signal });
      const params = new URLSearchParams({ vehicle_id: vehicleId });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return request<SpeedProfileData>(`/analytics/speed-profile?${params}`, { signal });
    },
    enabled: !!vehicleId,
  });
}

export function useRegenEfficiency(vehicleId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: [...drivingKeys.regenEfficiency(vehicleId), start, end],
    queryFn: ({ signal }) => {
      if (!vehicleId) return request<RegenEfficiencyData>('/analytics/regen', { signal });
      const params = new URLSearchParams({ vehicle_id: vehicleId });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return request<RegenEfficiencyData>(`/analytics/regen?${params}`, { signal });
    },
    enabled: !!vehicleId,
  });
}

export function useRouteEfficiency(vehicleId?: string, start?: string, end?: string) {
  return useQuery({
    queryKey: [...drivingKeys.routeEfficiency(vehicleId), start, end],
    queryFn: ({ signal }) => {
      if (!vehicleId) return request<RouteEfficiencyData>('/analytics/route-efficiency', { signal });
      const params = new URLSearchParams({ vehicle_id: vehicleId });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return request<RouteEfficiencyData>(`/analytics/route-efficiency?${params}`, { signal });
    },
    enabled: !!vehicleId,
  });
}

export function useDrivePositions(driveId: string) {
  return useQuery({
    queryKey: ['drive-positions', driveId],
    queryFn: ({ signal }) => request<DrivePosition[]>(`/drives/${driveId}/positions`, { signal }),
    enabled: !!driveId,
    select: safeArray,
  });
}

export function useDriveTelemetry(driveId: string) {
  return useQuery({
    queryKey: ['drive-telemetry', driveId],
    queryFn: ({ signal }) => request<DriveTelemetryPoint[]>(`/drives/${driveId}/telemetry`, { signal }),
    enabled: !!driveId,
    select: safeArray,
  });
}

export function useDrivingCoach(vehicleId?: string, days = 30) {
  return useQuery({
    queryKey: drivingKeys.coach(vehicleId, days),
    queryFn: ({ signal }) => request<DrivingCoachData>(`/analytics/driving-coach?vehicle_id=${vehicleId}&days=${days}`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.SLOW,
  });
}

/* ── Trip Planner hooks─────────────────────────────────── */

export function usePlanTrip() {
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params: TripPlanRequest) =>
      request<TripPlan>('/trip-planner/plan', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => success('toast.trip.plan.success', 'Trip planned'),
    onError: (err) => error(err, 'toast.trip.plan.error', 'Failed to plan trip'),
  });
}

export function useGeocodeSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ['geocode-search', query],
    queryFn: ({ signal }) => request<GeocodeResult[]>(`/geocode/search?q=${encodeURIComponent(query)}&limit=5`, { signal }),
    enabled: enabled && query.length >= 3,
    staleTime: STALE_TIMES.SLOW,
    select: safeArray,
  });
}

/**
 * Result envelope for the standardized bulk endpoints.
 * Exactly one of `deleted` / `updated` is populated to match the verb of the
 * underlying endpoint; `failed` enumerates per-id failures with a stable
 * machine-readable reason ("not_found", "forbidden").
 */
export interface BulkOperationResult {
  deleted?: number;
  updated?: number;
  failed?: Array<{ id: number; reason: string }>;
}

/** Bulk delete drives. POST {ids:number[]} → BulkOperationResult. */
export function useBulkDeleteDrives() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<BulkOperationResult>('/drives/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['drives'] });
      qc.invalidateQueries({ queryKey: ['drive'] });
      success('toast.bulk.delete.success', '{{count}} deleted', {
        count: res.deleted ?? 0,
      });
    },
    onError: (err) =>
      error(err, 'toast.bulk.delete.error', 'Failed to delete selection'),
  });
}

/**
 * `useDriveWhyEnded` — diagnostic feed for the "Why did this drive end?"
 * section on DriveDetailPage. Joins the FSM transition history with the
 * raw signal window around the drive's end_ts (or now() while live).
 *
 * Lazy by default: pass `enabled=false` while the section is collapsed so
 * the network request only fires on operator expand. Refetches every
 * INTERVALS.STANDARD because both feeds are append-only on the server.
 *
 * Server validates `window` ∈ {30s, 60s, 5m, 15m} and rejects anything
 * else with 400 — the page renders a server-validated dropdown so this
 * hook does not pre-validate.
 */
export function useDriveWhyEnded(
  driveId: string | number,
  window: DriveDiagnosticWindow = '60s',
  enabled = true,
) {
  const id = String(driveId);
  return useQuery({
    queryKey: drivingKeys.whyEnded(id, window),
    queryFn: ({ signal }) =>
      request<DriveDiagnosticResponse>(
        `/drives/${encodeURIComponent(id)}/why-ended?window=${window}`,
        { signal },
      ),
    enabled: enabled && id !== '' && id !== '0',
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
