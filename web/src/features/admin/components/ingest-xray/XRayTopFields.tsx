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
import { fmtInt } from '@/lib/numberFormat';
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

  // Sort by sample volume desc and take the loudest N. Null-safe against a
  // malformed payload where `sample_count` might be missing.
  const top = useMemo(
    () =>
      [...(rows ?? [])]
        .sort((a, b) => (b.sample_count ?? 0) - (a.sample_count ?? 0))
        .slice(0, limit),
    [rows, limit],
  );

  const max =
    top.length > 0 ? Math.max(...top.map((r) => r.sample_count ?? 0), 1) : 1;

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
        <ul className="space-y-3">
          {top.map((row, i) => (
            <li key={row.field}>
              <MetricBar
                label={row.field}
                value={row.sample_count ?? 0}
                max={max}
                color={CHART_COLORS[i % CHART_COLORS.length]}
                sublabel={fmtInt(row.sample_count ?? 0)}
              />
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
