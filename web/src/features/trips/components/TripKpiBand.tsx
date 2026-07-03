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

  const gridClass =
    'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6';

  if (isLoading && !trip) {
    return (
      <div className={gridClass} aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  const distanceM = trip?.total_distance_m ?? 0;
  const energyWh = trip?.total_energy_wh ?? 0;
  const durationS = trip?.total_duration_s ?? 0;
  const driveCount = trip?.drive_count ?? 0;
  const chargeCount = trip?.charge_count ?? 0;
  const cost = trip?.total_cost ?? 0;

  const distanceDisplay = convertDistanceFromSI(distanceM, unitPrefs.distance);
  const efficiencyUnit = `Wh/${unitPrefs.distance}`;
  const efficiency = distanceDisplay > 0 ? energyWh / distanceDisplay : 0;

  return (
    <section
      aria-label={t('trips.detail.kpi.label', 'Trip summary metrics')}
      className={gridClass}
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
