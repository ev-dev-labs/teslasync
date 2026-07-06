import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

export interface CommandLogEntry {
  id: number;
  vehicle_id: number;
  command: string;
  params: string;
  status: string;
  error: string;
  created_at: string;
}

/**
 * Normalises a vehicle id to a string for query-key identity. Callers hold
 * the id as either a number (`vehicle.id`) or a string (route params), and
 * both forms must resolve to the same cache entry so an invalidation issued
 * from either side hits the live query. `undefined` is preserved unchanged
 * so a disabled query keeps a distinct, stable key instead of colliding on
 * the string `'undefined'`.
 */
function vehicleKeyPart(vehicleId: string | number | undefined): string | undefined {
  return vehicleId == null ? undefined : String(vehicleId);
}

export const commandKeys = {
  history: (vehicleId: string | number | undefined) =>
    ['command-history', vehicleKeyPart(vehicleId)] as const,
  latest: (vehicleId: string | number | undefined) =>
    ['command-latest', vehicleKeyPart(vehicleId)] as const,
};

/** Fetch recent command log for a vehicle. */
export function useCommandHistory(vehicleId: string | number | undefined) {
  return useQuery({
    queryKey: commandKeys.history(vehicleId),
    queryFn: async ({ signal }) => {
      const data = await request<CommandLogEntry[]>(
        `/vehicles/${encodeURIComponent(String(vehicleId))}/commands/history?limit=200`,
        { signal },
      );
      // A 204 / null body resolves to undefined|null from the client; coerce
      // at the fetch boundary so TanStack Query always caches a defined array
      // (returning undefined from a queryFn is a hard error) and every caller
      // can iterate the result without a guard.
      return data ?? [];
    },
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.QUICK,
  });
}

/** Fetch latest command per command-name for a vehicle. */
export function useCommandLatest(vehicleId: string | number | undefined) {
  return useQuery({
    queryKey: commandKeys.latest(vehicleId),
    queryFn: async ({ signal }) => {
      const data = await request<CommandLogEntry[]>(
        `/vehicles/${encodeURIComponent(String(vehicleId))}/commands/latest`,
        { signal },
      );
      return data ?? [];
    },
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.MODERATE,
  });
}
