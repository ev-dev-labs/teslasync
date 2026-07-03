import { useMutation, useQuery } from '@tanstack/react-query';

import { INTERVALS } from '@/lib/constants';
import {
  getRedisSignals,
  purgeAllRedisSignals,
  purgeRedisSignals,
  type RedisSignalEntry,
  type RedisSignalsMeta,
  type RedisSignalsResponse,
  type RedisSignalsPurgeResponse,
  type RedisSignalsPurgeAllResponse,
} from '@/api/devtools';

/**
 * TanStack Query hooks for the Redis L2 signal cache surface used by the
 * Redis Signal Viewer admin page. They wrap the typed request helpers in
 * `@/api/devtools` (which already target the un-prefixed, snake_case
 * `/dev-tools/redis-signals` routes) so pages load data exclusively through
 * `@/api/hooks/*` per the frontend architecture rules.
 *
 * The read query key stays `['redis-signals', vehicleId]` and the purge
 * mutations call the same devtools functions so cache invalidation and the
 * page's toast orchestration keep their existing contract.
 */

export const redisSignalKeys = {
  all: ['redis-signals'] as const,
  detail: (vehicleId: number | null) => ['redis-signals', vehicleId] as const,
  keys: ['redis-signal-keys'] as const,
};

export type { RedisSignalEntry, RedisSignalsMeta, RedisSignalsResponse };

/**
 * Reads every cached signal for a vehicle from the Redis L2 HSET.
 * Disabled until a vehicle is selected; polls at the realtime interval
 * while `autoRefresh` is on so the viewer can watch live telemetry land.
 */
export function useRedisSignals(vehicleId: number | null, autoRefresh: boolean) {
  return useQuery({
    queryKey: redisSignalKeys.detail(vehicleId),
    queryFn: () => getRedisSignals(vehicleId as number),
    enabled: vehicleId !== null,
    refetchInterval: autoRefresh ? INTERVALS.REALTIME : false,
  });
}

/** Purges a single vehicle's Redis L2 HSET. Returns the raw response so the
 *  caller drives its own toast + query invalidation. */
export function usePurgeRedisSignals() {
  return useMutation<RedisSignalsPurgeResponse, Error, number>({
    mutationFn: (vehicleId: number) => purgeRedisSignals(vehicleId),
  });
}

/** Purges every `vehicle:*:signals` HSET in Redis (bounded per call). */
export function usePurgeAllRedisSignals() {
  return useMutation<RedisSignalsPurgeAllResponse, Error, void>({
    mutationFn: () => purgeAllRedisSignals(),
  });
}
