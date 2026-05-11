import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
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
  const toast = useToast();
  return useMutation({
    mutationFn: (data: CreateShareRequest) =>
      request<CreateShareResponse>(`/drives/${driveId}/share`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sharingKeys.shares(driveId) });
      toast.success('Share link created');
    },
    onError: (err: Error) => {
      toast.error(`Failed to create share link: ${err.message}`);
    },
  });
}

/** Lists all share links for a drive (authenticated). */
export function useShareLinks(driveId: string) {
  return useQuery({
    queryKey: sharingKeys.shares(driveId),
    queryFn: ({ signal }) => request<ShareToken[]>(`/drives/${driveId}/shares`, { signal }),
    enabled: !!driveId,
  });
}

/** Revokes (deletes) a share link (authenticated). */
export function useRevokeShareLink(driveId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (token: string) =>
      request<{ status: string }>(`/shares/${token}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sharingKeys.shares(driveId) });
      toast.success('Share link revoked');
    },
    onError: (err: Error) => {
      toast.error(`Failed to revoke share link: ${err.message}`);
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
    queryFn: ({ signal }) => request<SharedDriveData | SharedDriveDataV1>(`/share/${token}`, { signal }),
    enabled: !!token,
    retry: false,
    staleTime: STALE_TIMES.SLOW,
  });
}
