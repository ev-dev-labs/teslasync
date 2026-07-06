import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';
import { safeArray } from '@/lib/safeArray';
import { useMutationToast } from './_toastHelpers';
import type {
  ShareToken,
  SharedDriveData,
  SharedDriveDataV1,
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
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (data: CreateShareRequest) =>
      request<CreateShareResponse>(`/drives/${driveId}/share`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sharingKeys.shares(driveId) });
      success('share.toast.created', 'Share link created');
    },
    onError: (err) => error(err, 'share.toast.createError', 'Failed to create share link'),
  });
}

/** Lists all share links for a drive (authenticated). */
export function useShareLinks(driveId: string) {
  return useQuery({
    queryKey: sharingKeys.shares(driveId),
    queryFn: ({ signal }) => request<ShareToken[]>(`/drives/${driveId}/shares`, { signal }),
    enabled: !!driveId,
    // Guarantee an array even if the endpoint yields null/non-array so
    // consumers can `.map`/`.filter`/`.length` without a guard.
    select: safeArray,
  });
}

/** Revokes (deletes) a share link (authenticated). */
export function useRevokeShareLink(driveId: string) {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (token: string) =>
      request<{ status: string }>(`/shares/${token}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sharingKeys.shares(driveId) });
      success('share.toast.revoked', 'Share link revoked');
    },
    onError: (err) => error(err, 'share.toast.revokeError', 'Failed to revoke share link'),
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
    queryFn: ({ signal }) => request<SharedDriveData | SharedDriveDataV1>(`/share/${token}`, { signal }),
    enabled: !!token,
    retry: false,
    staleTime: STALE_TIMES.SLOW,
  });
}
