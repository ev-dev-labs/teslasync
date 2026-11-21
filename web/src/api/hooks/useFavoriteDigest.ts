import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;

export interface FavoriteRecording {
  key: string;
  title: string;
  artist: string;
  source: 'spotify' | 'youtube_music' | 'apple_music' | 'tidal' | 'bluetooth' | 'usb';
  duration_s: number;
}

interface FavoriteCandidate extends FavoriteRecording {
  observed_drives: number;
  observed_dates: number;
}

interface FavoriteDigest {
  vehicle_id: number;
  revision: number;
  time_zone?: string;
  next_at?: string;
  digest?: { from: string; until: string; expires_at: string; candidates: FavoriteCandidate[] };
  favorites: FavoriteRecording[];
}

type Change =
  | { kind: 'enable' | 'pause'; revision: number; zone: string }
  | { kind: 'clear'; revision: number }
  | { kind: 'confirm'; revision: number; digestUntil: string; key: string }
  | { kind: 'dismiss'; revision: number; digestUntil: string }
  | { kind: 'remove'; revision: number; key: string };

const queryKey = (scope: Scope, vehicle: number) => ['private-favorite-digest', scope, vehicle] as const;

export function useFavoriteDigest(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: queryKey(scope, vehicle),
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: FavoriteDigest }>(`/media/favorite-digest?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useFavoriteDigestChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change): Promise<void> => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      if (change.kind === 'clear') {
        return request<void>(`/media/favorite-digest?vehicle_id=${vehicle}&revision=${change.revision}`, { ...options, method: 'DELETE' });
      }
      if ('zone' in change) {
        return request<void>(`/media/favorite-digest?vehicle_id=${vehicle}`, { ...options, method: 'PUT', body: JSON.stringify({
          expected_revision: change.revision, confirmed: true, time_zone: change.zone, paused: change.kind === 'pause',
        }) });
      }
      return request<void>(`/media/favorite-digest?vehicle_id=${vehicle}`, { ...options, method: 'POST', body: JSON.stringify({
        action: change.kind, revision: change.revision,
        digest_until: 'digestUntil' in change ? change.digestUntil : undefined,
        key: 'key' in change ? change.key : undefined,
      }) });
    },
    networkMode: 'always',
    gcTime: 0,
    retry: false,
    onError: (error) => {
      if (isApiError(error) && error.code === 'IDENTITY_CHANGED') {
        void client.invalidateQueries({ queryKey: personalIdentityKey });
      }
    },
    onSettled: async () => { await client.invalidateQueries({ queryKey: queryKey(scope, vehicle) }); },
  });
}
