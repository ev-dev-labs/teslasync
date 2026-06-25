import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

const STALE_TIMES = {
  SLOW: 5 * 60_000,
} as const;

export const nativeSharingHookCapabilities = {
  publicShareEndpointAvailable: true,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

export interface ShareToken {
  id: number;
  token: string;
  drive_id: number;
  created_by: string | null;
  title: string | null;
  description: string | null;
  include_map: boolean;
  include_telemetry: boolean;
  include_speed: boolean;
  views: number;
  expires_at: string | null;
  created_at: string;
}

export interface SharedDriveInfo {
  date: string;
  distance_m: number;
  duration_s: number;
  start_address: string;
  end_address: string;
  start_battery: number | null;
  end_battery: number | null;
  elevation_gain: number | null;
  elevation_loss: number | null;
  max_speed_mps: number | null;
  avg_speed_mps: number | null;
  efficiency_wh_per_m: number | null;
}

export interface SharedVehicle {
  model: string;
  color: string;
}

export interface SharedMapPoint {
  lat: number;
  lng: number;
}

export interface SharedElevationPoint {
  distance_m: number;
  elevation_m: number;
}

export interface SharedSpeedPoint {
  distance_m: number;
  speed_mps: number;
}

export interface SharedTelemetryPoint {
  distance_m: number;
  battery_level: number | null;
  power: number | null;
  elevation: number | null;
}

export interface SharedDriveData {
  payload_version: 'v2' | 'v1';
  title: string;
  description: string;
  drive: SharedDriveInfo;
  vehicle: SharedVehicle | null;
  map_points: SharedMapPoint[] | null;
  elevation_profile: SharedElevationPoint[] | null;
  speed_profile: SharedSpeedPoint[] | null;
  telemetry: SharedTelemetryPoint[] | null;
}

export interface CreateShareRequest {
  title?: string;
  description?: string;
  include_speed?: boolean;
  include_telemetry?: boolean;
  expires_in_days?: number;
}

export interface CreateShareResponse {
  token: string;
  url: string;
  id: number;
}

export interface SharedDriveDataV1 {
  title: string;
  description: string;
  drive: {
    date: string;
    distance_km: number;
    duration_min: number;
    start_address: string;
    end_address: string;
    start_battery: number | null;
    end_battery: number | null;
    elevation_gain: number | null;
    elevation_loss: number | null;
    max_speed_kmh: number | null;
    avg_speed_kmh: number | null;
    efficiency_wh_km: number | null;
  };
  vehicle: SharedVehicle | null;
  map_points: SharedMapPoint[] | null;
  elevation_profile: {distance_km: number; elevation_m: number}[] | null;
  speed_profile: {distance_km: number; speed_kmh: number}[] | null;
  telemetry:
    | {
        distance_km: number;
        battery_level: number | null;
        power: number | null;
        elevation: number | null;
      }[]
    | null;
}

export const sharingKeys = {
  shares: (driveId: string) => ['shares', driveId] as const,
  shared: (token: string) => ['shared-drive', token] as const,
};

/** Creates a share link for a drive (authenticated). */
export function useCreateShareLink(driveId: string) {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();

  return useMutation({
    mutationFn: (data: CreateShareRequest) =>
      request<CreateShareResponse>(`/drives/${driveId}/share`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: sharingKeys.shares(driveId),
      });
      success('toast.sharing.create.success', 'Share link created');
    },
    onError: err =>
      error(err, 'toast.sharing.create.error', 'Failed to create share link'),
  });
}

/** Lists all share links for a drive (authenticated). */
export function useShareLinks(driveId: string) {
  return useQuery({
    queryKey: sharingKeys.shares(driveId),
    queryFn: ({signal}) =>
      request<ShareToken[]>(`/drives/${driveId}/shares`, {signal}),
    enabled: !!driveId,
  });
}

/** Revokes (deletes) a share link (authenticated). */
export function useRevokeShareLink(driveId: string) {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();

  return useMutation({
    mutationFn: (token: string) =>
      request<{status: string}>(`/shares/${token}`, {method: 'DELETE'}),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: sharingKeys.shares(driveId),
      });
      success('toast.sharing.revoke.success', 'Share link revoked');
    },
    onError: err =>
      error(err, 'toast.sharing.revoke.error', 'Failed to revoke share link'),
  });
}

/**
 * Fetches shared drive data via the public endpoint.
 * The share endpoint is mounted before auth middleware on the backend,
 * so no authentication is required.
 */
export function useSharedDrive(token: string) {
  return useQuery({
    queryKey: sharingKeys.shared(token),
    queryFn: ({signal}) =>
      request<SharedDriveData | SharedDriveDataV1>(`/share/${token}`, {
        signal,
      }),
    enabled: !!token,
    retry: false,
    staleTime: STALE_TIMES.SLOW,
  });
}
