import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useDrivingCoach } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetTipCards, type TipItem } from './shared';
import type { WidgetProps } from './types';

/**
 * Potential-savings percentage derived from the driver's current average
 * efficiency versus their best observed efficiency (both in Wh/km, where a
 * lower value is more efficient).
 *
 * The guards keep the "Potential savings" badge trustworthy rather than merely
 * non-crashing:
 *   - a non-positive `current` (no drives analysed yet) avoids a
 *     divide-by-zero;
 *   - a non-positive `best` (no baseline captured yet) would otherwise imply a
 *     misleading "100% savings", so it collapses to 0 instead;
 *   - `NaN` / `null` / `undefined` inputs collapse to 0;
 *   - the result is clamped to a sane [0, 100] window so a run that already
 *     beats the recorded best reads as "no savings" rather than a negative
 *     percentage.
 */
export function computeSavingsPct(
  currentEff: number | null | undefined,
  bestEff: number | null | undefined,
): number {
  const current = currentEff ?? 0;
  const best = bestEff ?? 0;
  if (!(current > 0) || !(best > 0)) return 0;
  const pct = Math.round(((current - best) / current) * 100);
  return Math.min(100, Math.max(0, pct));
}

export default function DrivingCoachWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useDrivingCoach(vehicleIdStr);

  const isCompact = size.cols <= 1;

  const score = data?.overall_score ?? 0;
  const recommendations = data?.recommendations ?? [];
  const savingsPct = computeSavingsPct(
    data?.efficiency_wh_km,
    data?.best_efficiency_wh_km,
  );

  const tips: TipItem[] = useMemo(
    () =>
      recommendations.map((rec, i) => ({
        id: i,
        icon: <Lightbulb className="h-4 w-4" aria-hidden="true" />,
        title: rec.category ?? '—',
        description: rec.tip ?? '—',
        impact: rec.impact ?? undefined,
        impactLabel: rec.impact
          ? t(`widget.drivingCoach.impact.${rec.impact}`, rec.impact)
          : undefined,
      })),
    [recommendations, t],
  );

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="flex h-full flex-col items-center justify-center gap-2 min-h-[44px]">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {fmtInt(score)}
          </span>
          {savingsPct > 0 && (
            <Badge variant="success" size="sm">
              {t('widget.drivingCoach.potentialSavings', 'Potential savings: {{pct}}%', { pct: savingsPct })}
            </Badge>
          )}
          {savingsPct <= 0 && recommendations.length === 0 && (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Lightbulb className="h-5 w-5" aria-hidden="true" />}
              message={t('widget.drivingCoach.noTips', 'No tips available')}
              className="py-2"
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.drivingCoach.title', 'Driving Coach')}
      icon={<Lightbulb className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />}
      {...shellProps}
    >
      <div className="flex flex-col gap-3 h-full">
        {/* Score header */}
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-[var(--text-primary)]">
              {fmtInt(score)}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {t('widget.drivingCoach.scoreLabel', '/ 100')}
            </span>
          </div>
          {savingsPct > 0 && (
            <Badge variant="success" size="sm">
              {t('widget.drivingCoach.potentialSavings', 'Potential savings: {{pct}}%', { pct: savingsPct })}
            </Badge>
          )}
        </div>

        {/* Tips list */}
        <div className="flex-1 min-h-0">
          <WidgetTipCards
            tips={tips}
            maxTips={3}
            compact={false}
            emptyMessage={t('widget.drivingCoach.noTips', 'No tips available')}
            emptyIcon={<Lightbulb className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
      </div>
    </WidgetShell>
  );
}
