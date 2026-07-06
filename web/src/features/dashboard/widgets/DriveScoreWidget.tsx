import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetGaugeHero, type GaugeHeroConfig, type GaugeHeroStat } from './shared';
import type { WidgetProps } from './types';

/** Average consumption (Wh/km, SI) that maps to a perfect 100 score. */
const SCORE_REFERENCE_WH_KM = 250;

/** Kilometres per mile — the exact factor for expressing Wh/km as Wh/mi. */
const KM_PER_MILE = 1.609344;

/**
 * Derive a 0–100 drive-efficiency score from average consumption expressed in
 * watt-hours per kilometre (SI). Lower consumption ⇒ higher score, with
 * {@link SCORE_REFERENCE_WH_KM} mapping to 100 (anything more frugal is clamped
 * there). Non-finite or non-positive input — no drives in the window yet, or a
 * partial payload carrying `NaN`/`Infinity` — yields 0; the caller treats that
 * as "no score" rather than a real (worst-case) result, because a genuine drive
 * cannot reach 0 (it would need >50 kWh/km).
 */
export function driveScoreFromEfficiency(whPerKm: number): number {
  if (!isFiniteNumber(whPerKm) || whPerKm <= 0) return 0;
  return Math.min(100, Math.round((SCORE_REFERENCE_WH_KM / whPerKm) * 100));
}

/** Gauge accent for a score band: green (great) → amber (ok) → red (poor). */
export function scoreColor(score: number): string {
  if (score > 75) return '#10b981';
  if (score > 50) return '#f59e0b';
  return '#ef4444';
}

/**
 * Express an SI Wh/km consumption figure in the user's distance unit. Miles
 * users read Wh/mi (⇒ multiply by km-per-mile); metric users keep Wh/km.
 * Non-finite input collapses to 0 so the formatted stat never shows "NaN".
 */
export function toEfficiencyDisplay(whPerKm: number, isMiles: boolean): number {
  if (!isFiniteNumber(whPerKm)) return 0;
  return isMiles ? whPerKm * KM_PER_MILE : whPerKm;
}

export default function DriveScoreWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const {
    data: analytics,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useFleetAnalytics(7);
  const { unitPrefs } = useUnits();

  const isMiles = unitPrefs.distance === 'mi';
  const efficiencyUnit = isMiles ? 'Wh/mi' : 'Wh/km';

  // Average consumption for the window (SI Wh/km). A partial payload can carry
  // a non-finite value, so guard before it reaches the score/display math —
  // `?? 0` alone would let NaN/Infinity through.
  const rawEfficiency = analytics?.avg_efficiency_wh_km;
  const efficiency = isFiniteNumber(rawEfficiency) ? rawEfficiency : 0;
  const score = driveScoreFromEfficiency(efficiency);

  // A 0 score is unreachable by a real drive, so it only ever means "no drives
  // to score". Surface the empty state instead of a misleading red 0/100 gauge.
  const hasScore = efficiency > 0;

  const isCompact = size.cols === 1 && size.rows === 1;

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const gauge = useMemo<GaugeHeroConfig>(() => ({
    value: score,
    max: 100,
    label: t('widget.score', 'Score'),
    unit: '',
    color: scoreColor(score),
  }), [score, t]);

  const stats = useMemo<GaugeHeroStat[]>(() => [
    {
      label: t('widget.efficiency', 'Efficiency'),
      value: fmtNumber(toEfficiencyDisplay(efficiency, isMiles), 0),
      unit: efficiencyUnit,
    },
  ], [t, efficiency, isMiles, efficiencyUnit]);

  return (
    <WidgetShell
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasScore ? (
        <WidgetGaugeHero gauge={gauge} stats={stats} compact={isCompact} />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<TrendingUp className="h-5 w-5" />}
          message={t('widget.noScore', 'No data yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
