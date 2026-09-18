import { useQuery } from '@tanstack/react-query';

import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { scopeKey, scopedPath, type QueryScope } from '../scope';
import type { PhysicsLedger } from '../types';

/**
 * Ledger JSON is the object itself. Older analysis handlers wrapped it as
 * `{ data: ledger }`; request() does not unwrap, and the page then renders
 * every panel as empty (no kind, no drive, unknown hours 0).
 */
export function readPhysicsLedger(body: unknown): PhysicsLedger {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return body as PhysicsLedger;
  }
  const rec = body as Record<string, unknown>;
  const nested = rec.data;
  const looksLikeLedger = (value: unknown): value is PhysicsLedger =>
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('kind' in value || 'honesty' in value || 'drive' in value || 'dynamics' in value);
  if (!looksLikeLedger(body) && looksLikeLedger(nested)) {
    return nested;
  }
  return body as PhysicsLedger;
}

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
    queryFn: async ({ signal }) =>
      readPhysicsLedger(await request<unknown>(scopedPath('/physics/ledger', scope), { signal })),
    enabled: !!vehicleId,
    ...queryPolicy('historical'),
  });
}

export function useDriveLedger(driveId: string | undefined) {
  return useQuery({
    queryKey: physicsLedgerKeys.drive(driveId ?? ''),
    queryFn: async ({ signal }) =>
      readPhysicsLedger(await request<unknown>(`/physics/drives/${driveId}/ledger`, { signal })),
    enabled: !!driveId,
    ...queryPolicy('historical'),
  });
}

export function useChargeLedger(sessionId: string | undefined) {
  return useQuery({
    queryKey: physicsLedgerKeys.charge(sessionId ?? ''),
    queryFn: async ({ signal }) =>
      readPhysicsLedger(await request<unknown>(`/physics/charging/${sessionId}/ledger`, { signal })),
    enabled: !!sessionId,
    ...queryPolicy('historical'),
  });
}

export function useParkLedger({ vehicleId, start, end }: LedgerWindow) {
  const scope: QueryScope = { vehicleId: vehicleId ?? null, start: start ?? null, end: end ?? null };
  return useQuery({
    queryKey: physicsLedgerKeys.park(scope),
    queryFn: async ({ signal }) =>
      readPhysicsLedger(await request<unknown>(scopedPath('/physics/park/ledger', scope), { signal })),
    enabled: !!vehicleId,
    ...queryPolicy('historical'),
  });
}
