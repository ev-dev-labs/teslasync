import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { Drive as ApiDrive } from '../types';
import type {
  Drive,
  DriveDetail,
  DriveScore,
  DrivingStats,
  DrivingDynamicsData,
  DrivetrainHealthData,
  SpeedProfileData,
  RegenEfficiencyData,
  RouteEfficiencyData,
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
  drivetrainHealth: (vehicleId?: string) => ['drivetrain-health', vehicleId] as const,
  speedProfile: (vehicleId?: string) => ['speed-profile', vehicleId] as const,
  regenEfficiency: (vehicleId?: string) => ['regen-efficiency', vehicleId] as const,
  routeEfficiency: (vehicleId?: string) => ['route-efficiency', vehicleId] as const,
};

export function useDrives(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drives(vehicleId),
    queryFn: () =>
      request<Drive[]>(vehicleId ? `/drives?vehicleId=${vehicleId}` : '/drives'),
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
        vehicleId ? `/drives/score?vehicleId=${vehicleId}` : '/drives/score',
      ),
  });
}

export function useDrivingStats(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.stats(vehicleId),
    queryFn: () =>
      request<DrivingStats>(
        vehicleId ? `/drives/stats?vehicleId=${vehicleId}` : '/drives/stats',
      ),
  });
}

export function useDrivingDynamics(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.dynamics(vehicleId),
    queryFn: () =>
      request<DrivingDynamicsData>(
        vehicleId ? `/drives/dynamics?vehicleId=${vehicleId}` : '/drives/dynamics',
      ),
  });
}

export function useDrivetrainHealth(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drivetrainHealth(vehicleId),
    queryFn: () =>
      request<DrivetrainHealthData>(
        vehicleId
          ? `/drivetrain/health?vehicleId=${vehicleId}`
          : '/drivetrain/health',
      ),
  });
}

export function useSpeedProfile(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.speedProfile(vehicleId),
    queryFn: () =>
      request<SpeedProfileData>(
        vehicleId ? `/drives/speed-profile?vehicleId=${vehicleId}` : '/drives/speed-profile',
      ),
  });
}

export function useRegenEfficiency(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.regenEfficiency(vehicleId),
    queryFn: () =>
      request<RegenEfficiencyData>(
        vehicleId ? `/drives/regen?vehicleId=${vehicleId}` : '/drives/regen',
      ),
  });
}

export function useRouteEfficiency(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.routeEfficiency(vehicleId),
    queryFn: () =>
      request<RouteEfficiencyData>(
        vehicleId
          ? `/drives/route-efficiency?vehicleId=${vehicleId}`
          : '/drives/route-efficiency',
      ),
  });
}
