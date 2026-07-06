import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { RadialGauge } from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { useUnits } from '@/hooks/useUnits';
import { safeNumber } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface HeroGaugesProps {
  drive: DriveDetail;
  stats: DriveStats;
}

/**
 * Wh/km → Wh/mi. 1 mile = 1.609344 km (exact, NIST), so per-mile consumption
 * is the per-km figure scaled by the km-per-mile factor.
 */
const WH_PER_KM_TO_WH_PER_MILE = 1.609344;

/** Floor for each gauge's arc ceiling so a tiny reading still sweeps a
 *  legible portion of the ring instead of collapsing to a sliver. */
const DISTANCE_MAX_FLOOR = 100;
const SPEED_MAX_FLOOR = 120;
const DURATION_MAX_FLOOR = 60;
const CONSUMPTION_MAX_FLOOR = 300;
/** Battery-percent-per-100-distance rarely exceeds this; a fixed ceiling keeps
 *  the efficiency ring comparable across drives. */
const EFFICIENCY_MAX = 30;
/** Headroom multiplier: the live reading fills ~2/3 of a value-scaled ring. */
const MAX_HEADROOM = 1.5;

export function HeroGauges({ drive, stats }: HeroGaugesProps) {
  const { t } = useTranslation();
  const { isMiles } = useSettings();
  const { unitPrefs } = useUnits();

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  // Each gauge magnitude is derived once, in the user's display unit, and every
  // raw source is coerced through `safeNumber`. A non-finite aggregate — a
  // still-live drive whose `durationS` is NaN, or a partially-written row —
  // would otherwise poison BOTH the gauge value and its computed `max`, leaving
  // an invalid (NaN) SVG arc. `distanceM` is SI metres; `maxSpd` and
  // `consumptionWhKm` arrive already display-converted from `useDriveDetailData`.
  const distanceDisplay = convertDistanceFromSI(safeNumber(drive.distanceM), unitPrefs.distance);
  const maxSpeedDisplay = safeNumber(stats.maxSpd);
  const durationMin = safeNumber(drive.durationS) / 60;
  const efficiencyDisplay = unitPrefs.distance === 'mi'
    ? safeNumber(stats.consumptionWhKm) * WH_PER_KM_TO_WH_PER_MILE
    : safeNumber(stats.consumptionWhKm);
  const efficiencyPctPer100 = stats.efficiencyPctPer100;

  return (
    <FadeIn>
      <GlassPanel className="p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/[0.02] to-purple-500/[0.02]" />
        <div
          role="group"
          aria-label={t('driveDetail.heroGauges', 'Drive summary gauges')}
          className="relative flex flex-wrap items-center gap-6 lg:gap-10 justify-center"
        >
          <RadialGauge
            value={Math.round(distanceDisplay)}
            max={Math.max(distanceDisplay * MAX_HEADROOM, DISTANCE_MAX_FLOOR)}
            label={t('driveDetail.distance', 'Distance')}
            unit={distanceUnit}
            color="#00f0ff"
            size={110}
          />
          <RadialGauge
            value={Math.round(maxSpeedDisplay)}
            max={Math.max(maxSpeedDisplay * MAX_HEADROOM, SPEED_MAX_FLOOR)}
            label={t('driveDetail.maxSpeed', 'Max Speed')}
            unit={speedUnit}
            color="#a855f7"
            size={110}
          />
          <RadialGauge
            value={Math.round(durationMin)}
            max={Math.max(durationMin * MAX_HEADROOM, DURATION_MAX_FLOOR)}
            label={t('driveDetail.duration', 'Duration')}
            unit="min"
            color="#f59e0b"
            size={110}
          />
          <RadialGauge
            value={Math.round(efficiencyDisplay)}
            max={Math.max(efficiencyDisplay * MAX_HEADROOM, CONSUMPTION_MAX_FLOOR)}
            label={t('driveDetail.consumption', 'Consumption')}
            unit={efficiencyUnit}
            color="#ef4444"
            size={110}
          />
          {efficiencyPctPer100 != null && (
            <RadialGauge
              value={safeNumber(efficiencyPctPer100)}
              max={EFFICIENCY_MAX}
              label={t('driveDetail.efficiency', 'Efficiency')}
              unit={isMiles ? '%/100mi' : '%/100km'}
              color="#10b981"
              size={110}
            />
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
