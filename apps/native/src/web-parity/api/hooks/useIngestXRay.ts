/**
 * @module api/hooks/useIngestXRay
 *
 * Native parity TanStack Query binding for the per-vehicle ingest X-Ray endpoint
 * mounted at `GET /api/v1/system/ingest-xray/{vehicleID}`. Backed by
 * `internal/api/ingest_xray_handler.go`.
 *
 * The X-Ray shows, for a single vehicle within a rolling time window:
 *   - Which signal `field` rows arrived
 *   - How many samples per field
 *   - The last-seen timestamp + observed value_kind per field
 *   - A bucketed sample-count time-series for sparkline rendering
 *
 * Server validates `window` in {5m, 15m, 1h, 6h, 24h} and `bucket` in
 * {30s, 1m, 5m, 15m, 1h}, and rejects bucket >= window. The hook does
 * NOT pre-validate these - the page renders a server-validated dropdown
 * and the response is returned as-is.
 */

import {useQuery} from '@tanstack/react-query';

import {request} from '../client';

const INTERVALS = {
  FAST: 10_000,
} as const;

const STALE_TIMES = {
  REALTIME: 5_000,
} as const;

const PAGINATION = {
  DEFAULT_LIMIT: 50,
} as const;

/** Allowed window literals - server rejects anything else with 400. */
export type IngestXRayWindow = '5m' | '15m' | '1h' | '6h' | '24h';

/** Allowed bucket literals - server rejects anything else with 400. */
export type IngestXRayBucket = '30s' | '1m' | '5m' | '15m' | '1h';

/**
 * `value_kind` matches `protomodel.ValueKind` in the Go ingest path.
 * 0 is "unknown", everything else is a typed kind.
 */
export type IngestXRayValueKind = number;

export interface IngestXRayFieldStat {
  field: string;
  sample_count: number;
  last_seen_at: string;
  value_kind: IngestXRayValueKind;
}

export interface IngestXRayBucketPoint {
  bucket_start: string;
  count: number;
}

export interface IngestXRayResponse {
  vehicle_id: number;
  window: IngestXRayWindow;
  bucket: IngestXRayBucket;
  generated_at: string;
  total_samples: number;
  unique_fields: number;
  fields: IngestXRayFieldStat[];
  buckets: IngestXRayBucketPoint[];
}

export const ingestXRayKeys = {
  root: ['system', 'ingest-xray'] as const,
  detail: (
    vehicleId: number,
    window: IngestXRayWindow,
    bucket: IngestXRayBucket,
    limit: number,
  ) => ['system', 'ingest-xray', vehicleId, window, bucket, limit] as const,
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
  const numericId =
    typeof vehicleId === 'number' && vehicleId > 0 ? vehicleId : 0;

  return useQuery({
    queryKey: ingestXRayKeys.detail(numericId, window, bucket, limit),
    queryFn: ({signal}) => {
      const qs = new URLSearchParams({
        window,
        bucket,
        limit: String(limit),
      }).toString();

      return request<IngestXRayResponse>(
        `/system/ingest-xray/${numericId}?${qs}`,
        {signal},
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
 * Human-readable label for a `value_kind` integer.
 * Mirrors `protomodel.ValueKind` in the Go ingest path. Unknown values
 * (anything outside this map) render as `kind {n}` so an operator can
 * still cross-reference the raw enum without a UI patch.
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
      return 'invalid';
    case 9:
      return 'time';
    case 10:
      return 'location';
    default:
      return `kind ${kind}`;
  }
}
