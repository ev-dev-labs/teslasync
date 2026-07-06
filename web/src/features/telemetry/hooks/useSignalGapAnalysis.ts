/**
 * useSignalGapAnalysis — derives the Signal Gap Detector's KPI band, staleness
 * distribution, freshness score, and worst-offender list from the live signal
 * map.
 *
 * Shares the `useSignalGaps` query key with `SignalCatalogPanel`, so the page's
 * summary sections and the catalog table are served from a single cached
 * request (no duplicate polling).
 */

import { useMemo } from 'react';

import { useSignalGaps } from '@/api/hooks/useTelemetry';
import type { SignalRow } from '@/types/telemetry';

import {
  GAP_AGING_MAX_S,
  computeFreshnessPct,
  computeGapBuckets,
  deriveSignalRows,
  type GapBuckets,
} from '../signalGapUtils';

/** How many worst-offender rows the freshness panel surfaces. */
const TOP_STALE_LIMIT = 6;

export interface SignalGapAnalysis {
  query: ReturnType<typeof useSignalGaps>;
  rows: SignalRow[];
  buckets: GapBuckets;
  freshnessPct: number;
  /** Signals with a timestamp older than the aging window, worst first. */
  topStale: SignalRow[];
}

export function useSignalGapAnalysis(vehicleId: number): SignalGapAnalysis {
  const query = useSignalGaps(vehicleId);
  const { data, dataUpdatedAt } = query;

  // Re-derive whenever the underlying data changes. `dataUpdatedAt` is included
  // so staleness recomputes on every realtime refetch even if the object
  // reference is structurally shared.
  const rows = useMemo(
    () => deriveSignalRows(data, Date.now()),
    [data, dataUpdatedAt],
  );

  const buckets = useMemo(() => computeGapBuckets(rows), [rows]);
  const freshnessPct = useMemo(() => computeFreshnessPct(buckets), [buckets]);

  const topStale = useMemo(
    () =>
      rows
        .filter((r) => r.timestamp != null && r.staleness >= GAP_AGING_MAX_S)
        .sort((a, b) => b.staleness - a.staleness)
        .slice(0, TOP_STALE_LIMIT),
    [rows],
  );

  // Return a stable object identity. The whole analysis is handed to memoised
  // section panels (SignalGapFreshnessPanel / SignalGapHealthPanel) as a single
  // `analysis` prop; every field is already individually memoised, so this only
  // prevents a fresh wrapper literal from forcing those panels to re-render when
  // the page re-renders for an unrelated reason.
  return useMemo(
    () => ({ query, rows, buckets, freshnessPct, topStale }),
    [query, rows, buckets, freshnessPct, topStale],
  );
}
