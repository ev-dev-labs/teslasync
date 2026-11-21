import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Reason = 'off' | 'drive_unmatched' | 'drive_changed' | 'expired' | 'missing_evidence' | 'evidence_limit' | 'observed';

interface DriveTrackReview {
  id: number;
  drive_id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  selected_at?: string;
  expires_at?: string;
  reason: Reason;
  track: { title: string; artist: string; source: string; duration_s?: number; observed_from: string; last_observed_at: string } | null;
  evidence_key?: string;
  save_status?: 'review' | 'saving' | 'saved' | 'rejected' | 'unknown';
  library_available: boolean;
  library_connected: boolean;
}

type Change = { action: 'look-up'; id: number; offset: number; startedAt: string; endedAt: string }
  | { action: 'connect' | 'disconnect' | 'clear'; id: number }
  | { action: 'save'; id: number; evidence: string; link: string };

const key = (scope: Scope, vehicle: number, drive: number) => ['private-drive-track', scope, vehicle, drive] as const;

export function useDriveTrackReview(scope: Scope, vehicle: number, drive: number) {
  return useQuery({
    queryKey: key(scope, vehicle, drive),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: DriveTrackReview }>(`/media/drive-track/${drive}?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) => state.data?.save_status === 'saving' ? 5000 : false,
  });
}

export function useDriveTrackChange(scope: Scope, vehicle: number, drive: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change): Promise<{ authorization_url: string } | void> => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      switch (change.action) {
        case 'look-up':
          return request<void>(`/media/drive-track/${drive}?vehicle_id=${vehicle}`, {
            ...options, method: 'PUT', body: JSON.stringify({
              confirmed: true, expected_review_id: change.id, started_at: change.startedAt,
              ended_at: change.endedAt, offset_s: change.offset,
            }),
          });
        case 'clear':
          return request<void>(`/media/drive-track/${drive}?vehicle_id=${vehicle}&review_id=${change.id}`, { ...options, method: 'DELETE' });
        case 'connect': {
          const { data } = await request<{ data: { authorization_url: string } }>(`/media/drive-track/${drive}/spotify?vehicle_id=${vehicle}&review_id=${change.id}`, {
            ...options, method: 'POST', body: JSON.stringify({ confirmed: true }),
          });
          return data;
        }
        case 'disconnect':
          return request<void>(`/media/drive-track/${drive}/spotify?vehicle_id=${vehicle}&review_id=${change.id}`, { ...options, method: 'DELETE' });
        case 'save':
          await request(`/media/drive-track/${drive}/spotify/save?vehicle_id=${vehicle}&review_id=${change.id}`, {
            ...options, method: 'POST', body: JSON.stringify({ confirmed: true, evidence_key: change.evidence, spotify_track: change.link }),
          });
      }
    },
    networkMode: 'always',
    gcTime: 0,
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async (_result, error, change) => {
      const filter = { queryKey: key(scope, vehicle, drive), exact: true } as const;
      if (change.action === 'clear' || change.action === 'look-up' ||
          (isApiError(error) && error.code === 'DRIVE_TRACK_REVIEW_CHANGED')) {
        await client.resetQueries(filter);
      } else {
        await client.invalidateQueries(filter);
      }
    },
  });
}
