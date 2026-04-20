import { useQuery, useMutation } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
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
    queryFn: () =>
      request<Drive[]>(vehicleId ? `/drives?vehicle_id=${vehicleId}` : '/drives'),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useDrive(id: string) {
  return useQuery({
    queryKey: drivingKeys.drive(id),
    queryFn: () => request<DriveDetail>(`/drives/${id}`),
    enabled: !!id,
  });
}

export function useDriveScore(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.score(vehicleId),
    queryFn: () =>
      request<DriveScore>(
        vehicleId ? `/drives/score?vehicle_id=${vehicleId}` : '/drives/score',
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivingStats(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.stats(vehicleId),
    queryFn: () =>
      request<DrivingStats>(
        vehicleId ? `/drives/stats?vehicle_id=${vehicleId}` : '/drives/stats',
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivingDynamics(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.dynamics(vehicleId),
    queryFn: () =>
      request<DrivingDynamicsData>(
        vehicleId ? `/drives/dynamics?vehicle_id=${vehicleId}` : '/drives/dynamics',
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useAccelerationDistribution(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.accelerationDistribution(vehicleId),
    queryFn: () =>
      request<AccelerationDistributionData>(
        vehicleId
          ? `/drives/acceleration-distribution?vehicle_id=${vehicleId}`
          : '/drives/acceleration-distribution',
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useDrivetrainHealth(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drivetrainHealth(vehicleId),
    queryFn: () =>
      request<DrivetrainHealthData>(
        vehicleId
          ? `/drivetrain/health?vehicle_id=${vehicleId}`
          : '/drivetrain/health',
      ),
    enabled: !!vehicleId,
    retry: false,
  });
}

export function useSpeedProfile(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.speedProfile(vehicleId),
    queryFn: () =>
      request<SpeedProfileData>(
        vehicleId ? `/analytics/speed-profile?vehicle_id=${vehicleId}` : '/analytics/speed-profile',
      ),
    enabled: !!vehicleId,
  });
}

export function useRegenEfficiency(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.regenEfficiency(vehicleId),
    queryFn: () =>
      request<RegenEfficiencyData>(
        vehicleId ? `/analytics/regen?vehicle_id=${vehicleId}` : '/analytics/regen',
      ),
    enabled: !!vehicleId,
  });
}

export function useRouteEfficiency(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.routeEfficiency(vehicleId),
    queryFn: () =>
      request<RouteEfficiencyData>(
        vehicleId
          ? `/analytics/route-efficiency?vehicle_id=${vehicleId}`
          : '/analytics/route-efficiency',
      ),
    enabled: !!vehicleId,
  });
}

export function useDrivePositions(driveId: string) {
  return useQuery({
    queryKey: ['drive-positions', driveId],
    queryFn: () => request<DrivePosition[]>(`/drives/${driveId}/positions`),
    enabled: !!driveId,
    select: safeArray,
  });
}

export function useDriveTelemetry(driveId: string) {
  return useQuery({
    queryKey: ['drive-telemetry', driveId],
    queryFn: () => request<DriveTelemetryPoint[]>(`/drives/${driveId}/telemetry`),
    enabled: !!driveId,
    select: safeArray,
  });
}

export function useDrivingCoach(vehicleId?: string, days = 30) {
  return useQuery({
    queryKey: drivingKeys.coach(vehicleId, days),
    queryFn: () => request<DrivingCoachData>(`/analytics/driving-coach?vehicle_id=${vehicleId}&days=${days}`),
    enabled: !!vehicleId,
    staleTime: 5 * 60_000,
  });
}

/* ── Trip Planner hooks ─────────────────────────────────── */

export function usePlanTrip() {
  return useMutation({
    mutationFn: (params: TripPlanRequest) =>
      request<TripPlan>('/trip-planner/plan', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  });
}

export function useGeocodeSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ['geocode-search', query],
    queryFn: () => request<GeocodeResult[]>(`/geocode/search?q=${encodeURIComponent(query)}&limit=5`),
    enabled: enabled && query.length >= 3,
    staleTime: 5 * 60_000,
    select: safeArray,
  });
}
