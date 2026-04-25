import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';
import type {
  ShareToken,
  SharedDriveData,
  CreateShareRequest,
  CreateShareResponse,
} from '@/types/sharing';

export const sharingKeys = {
  shares: (driveId: string) => ['shares', driveId] as const,
  shared: (token: string) => ['shared-drive', token] as const,
};

/** Creates a share link for a drive (authenticated). */
export function useCreateShareLink(driveId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateShareRequest) =>
      request<CreateShareResponse>(`/drives/${driveId}/share`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sharingKeys.shares(driveId) });
    },
  });
}

/** Lists all share links for a drive (authenticated). */
export function useShareLinks(driveId: string) {
  return useQuery({
    queryKey: sharingKeys.shares(driveId),
    queryFn: () => request<ShareToken[]>(`/drives/${driveId}/shares`),
    enabled: !!driveId,
  });
}

/** Revokes (deletes) a share link (authenticated). */
export function useRevokeShareLink(driveId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      request<{ status: string }>(`/shares/${token}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sharingKeys.shares(driveId) });
    },
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
    queryFn: () => request<SharedDriveData>(`/share/${token}`),
    enabled: !!token,
    retry: false,
    staleTime: STALE_TIMES.SLOW,
  });
}
