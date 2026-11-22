import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlaylistReview, PlaylistSaveStatus, PlaylistSetup, SavePrivatePlaylist } from '@/types/privatePlaylist';
import { isApiError, request } from '../client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change = { action: 'preview'; id: number; setup: PlaylistSetup }
  | { action: 'pause' | 'snooze' | 'clear'; id: number }
  | { action: 'save'; id: number; selection: SavePrivatePlaylist }
  | { action: 'connect' | 'disconnect' };

type Result = { authorization_url?: string; status?: PlaylistSaveStatus } | void;
const key = (scope: Scope) => ['private-playlist', scope] as const;

export function usePrivatePlaylist(scope: Scope, vehicle: number) {
  return useQuery({
    queryKey: [...key(scope), vehicle],
    queryFn: async ({ signal }) => {
      const { data } = await request<{ data: PlaylistReview }>(`/media/playlist-review?vehicle_id=${vehicle}`, {
        signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
      });
      return data;
    },
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) => state.data?.draft?.status === 'saving' ? 5000 : false,
  });
}

export function usePrivatePlaylistChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change): Promise<Result> => {
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      switch (change.action) {
        case 'connect': {
          const { data } = await request<{ data: { authorization_url: string } }>(`/media/spotify/connection?vehicle_id=${vehicle}`, {
            ...options, method: 'POST', body: JSON.stringify({ confirmed: true }),
          });
          return data;
        }
        case 'disconnect':
          return request<void>('/media/spotify/connection', { ...options, method: 'DELETE' });
        case 'preview':
          return request<void>(`/media/playlist-review?vehicle_id=${vehicle}`, {
            ...options, method: 'PUT', body: JSON.stringify({ ...change.setup, expected_draft_id: change.id }),
          });
        case 'clear':
          return request<void>(`/media/playlist-review?vehicle_id=${vehicle}&draft_id=${change.id}`, { ...options, method: 'DELETE' });
        case 'pause':
        case 'snooze':
          return request<void>(`/media/playlist-review?vehicle_id=${vehicle}&draft_id=${change.id}`, {
            ...options, method: 'PATCH', body: JSON.stringify({ action: change.action }),
          });
        case 'save': {
          const { data } = await request<{ data: { status: PlaylistSaveStatus } }>(`/media/playlist-review/save?vehicle_id=${vehicle}&draft_id=${change.id}`, {
            ...options, method: 'POST', body: JSON.stringify(change.selection),
          });
          return data;
        }
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
      if (change.action === 'clear' || change.action === 'pause' || change.action === 'snooze' || change.action === 'preview' ||
          (isApiError(error) && error.code === 'PLAYLIST_REVIEW_CHANGED')) {
        await client.resetQueries({ queryKey: [...key(scope), vehicle], exact: true });
      } else {
        await client.invalidateQueries({ queryKey: key(scope) });
      }
    },
  });
}
