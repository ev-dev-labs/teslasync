import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES, INTERVALS } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
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

/** Fetches paginated driving sessions for a vehicle, optionally filtered by date range. */
export const getDrives = (vehicleId: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ApiDrive[]>(`/drives?${params}`)
}

export const drivingKeys = {
  drives: (vehicleId?: string) => ['drives', vehicleId] as const,
  drive: (id: string) => ['drives', id] as const,
  score: (vehicleId?: string) => ['drive-score', vehicleId] as const,
  stats: (vehicleId?: string) => ['driving-stats', vehicleId] as const,
  dynamics: (vehicleId?: string) => ['driving-dynamics', vehicleId] as const,
  accelerationDistribution: (vehicleId?: string) => ['acceleration-distribution', vehicleId] as const,
  drivetrainHealth: (vehicleId?: string) => ['drivetrain-health', vehicleId] as const,
  speedProfile: (vehicleId?: string) => ['speed-profile', vehicleId] as const,
  regenEfficiency: (vehicleId?: string) => ['regen-efficiency', vehicleId] as const,
  routeEfficiency: (vehicleId?: string) => ['route-efficiency', vehicleId] as const,
  coach: (vehicleId?: string, days?: number) => ['driving-coach', vehicleId, days] as const,
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

export function useSpeedProfile(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.speedProfile(vehicleId),
    queryFn: ({ signal }) =>
      request<SpeedProfileData>(
        vehicleId ? `/analytics/speed-profile?vehicle_id=${vehicleId}` : '/analytics/speed-profile', { signal },
      ),
    enabled: !!vehicleId,
  });
}

export function useRegenEfficiency(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.regenEfficiency(vehicleId),
    queryFn: ({ signal }) =>
      request<RegenEfficiencyData>(
        vehicleId ? `/analytics/regen?vehicle_id=${vehicleId}` : '/analytics/regen', { signal },
      ),
    enabled: !!vehicleId,
  });
}

export function useRouteEfficiency(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.routeEfficiency(vehicleId),
    queryFn: ({ signal }) =>
      request<RouteEfficiencyData>(
        vehicleId
          ? `/analytics/route-efficiency?vehicle_id=${vehicleId}`
          : '/analytics/route-efficiency', { signal },
      ),
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
  const toast = useToast();
  return useMutation({
    mutationFn: (params: TripPlanRequest) =>
      request<TripPlan>('/trip-planner/plan', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      toast.success('Trip planned');
    },
    onError: (err: Error) => {
      toast.error(`Failed to plan trip: ${err.message}`);
    },
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
 * Result envelope for the standardized bulk endpoints (Phase-40 / Prompt 51).
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
      success('toast.bulk.delete.success', '{{count}} deleted', {
        count: res.deleted ?? 0,
      });
    },
    onError: (err) =>
      error(err, 'toast.bulk.delete.error', 'Failed to delete selection'),
  });
}

