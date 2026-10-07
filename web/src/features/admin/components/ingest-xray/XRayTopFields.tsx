/**
 * Ingest X-Ray — top fields by sample volume.
 *
 * Bento side panel beside the bucket chart. Surfaces the loudest signal
 * fields in the window as ranked MetricBars so an operator can see, at a
 * glance, which fields dominate the ingest stream. Derived purely from the
 * same `fields` payload the table renders — no extra request.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListTree } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { CHART_COLORS } from '@/components/charts';
import { fmtInt, safeNumber } from '@/lib/numberFormat';
import type { IngestXRayFieldStat } from '@/types/admin-diagnostics';

interface XRayTopFieldsProps {
  rows: IngestXRayFieldStat[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** How many top fields to surface. */
  limit?: number;
}

export function XRayTopFields({
  rows,
  loading,
  error,
  onRetry,
  limit = 8,
}: XRayTopFieldsProps) {
  const { t } = useTranslation();

  // Sort by sample volume desc and take the loudest N. Hardened against a
  // malformed payload where `sample_count` is missing, non-finite, or the
  // wrong type (`safeNumber` → 0), and against a NaN/negative `limit` that
  // would otherwise make `slice` drop rows from the tail instead of the head.
  // `max` is derived in the same pass so the bar scale can never diverge from
  // the rows actually rendered; it floors at 1 to avoid a divide-by-zero in
  // MetricBar.
  const { top, max } = useMemo(() => {
    const take = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
    const ranked = [...(rows ?? [])]
      .sort((a, b) => safeNumber(b?.sample_count) - safeNumber(a?.sample_count))
      .slice(0, take);
    const peak = ranked.reduce(
      (hi, r) => Math.max(hi, safeNumber(r?.sample_count)),
      1,
    );
    return { top: ranked, max: peak };
  }, [rows, limit]);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ListTree className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.xray.topFields.title', 'Top fields by volume')}
      </PanelTitle>

      {loading ? (
        <Skeleton height={220} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : top.length === 0 ? (
        <EmptyState
          /* no-action: transient — surfaces before a vehicle is picked or when
             the window contains no samples. The toolbar / banner is the CTA. */
          icon={<ListTree className="h-8 w-8" />}
          message={t(
            'admin.xray.topFields.empty',
            'No field activity in this window yet.',
          )}
        />
      ) : (
        <ul
          className="space-y-3"
          aria-label={t('admin.xray.topFields.title', 'Top fields by volume')}
        >
          {top.map((row, i) => {
            const count = safeNumber(row?.sample_count);
            // `field` is the primary key of the row; a malformed payload could
            // still omit it, so fall back to an em-dash label rather than
            // rendering a blank bar. The key mixes in the index so duplicate
            // field names can't collide into a single React key.
            const label = row?.field || '—';
            return (
              <li key={`${row?.field ?? 'field'}-${i}`}>
                <MetricBar
                  label={label}
                  value={count}
                  max={max}
                  color={CHART_COLORS[i % CHART_COLORS.length]}
                  sublabel={fmtInt(count)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
