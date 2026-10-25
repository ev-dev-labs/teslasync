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
import { knownNumber } from '@/api/dataState';
import type { IngestXRayFieldStat } from '@/types/admin-diagnostics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();

  // Unknown counts follow measured values without becoming zero readings.
  const { top, max } = useMemo(() => {
    const take = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
    const ranked = [...(rows ?? [])]
      .sort((a, b) => {
        const left = knownNumber(a?.sample_count);
        const right = knownNumber(b?.sample_count);
        if (left === null) return right === null ? 0 : 1;
        if (right === null) return -1;
        return right - left;
      })
      .slice(0, take);
    const peak = ranked.reduce(
      (hi, r) => Math.max(hi, knownNumber(r?.sample_count) ?? hi),
      1,
    );
    return { top: ranked, max: peak };
  }, [rows, limit]);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ListTree className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
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
            const count = knownNumber(row?.sample_count);
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
                  sublabel={count === null ? '—' : fmtInt(count)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
