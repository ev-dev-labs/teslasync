import { useQuery } from '@tanstack/react-query';

import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { scopeKey, scopedPath, type QueryScope } from '../scope';
import type { PhysicsLedger } from '../types';

export const physicsLedgerKeys = {
  window: (scope: QueryScope) => ['physics', 'ledger', ...scopeKey(scope)] as const,
  drive: (driveId: string) => ['physics', 'drive-ledger', driveId] as const,
  charge: (sessionId: string) => ['physics', 'charge-ledger', sessionId] as const,
  park: (scope: QueryScope) => ['physics', 'park-ledger', ...scopeKey(scope)] as const,
};

export interface LedgerWindow {
  vehicleId: string | undefined;
  start?: string | null;
  end?: string | null;
}

/** Solves an arbitrary window. Start/end are ISO-8601; omitted means trailing 24h. */
export function usePhysicsLedger({ vehicleId, start, end }: LedgerWindow) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null, start: start ?? null, end: end ?? null };
  return useQuery({
    queryKey: physicsLedgerKeys.window(scope),
    queryFn: ({ signal }) => request<PhysicsLedger>(scopedPath('/physics/ledger', scope), { signal }),
    enabled: !!vehicleId,
    ...queryPolicy('historical'),
  });
}

export function useDriveLedger(driveId: string | undefined) {
  return useQuery({
    queryKey: physicsLedgerKeys.drive(driveId ?? ''),
    queryFn: ({ signal }) => request<PhysicsLedger>(`/physics/drives/${driveId}/ledger`, { signal }),
    enabled: !!driveId,
    ...queryPolicy('historical'),
  });
}

export function useChargeLedger(sessionId: string | undefined) {
  return useQuery({
    queryKey: physicsLedgerKeys.charge(sessionId ?? ''),
    queryFn: ({ signal }) => request<PhysicsLedger>(`/physics/charging/${sessionId}/ledger`, { signal }),
    enabled: !!sessionId,
    ...queryPolicy('historical'),
  });
}

export function useParkLedger({ vehicleId, start, end }: LedgerWindow) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null, start: start ?? null, end: end ?? null };
  return useQuery({
    queryKey: physicsLedgerKeys.park(scope),
    queryFn: ({ signal }) => request<PhysicsLedger>(scopedPath('/physics/park/ledger', scope), { signal }),
    enabled: !!vehicleId,
    ...queryPolicy('historical'),
  });
}
