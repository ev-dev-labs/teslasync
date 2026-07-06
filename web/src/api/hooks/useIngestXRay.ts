/**
 * @module api/hooks/useIngestXRay
 *
 * TanStack Query binding for the per-vehicle ingest X-Ray endpoint
 * mounted at `GET /api/v1/system/ingest-xray/{vehicleID}`. Backed by
 * `internal/api/ingest_xray_handler.go`.
 *
 * The X-Ray shows, for a single vehicle within a rolling time window:
 *   • Which signal `field` rows arrived
 *   • How many samples per field
 *   • The last-seen timestamp + observed value_kind per field
 *   • A bucketed sample-count time-series for sparkline rendering
 *
 * Server validates `window` ∈ {5m, 15m, 1h, 6h, 24h} and `bucket` ∈
 * {30s, 1m, 5m, 15m, 1h}, and rejects bucket >= window. The hook does
 * NOT pre-validate these — the page renders a server-validated dropdown
 * and the response is returned as-is.
 */

import { useQuery } from '@tanstack/react-query';

import { request } from '../client';
import { INTERVALS, STALE_TIMES, PAGINATION } from '@/lib/constants';
import type {
  IngestXRayResponse,
  IngestXRayWindow,
  IngestXRayBucket,
} from '@/types/admin-diagnostics';

export const ingestXRayKeys = {
  root: ['system', 'ingest-xray'] as const,
  detail: (
    vehicleId: number,
    window: IngestXRayWindow,
    bucket: IngestXRayBucket,
    limit: number,
  ) =>
    ['system', 'ingest-xray', vehicleId, window, bucket, limit] as const,
};

export interface UseIngestXRayParams {
  vehicleId: number | null | undefined;
  window?: IngestXRayWindow;
  bucket?: IngestXRayBucket;
  /** Caps the number of `fields` rows returned. Buckets are never truncated. */
  limit?: number;
  /** Override the default 10 s refetch (e.g. pause when the page is hidden). */
  enabled?: boolean;
}

/**
 * Returns the X-Ray for a single vehicle. Refetches at INTERVALS.FAST
 * because the screen is meant to feel "live" while an operator is
 * diagnosing a stalled signal pipeline.
 */
export function useIngestXRay({
  vehicleId,
  window = '1h',
  bucket = '1m',
  limit = PAGINATION.DEFAULT_LIMIT,
  enabled = true,
}: UseIngestXRayParams) {
  // Vehicle IDs are positive int64s (Go `Vehicle.ID`). Reject NaN, 0,
  // negatives, non-integers, and ±Infinity so a stray value can never
  // build a malformed `/system/ingest-xray/<junk>` URL; anything invalid
  // collapses to 0, which the `enabled` gate below turns into a no-op.
  const numericId =
    typeof vehicleId === 'number' && Number.isInteger(vehicleId) && vehicleId > 0
      ? vehicleId
      : 0;
  return useQuery({
    queryKey: ingestXRayKeys.detail(numericId, window, bucket, limit),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({
        window,
        bucket,
        limit: String(limit),
      }).toString();
      return request<IngestXRayResponse>(
        `/system/ingest-xray/${numericId}?${qs}`,
        { signal },
      );
    },
    enabled: enabled && numericId > 0,
    staleTime: STALE_TIMES.REALTIME,
    refetchInterval: INTERVALS.FAST,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/**
 * Human-readable label for a `value_kind` integer. The canonical order
 * mirrors `protomodel.ValueKind` (iota) in the Go ingest path and the
 * `signal_log.value_kind` column (migration 000186):
 *
 *   0 unknown · 1 string · 2 bool · 3 int32 · 4 int64 · 5 float32 ·
 *   6 float64 · 7 enum · 8 compound · 9 time · 10 invalid
 *
 * There is deliberately NO "location" kind — location is a `CompoundKind`,
 * a separate enum, so it must never appear here. Unknown values (anything
 * outside this map) render as `kind {n}` so an operator can still
 * cross-reference the raw enum without a UI patch.
 */
export function formatValueKind(kind: number): string {
  switch (kind) {
    case 0:
      return 'unknown';
    case 1:
      return 'string';
    case 2:
      return 'bool';
    case 3:
      return 'int32';
    case 4:
      return 'int64';
    case 5:
      return 'float32';
    case 6:
      return 'float64';
    case 7:
      return 'enum';
    case 8:
      return 'compound';
    case 9:
      return 'time';
    case 10:
      return 'invalid';
    default:
      return `kind ${kind}`;
  }
}
