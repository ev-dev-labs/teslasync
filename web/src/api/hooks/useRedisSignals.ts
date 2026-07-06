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
 * A vehicle id is queryable only when it is a real, positive whole number.
 *
 * The read is disabled for `null` (no vehicle selected) and — defensively —
 * for `0`, negative, fractional, or non-finite ids so the viewer can never
 * issue a malformed `?vehicle_id=NaN` (or `?vehicle_id=0`) request against
 * the devtools route. Vehicle ids are int64 > 0 on the backend, so a
 * non-positive/non-integer value only ever arrives from a contract
 * violation upstream — swallowing it here keeps the network layer honest.
 */
export function isQueryableVehicleId(
  vehicleId: number | null,
): vehicleId is number {
  return vehicleId !== null && Number.isInteger(vehicleId) && vehicleId > 0;
}

/**
 * Pure builder for the `useRedisSignals` query config. Extracted so the
 * enabled / refetch-interval / query-key policy is unit-testable without
 * standing up a React tree — mirroring the testable-helper pattern used by
 * the sibling DLQ / log-stream hooks.
 */
export function redisSignalsQueryOptions(
  vehicleId: number | null,
  autoRefresh: boolean,
) {
  return {
    queryKey: redisSignalKeys.detail(vehicleId),
    // `enabled` below guarantees a positive integer id before this runs,
    // so the cast never widens past what the guard already proved.
    queryFn: () => getRedisSignals(vehicleId as number),
    enabled: isQueryableVehicleId(vehicleId),
    refetchInterval: autoRefresh ? INTERVALS.REALTIME : (false as const),
  };
}

/**
 * Reads every cached signal for a vehicle from the Redis L2 HSET.
 * Disabled until a valid vehicle is selected; polls at the realtime
 * interval while `autoRefresh` is on so the viewer can watch live
 * telemetry land.
 */
export function useRedisSignals(vehicleId: number | null, autoRefresh: boolean) {
  return useQuery(redisSignalsQueryOptions(vehicleId, autoRefresh));
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
