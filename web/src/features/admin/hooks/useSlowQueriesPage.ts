import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSlowQueries } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type { SlowQueryOrderBy, SlowQueryRow } from '@/types/admin-operator-confidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';
import { ORDER_BY_OPTIONS, ORDER_TO_METRIC, formatMs, shortFingerprint, cacheHitRatioValue, cacheHitRatioTotalValue } from '../components/structural-closure/slow-queries/helpers';

export function useSlowQueriesPage() {
  const { fmtInt, fmtCompact, fmtNumber, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('admin.slowQueries.pageTitle', 'Slow queries'));

  const [orderBy, setOrderBy] = useState<SlowQueryOrderBy>('mean_time');
  const [limit, setLimit] = useState<number>(25);

  const query = useSlowQueries(orderBy, limit);
  const queryState = deriveDataState(query);
  const subsystemMissing = isApiError(queryState.fatalError) && queryState.fatalError.status === 503;
  // A failed *background* refetch (after data has already loaded) leaves
  // `isError` true while TanStack Query keeps the last-good `data`. Gate the
  // error UI on `data === undefined` so a transient poll blip never blanks the
  // populated KPIs / chart / cache / table — mirrors IngestXRayPage's contract.
  const showError = !!queryState.fatalError && !subsystemMissing;
  const isLoading = queryState.status === 'initial';
  const rows = query.data?.slow_queries ?? [];
  const retry = () => query.refetch();

  const activeMetric = ORDER_TO_METRIC[orderBy];
  const isTimeMetric = activeMetric !== 'calls';
  const activeOption = ORDER_BY_OPTIONS.find((o) => o.value === orderBy) ?? ORDER_BY_OPTIONS[0];
  const activeMetricLabel = t(activeOption.labelKey, activeOption.fallback);

  const formatMetric = (v: number) => (isTimeMetric ? formatMs(v) : fmtInt(v));
  const axisFormat = (v: number) => (isTimeMetric ? formatMs(v) : fmtCompact(v));

  const totals = useMemo(() => {
    let calls = 0;
    let totalMs = 0;
    let rowsReturned = 0;
    // Keep numeric metric APIs while distinguishing unmeasured maxima from zero.
    let maxMean = Number.NaN;
    let maxPeak = Number.NaN;
    for (const r of rows) {
      calls += r.calls ?? 0;
      totalMs += r.total_time_ms ?? 0;
      rowsReturned += r.rows_returned ?? 0;
      if (Number.isFinite(r.mean_time_ms) && (!Number.isFinite(maxMean) || r.mean_time_ms > maxMean)) {
        maxMean = r.mean_time_ms;
      }
      if (Number.isFinite(r.max_time_ms) && (!Number.isFinite(maxPeak) || r.max_time_ms > maxPeak)) {
        maxPeak = r.max_time_ms;
      }
    }
    const cacheRatio = cacheHitRatioTotalValue(rows);
    return { calls, totalMs, rowsReturned, cacheRatio, maxMean, maxPeak };
  }, [rows]);

  // Top slice ranked by the active metric — feeds the horizontal bar chart.
  const chartRows = useMemo(
    () => [...rows]
      .sort((a, b) => (b[activeMetric] ?? 0) - (a[activeMetric] ?? 0))
      .slice(0, 12)
      .map((r) => ({
        key: r.query_id,
        label: shortFingerprint(r.fingerprint),
        full: r.fingerprint || '—',
        value: r[activeMetric] ?? 0,
      })),
    [rows, activeMetric],
  );

  // Queries with shared-buffer stats, worst hit ratio first (I/O-bound =
  // strongest indexing candidates).
  const cacheLeaders = useMemo(
    () => rows
      .map((row) => ({ row, ratio: cacheHitRatioValue(row) }))
      .filter((x): x is { row: SlowQueryRow; ratio: number } => x.ratio !== null)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 8),
    [rows],
  );


  return {
    fmtInt, fmtCompact, fmtNumber, displayPrecision, displayLocale, t, orderBy, setOrderBy, limit, setLimit, query, queryState, subsystemMissing, showError, isLoading, rows, retry, activeMetric, isTimeMetric, activeOption, activeMetricLabel, formatMetric, axisFormat, totals, chartRows, cacheLeaders
  };
}
