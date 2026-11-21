import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError, request } from '@/api/client';
import { expectedPrincipalHeader, personalIdentityKey, type PersonalScope } from './usePersonalIdentity';
import type { TripPacket, TripPacketEntry, TripPacketReview, TripPacketVersion } from '@/types/tripPacket';

type Scope = Extract<PersonalScope, { mode: 'forward_auth' }>;
type Change =
  | { kind: 'save'; version: TripPacketVersion; zone: string; paused: boolean }
  | { kind: 'clear'; version: TripPacketVersion }
  | { kind: 'entry'; version: TripPacketVersion; entry: TripPacketEntry }
  | { kind: 'dismiss'; version: TripPacketVersion; through: string }
  | { kind: 'export'; version: TripPacketVersion; digest: string };

const reviewKey = (scope: Scope, vehicle: number) => ['private-trip-packet', scope, vehicle] as const;

export function useTripPacket(scope: Scope, vehicle: number, drive?: number) {
  return useQuery({
    queryKey: [...reviewKey(scope, vehicle), drive],
    queryFn: ({ signal }) => request<TripPacketReview>(drive == null
      ? `/ownership/trip-packet?vehicle_id=${vehicle}`
      : `/ownership/trip-packet?vehicle_id=${vehicle}&drive_id=${drive}`, {
      signal, cache: 'no-store', headers: expectedPrincipalHeader(scope),
    }),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

export function useTripPacketChange(scope: Scope, vehicle: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: Change): Promise<TripPacket | null> => {
      const { id, revision } = change.version;
      const options = { cache: 'no-store', requiresLiveMode: true, headers: expectedPrincipalHeader(scope) } as const;
      const version = { plan_id: id, expected_revision: revision };
      if (change.kind === 'clear') {
        await request<void>(`/ownership/trip-packet?vehicle_id=${vehicle}&plan_id=${id}&expected_revision=${revision}`, { ...options, method: 'DELETE' });
        return null;
      }
      if (change.kind === 'export') {
        return request<TripPacket>(`/ownership/trip-packet?vehicle_id=${vehicle}`, {
          ...options, method: 'POST', body: JSON.stringify({ ...version, digest: change.digest, confirmed: true }),
        });
      }
      const body = change.kind === 'save' ? {
        ...version, time_zone: change.zone, paused: change.paused, confirmed: !change.paused,
      } : change.kind === 'entry' ? { ...version, entry: change.entry } : { ...version, dismiss_through: change.through };
      await request<void>(`/ownership/trip-packet?vehicle_id=${vehicle}`, {
        ...options, method: change.kind === 'save' ? 'PUT' : 'PATCH', body: JSON.stringify(body),
      });
      return null;
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
      if (change.kind !== 'export' || error) await client.invalidateQueries({ queryKey: reviewKey(scope, vehicle) });
    },
  });
}
