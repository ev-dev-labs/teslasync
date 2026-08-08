import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui';
import { Text } from '@/components/ui/Typography';
import { Delta } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { useDrivingStats } from '@/api/hooks/useDriving';
import { useSettings } from '@/hooks/useSettings';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, safeNumber } from '@/lib/numberFormat';
import type { Direction, MetricUnit } from '@/lib/metricSemantics';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

interface HeroGaugesProps {
  drive: DriveDetail;
  stats: DriveStats;
}

/**
 * Wh/km → Wh/mi. 1 mile = 1.609344 km (exact, NIST), so per-mile consumption
 * is the per-km figure scaled by the km-per-mile factor.
 */
const WH_PER_KM_TO_WH_PER_MILE = 1.609344;

interface HeroStatProps {
  label: string;
  value: number;
  unit: string;
  decimals?: number;
  /** Tailwind text colour for the headline number. */
  colorClass: string;
  /** Metric semantics for the comparison chip. */
  metric: { direction: Direction; unit?: MetricUnit };
  /** The reader's own baseline for this metric; `null` when not derivable. */
  baseline: number | null;
  baselineLabel: string;
}

/**
 * One hero reading, shown against the reader's own baseline.
 *
 * These metrics have no natural maximum — a drive is not a percentage of
 * anything — so there is no honest ring to draw. What makes 32 km meaningful
 * is knowing your drives usually run 23 km, so the comparison carries the
 * insight and the number carries the fact.
 */
function HeroStat({
  label,
  value,
  unit,
  decimals,
  colorClass,
  metric,
  baseline,
  baselineLabel,
}: HeroStatProps) {
  return (
    <div className="flex min-w-[8.5rem] flex-col gap-1">
      <Text variant="metricLabel">{label}</Text>
      <div className="flex items-baseline gap-1">
        <Text as="span" variant="metricValue" className={colorClass}>
          {fmtNumber(value, decimals ?? 0)}
        </Text>
        <Text as="span" size="xs" color="muted">
          {unit}
        </Text>
      </div>
      <Delta
        metric={metric}
        current={value}
        previous={baseline}
        display="percent"
        comparedTo={baselineLabel}
      />
    </div>
  );
}

/**
 * Headline readings for a single drive.
 *
 * Previously five radial gauges whose ceilings were derived from the readings
 * themselves (`max={value * 1.5}`), which pins every arc at a constant 66.7%
 * regardless of the value — a 5 km errand and a 500 km road trip drew the
 * identical ring. Each reading is now shown as the number it is, next to the
 * reader's own average for that metric, so the comparison is real rather than
 * geometric.
 */
