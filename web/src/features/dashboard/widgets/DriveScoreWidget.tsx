import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { convertEfficiencyFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { isFiniteNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { COLOR } from '@/lib/colors';

/** Average consumption (Wh/km, SI) that maps to a perfect 100 score. */
const SCORE_REFERENCE_WH_KM = 250;

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
  if (score > 75) return COLOR.GOOD;
  if (score > 50) return COLOR.WARN;
  return COLOR.BAD;
}

/**
 * Express an SI Wh/km consumption figure in the user's distance unit. Miles
 * users read Wh/mi (⇒ multiply by km-per-mile); metric users keep Wh/km.
 * Non-finite input collapses to 0 so the formatted stat never shows "NaN".
 */
export function toEfficiencyDisplay(whPerKm: number, isMiles: boolean): number {
  if (!isFiniteNumber(whPerKm)) return 0;
  return convertEfficiencyFromSI(whPerKm, isMiles ? 'mi' : 'km');
}

export default function DriveScoreWidget(_props: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const query = useFleetAnalytics(7);
  const {
    data: analytics,
    isLoading,
    isFetching,
    isStale,
    isError,
    error,
    dataUpdatedAt,
    refetch,
  } = query;
  const trust = useDataState({ ...query, data: analytics ?? undefined }, { provenance: 'inferred' });
  const { unitPrefs } = useUnits();

  const isMiles = unitPrefs.distance === 'mi';
  const efficiencyUnit = isMiles ? 'Wh/mi' : 'Wh/km';

  // Average consumption for the window (SI Wh/km). A partial payload can carry
  // a non-finite value, so guard before it reaches the score/display math —
  // `?? 0` alone would let NaN/Infinity through.
  const rawEfficiency = analytics?.avg_efficiency_wh_km;
  const efficiency = knownNumber(rawEfficiency);
  const score = driveScoreFromEfficiency(efficiency ?? 0);

  // A 0 score is unreachable by a real drive, so it only ever means "no drives
  // to score". Surface the empty state instead of a misleading red 0/100 gauge.
  const hasScore = efficiency != null && efficiency > 0;

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={t('widget.driveScoreGauge.title', 'Drive score')}
      loading={isLoading}
      dataState={analytics != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasScore ? (
        <div className="flex h-full min-w-0 flex-col items-start justify-center">
          <WidgetBigNumber
            value={fmtNumber(score, 0)}
            unit="/100"
            subtitle={`${fmtNumber(toEfficiencyDisplay(efficiency, isMiles), 0)} ${efficiencyUnit} ${t('widget.driveEfficiencyChart.avg', 'Avg')}`}
            animated={false}
            align="start"
          />
        </div>
      ) : (
        // no-action: the score is generated automatically after a qualifying drive.
        <EmptyState
          icon={<TrendingUp className="h-5 w-5" />}
          message={t('widget.noScore', 'No drive score yet')}
          description={t(
            'widget.noScoreDescription',
            'Complete a drive with measured energy and distance to calculate an efficiency score.',
          )}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
