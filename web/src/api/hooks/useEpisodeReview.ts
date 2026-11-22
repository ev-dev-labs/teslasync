import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;

interface EpisodeReview {
  id: number;
  vehicle_id: number;
  departure_at?: string;
  expires_at?: string;
  drive_duration_s?: number;
  remaining_s?: number;
  reason: 'off' | 'expired' | 'awaiting_progress' | 'drive_unmatched' | 'unknown_progress' | 'completed' | 'not_fit' | 'fits';
  title?: string;
  spotify_episode?: string;
  spotify_start_s?: number;
  spotify_available: boolean;
}

interface Confirmation {
  expected_review_id: number;
  confirmed: true;
  departure_at: string;
  drive_duration_s: number;
  spotify_episode: string;
  manual: { title: string; duration_s: number; position_s: number | null } | null;
}

type Change = { action: 'confirm'; payload: Confirmation } | { action: 'clear'; id: number };
const key = (scope: Scope, vehicle: number) => ['private-episode-review', scope, vehicle] as const;

export function useEpisodeReview(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: key(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: EpisodeReview }>(`/media/episode-review?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useEpisodeReviewChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change): Promise<string | void> => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.action === 'clear') {
        return request<void>(`/media/episode-review?vehicle_id=${vehicle}&review_id=${change.id}`, { ...options, method: 'DELETE' });
      }
      const { data } = await request<{ data: { authorization_url: string } }>(`/media/episode-review?vehicle_id=${vehicle}`, {
        ...options, method: 'PUT', body: JSON.stringify(change.payload),
      });
      return data.authorization_url;
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
      const filter = { queryKey: key(scope, vehicle), exact: true } as const;
      if (change.action === 'clear' || (isApiError(error) && error.code === 'EPISODE_REVIEW_CHANGED')) {
        await client.resetQueries(filter);
      } else {
        await client.invalidateQueries(filter);
      }
    },
  });
}
