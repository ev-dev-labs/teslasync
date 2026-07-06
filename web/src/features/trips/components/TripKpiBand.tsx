import { useTranslation } from 'react-i18next';
import { MapPin, Zap, Gauge, Clock, Route, DollarSign } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import type { TripDetail } from '@/api/types';

interface TripKpiBandProps {
  trip: TripDetail | undefined;
  isLoading: boolean;
}

const GRID_CLASS =
  'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6';

/**
 * Clamp a KPI input to a safe, non-negative, finite number.
 *
 * The API types these totals as non-null `number`, but a malformed
 * upstream payload — a `NaN` from a bad division, a negative from clock
 * skew, an explicit `null` — must never leak "-5 km", "NaN", "-156 Wh/km"
 * (via the derived efficiency), or "-3 drives" into the summary band.
 * `?? 0` alone catches only null/undefined, so this guard is applied at
 * the display boundary. Every metric in this band has a non-negative
 * domain, so clamping is behaviour-preserving for all valid data.
 */
export function safeMetric(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/**
 * Full-width KPI band for the Trip Detail page. Renders six null-safe
 * metrics that reflow from 2 columns on phones up to 6 on ultra-wide
 * displays. Efficiency is derived at the display boundary (Wh per the
 * user's distance unit) so no magic mile/km factor is needed.
 */
export function TripKpiBand({ trip, isLoading }: TripKpiBandProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();

  if (isLoading && !trip) {
    return (
      <div className={GRID_CLASS} aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const distanceM = safeMetric(trip?.total_distance_m);
  const energyWh = safeMetric(trip?.total_energy_wh);
  const durationS = safeMetric(trip?.total_duration_s);
  const driveCount = safeMetric(trip?.drive_count);
  const chargeCount = safeMetric(trip?.charge_count);
  const cost = safeMetric(trip?.total_cost);

  const distanceDisplay = convertDistanceFromSI(distanceM, unitPrefs.distance);
  const efficiencyUnit = `Wh/${unitPrefs.distance}`;
  const efficiency = distanceDisplay > 0 ? energyWh / distanceDisplay : 0;

  return (
    <section
      aria-label={t('trips.detail.kpi.label', 'Trip summary metrics')}
      className={GRID_CLASS}
    >
      <MetricCard
        label={t('trips.detail.distance', 'Distance')}
        value={`${fmtInt(distanceDisplay)} ${unitPrefs.distance}`}
        icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
        color="cyan"
        subtitle={t('trips.detail.kpi.driveCount', '{{count}} drives', { count: driveCount })}
      />
      <MetricCard
        label={t('trips.detail.energy', 'Energy Used')}
        value={formatEnergy(energyWh)}
        icon={<Zap className="h-4 w-4" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('trips.detail.efficiency', 'Efficiency')}
        value={distanceDisplay > 0 ? `${fmtInt(efficiency)} ${efficiencyUnit}` : '—'}
        icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('trips.detail.duration', 'Duration')}
        value={durationS > 0 ? formatDurationSecondsAsMinutes(durationS) : '—'}
        icon={<Clock className="h-4 w-4" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('trips.detail.drives', 'Drives')}
        value={fmtInt(driveCount)}
        icon={<Route className="h-4 w-4" aria-hidden="true" />}
        color="green"
        subtitle={t('trips.detail.kpi.chargeCount', '{{count}} charges', { count: chargeCount })}
      />
      <MetricCard
        label={t('trips.detail.cost', 'Cost')}
        value={formatCurrency(cost)}
        icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
        color="green"
      />
    </section>
  );
}
