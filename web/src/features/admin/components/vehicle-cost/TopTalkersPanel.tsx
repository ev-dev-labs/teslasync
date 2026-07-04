/**
 * Top-talkers side panel for the Vehicle Ingest Cost page.
 *
 * Ranks the heaviest vehicles by signal-row count and renders each as a
 * `MetricBar` whose fill is the vehicle's share of the fleet's total rows.
 * This is the fastest way to spot a vehicle whose ingest volume is
 * disproportionate to the rest of the fleet. Owns loading / empty / error.
 */
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';

import { GlassPanel, PanelTitle, Caption } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';
import { fmtNumber } from '@/lib/numberFormat';
import { type SectionState, type VehicleCostBar } from './helpers';

interface TopTalkersPanelProps extends SectionState {
  talkers: VehicleCostBar[];
  totalRows: number;
}

export function TopTalkersPanel({
  talkers,
  totalRows,
  loading,
  error,
  onRetry,
}: TopTalkersPanelProps) {
  const { t } = useTranslation();

  // Share bars scale to the fleet total when known, else to the biggest
  // talker so a single-vehicle window still fills the bar meaningfully.
  const max =
    totalRows > 0
      ? totalRows
      : talkers.reduce((m, v) => Math.max(m, v.rows), 0) || 1;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Flame className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('admin.vehicleCost.topTalkersTitle', 'Top talkers')}
      </PanelTitle>
      <Caption className="mb-3 block">
        {t('admin.vehicleCost.topTalkersSubtitle', 'Share of total rows ingested')}
      </Caption>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : loading && talkers.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      ) : talkers.length === 0 ? (
        <EmptyState
          icon={<Flame className="h-8 w-8" />}
          message={t('admin.vehicleCost.topTalkersEmpty', 'No vehicles have ingested signals yet.')}
        />
      ) : (
        <div className="space-y-3">
          {talkers.map((v, i) => {
            const pct = max > 0 ? (v.rows / max) * 100 : 0;
            return (
              <MetricBar
                key={v.vehicle_id}
                label={v.name}
                value={v.rows}
                max={max}
                color={chartTokens.series[i % chartTokens.series.length]}
                sublabel={`${fmtNumber(v.rows)} · ${fmtNumber(pct, 1)}%`}
              />
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
