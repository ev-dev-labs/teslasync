import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { action: 'confirm'; id: number; startedAt: string; endedAt: string }
  | { action: 'pause' | 'snooze' | 'clear'; id: number };
type Reason = 'off' | 'journey_unmatched' | 'journey_changed' | 'expired' | 'held' | 'missing_evidence' | 'evidence_limit' | 'observed';

interface SoundtrackReview {
  id: number;
  journey_id: number;
  vehicle_id: number;
  started_at: string | null;
  ended_at: string | null;
  expires_at?: string;
  paused: boolean;
  snoozed_until?: string;
  reason: Reason;
  matched_drives: number;
  observed_drives: number;
  plays: { title: string; artist: string; identity_at: string; observed_from: string; last_observed_at: string }[];
}

const key = (scope: Scope, vehicle: number, journey: number) => ['journey-soundtrack', scope, vehicle, journey] as const;

export function useJourneySoundtrack(scope: Scope, vehicle: number, journey: number) {
  return useQuery({
    queryKey: key(scope, vehicle, journey),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: SoundtrackReview }>(`/media/journey-soundtrack/${journey}?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useJourneySoundtrackChange(scope: Scope, vehicle: number, journey: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Change) => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.action === 'confirm') {
        return request<void>(`/media/journey-soundtrack/${journey}?vehicle_id=${vehicle}`, {
          ...options, method: 'PUT', body: JSON.stringify({
            confirmed: true, expected_review_id: change.id, started_at: change.startedAt, ended_at: change.endedAt,
          }),
        });
      }
      if (change.action === 'clear') {
        return request<void>(`/media/journey-soundtrack/${journey}?vehicle_id=${vehicle}&review_id=${change.id}`, {
          ...options, method: 'DELETE',
        });
      }
      return request<void>(`/media/journey-soundtrack/${journey}?vehicle_id=${vehicle}&review_id=${change.id}`, {
        ...options, method: 'PATCH', body: JSON.stringify({ action: change.action }),
      });
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
      const filter = { queryKey: key(scope, vehicle, journey), exact: true } as const;
      if (change.action !== 'confirm' || (isApiError(error) && error.code === 'SOUNDTRACK_REVIEW_CHANGED')) {
        await client.resetQueries(filter);
      } else {
        await client.invalidateQueries(filter);
      }
    },
  });
}
