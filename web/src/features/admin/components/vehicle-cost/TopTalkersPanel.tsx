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
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
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

  // Null-safe the inputs before any `.length` / `.reduce` / `.map`: the page
  // feeds normalised arrays today, but a section that owns its empty / error
  // rendering must never assume a well-formed payload.
  const items = talkers ?? [];
  const total = totalRows ?? 0;

  // Share bars scale to the fleet total when known, else to the biggest
  // talker so a single-vehicle window still fills the bar meaningfully.
  const max =
    total > 0 ? total : items.reduce((m, v) => Math.max(m, v.rows ?? 0), 0) || 1;

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
      ) : loading && items.length === 0 ? (
        <div
          className="space-y-3"
          role="status"
          aria-busy="true"
          aria-label={t('common.loading', 'Loading')}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Flame className="h-8 w-8" aria-hidden="true" />}
          message={t('admin.vehicleCost.topTalkersEmpty', 'No vehicles have ingested signals yet.')}
        />
      ) : (
        <ul
          className="space-y-3"
          aria-label={t(
            'admin.vehicleCost.topTalkersListLabel',
            'Top talkers ranked by ingested rows',
          )}
        >
          {items.map((v, i) => {
            const value = v.rows ?? 0;
            // A share of the fleet total can never exceed 100%; clamp so the
            // readout stays consistent with the bar (which caps its own width
            // at 100%) even if one vehicle's window count briefly outruns the
            // reported fleet total.
            const pct = Math.min(max > 0 ? (value / max) * 100 : 0, 100);
            return (
              <li key={v.vehicle_id}>
                <MetricBar
                  label={v.name ?? '—'}
                  value={value}
                  max={max}
                  color={chartTokens.series[i % chartTokens.series.length]}
                  sublabel={`${fmtInt(value)} · ${fmtPercent(pct, 1)}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