export function HeroGauges({ drive, stats }: HeroGaugesProps) {
  const { t } = useTranslation();
  const { isMiles } = useSettings();
  const { unitPrefs } = useUnits();

  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  // Fleet baselines for this vehicle. TanStack Query dedupes this against the
  // drive-list page, so arriving from the list costs no extra request.
  const { data: fleetStats } = useDrivingStats(
    drive.vehicleId != null ? String(drive.vehicleId) : undefined,
  );

  // Each magnitude is derived once, in the user's display unit, and every raw
  // source is coerced through `safeNumber`. A non-finite aggregate — a
  // still-live drive whose `durationS` is NaN, or a partially-written row —
  // would otherwise render as `NaN`. `distanceM` is SI metres; `maxSpd` and
  // `consumptionWhKm` arrive already display-converted from `useDriveDetailData`.
  const distanceDisplay = convertDistanceFromSI(safeNumber(drive.distanceM), unitPrefs.distance);
  const maxSpeedDisplay = safeNumber(stats.maxSpd);
  const durationMin = safeNumber(drive.durationS) / 60;
  const efficiencyDisplay = unitPrefs.distance === 'mi'
    ? safeNumber(stats.consumptionWhKm) * WH_PER_KM_TO_WH_PER_MILE
    : safeNumber(stats.consumptionWhKm);
  const efficiencyPctPer100 = stats.efficiencyPctPer100;

  // Baselines. The API reports fleet aggregates in metric, so each is converted
  // to the display unit exactly like the reading it is compared against. A zero
  // drive count would divide by zero, so per-drive means are only derived once
  // there is at least one drive to average over.
  const driveCount = safeNumber(fleetStats?.totalDrives);
  const hasDrives = driveCount > 0;

  const avgDistance = hasDrives
    ? convertDistanceFromSI(
        (safeNumber(fleetStats?.totalDistanceKm) * 1000) / driveCount,
        unitPrefs.distance,
      )
    : null;
  const avgDurationMin = hasDrives ? safeNumber(fleetStats?.totalDurationS) / driveCount / 60 : null;
  // `topSpeedKmh` is the reader's record, which is the reference a max-speed
  // reading is actually judged against — not the mean of every sample.
  const topSpeed = fleetStats?.topSpeedKmh != null
    ? convertSpeedFromSI(safeNumber(fleetStats.topSpeedKmh) / 3.6, unitPrefs.speed)
    : null;
  const avgEfficiency = fleetStats?.avgEfficiencyWhKm != null
    ? (unitPrefs.distance === 'mi'
        ? safeNumber(fleetStats.avgEfficiencyWhKm) * WH_PER_KM_TO_WH_PER_MILE
        : safeNumber(fleetStats.avgEfficiencyWhKm))
    : null;

  const vsAverage = t('driveDetail.vsAverage', 'vs your average');
  const vsRecord = t('driveDetail.vsRecord', 'vs your record');

  return (
    <FadeIn>
      <GlassPanel className="p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/[0.02] to-purple-500/[0.02]" />
        <div
          role="group"
          aria-label={t('driveDetail.heroGauges', 'Drive summary gauges')}
          className="relative flex flex-wrap items-start gap-6 lg:gap-10 justify-center"
        >
          <HeroStat
            label={t('driveDetail.distance', 'Distance')}
            value={distanceDisplay}
            unit={distanceUnit}
            decimals={1}
            colorClass="text-cyan-300"
            metric={{ direction: 'neutral', unit: unitPrefs.distance === 'mi' ? 'mi' : 'km' }}
            baseline={avgDistance}
            baselineLabel={vsAverage}
          />
          <HeroStat
            label={t('driveDetail.maxSpeed', 'Max Speed')}
            value={maxSpeedDisplay}
            unit={speedUnit}
            colorClass="text-purple-300"
            metric={{ direction: 'neutral', unit: unitPrefs.distance === 'mi' ? 'mph' : 'kph' }}
            baseline={topSpeed}
            baselineLabel={vsRecord}
          />
          <HeroStat
            label={t('driveDetail.duration', 'Duration')}
            value={durationMin}
            unit={t('driveDetail.minutesShort', 'min')}
            colorClass="text-amber-300"
            metric={{ direction: 'neutral', unit: 'min' }}
            baseline={avgDurationMin}
            baselineLabel={vsAverage}
          />
          <HeroStat
            label={t('driveDetail.consumption', 'Consumption')}
            value={efficiencyDisplay}
            unit={efficiencyUnit}
            colorClass="text-rose-300"
            metric={{ direction: 'lower_better', unit: 'wh_per_mi' }}
            baseline={avgEfficiency}
            baselineLabel={vsAverage}
          />
          {efficiencyPctPer100 != null && (
            <HeroStat
              label={t('driveDetail.efficiency', 'Efficiency')}
              value={safeNumber(efficiencyPctPer100)}
              unit={isMiles ? '%/100mi' : '%/100km'}
              decimals={1}
              colorClass="text-emerald-300"
              metric={{ direction: 'lower_better', unit: 'percent' }}
              baseline={null}
              baselineLabel={vsAverage}
            />
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
