import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';

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
  reliability: (vehicleId: string | number | undefined, from: string, to: string) =>
    ['command-history', vehicleKeyPart(vehicleId), 'reliability', from, to] as const,
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

/** Every command attempt in the selected window, using a stable log cursor. */
export function useCommandReliabilityHistory(
  vehicleId: string | number | undefined,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: commandKeys.reliability(vehicleId, from, to),
    queryFn: async ({ signal }) => {
      const entries: CommandLogEntry[] = [];
      let cursor: Pick<CommandLogEntry, 'created_at' | 'id'> | undefined;
      for (;;) {
        const params = new URLSearchParams({ from, to, limit: '1000' });
        if (cursor) {
          params.set('before_created_at', cursor.created_at);
          params.set('before_id', String(cursor.id));
        }
        const page = await request<CommandLogEntry[]>(
          `/vehicles/${encodeURIComponent(String(vehicleId))}/commands/history?${params}`,
          { signal },
        );
        if (!Array.isArray(page)) throw new Error('Invalid command history response');
        entries.push(...page);
        if (page.length < 1000) return entries;
        const last = page[page.length - 1]!;
        if (!last.created_at || !Number.isSafeInteger(last.id) || last.id <= 0 ||
            (cursor && cursor.created_at === last.created_at && cursor.id === last.id)) {
          throw new Error('Command history cursor did not advance');
        }
        cursor = { created_at: last.created_at, id: last.id };
      }
    },
    enabled: !!vehicleId && !!from && !!to,
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
    refetchInterval: INTERVALS.STANDARD,
  });
}
