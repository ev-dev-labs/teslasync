import { useTranslation } from 'react-i18next';
import { MapPin, Car, Zap, Gauge, DollarSign, Leaf } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { safe } from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { MetricBandSkeleton } from './helpers';
import type { FleetAnalyticsQuery } from './constants';

const KM_PER_MILE = 1.609344;

export function HeroGauges({ query }: { query: FleetAnalyticsQuery }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const { data, isLoading } = query;

  if (isLoading) {
    return <MetricBandSkeleton count={6} />;
  }

  // backend `total_distance_km` is SI km — go through the meter-floored helper
  // so the conversion factor lives in `lib/unitConversion`, not here. `safe`
  // also coerces a NaN/Infinity payload to 0 before it can reach the display.
  const totalDistKm = safe(data?.total_distance_km);
  const totalDist = convertDistanceFromSI(totalDistKm * 1000, distanceUnit);
  // Gas savings + CO₂ heuristics are tied to KM regardless of display unit so
  // the dollar/kg outputs stay stable for the same trip.
  const gasSavings = totalDistKm * 0.085 * 1.5 - safe(data?.total_cost);
  const co2Saved = totalDistKm * 0.12;
  const avgEffWhPerKm = safe(data?.avg_efficiency_wh_km);
  const avgEffDisplay = distanceUnit === 'mi' ? avgEffWhPerKm * KM_PER_MILE : avgEffWhPerKm;

  // A resolved-but-empty query (error, or an idle state that never loaded)
  // leaves `data` undefined. Show a neutral em dash in every tile rather than a
  // band of "0"s that reads as real data — mirrors DrivingPerformanceCards.
  const dash = '—';

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <MetricCard
        label={t('analytics.hero.distance', 'Distance')}
        value={data ? fmtNumber(totalDist, 1) : dash}
        subtitle={distanceUnit}
        icon={<MapPin className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('analytics.hero.drives', 'Drives')}
        value={data ? fmtInt(data.total_drives) : dash}
        icon={<Car className="h-4 w-4" />}
        color="purple"
      />
      <MetricCard
        label={t('analytics.hero.energy', 'Energy')}
        value={data ? fmtNumber(data.total_energy_kwh, 1) : dash}
        subtitle="kWh"
        icon={<Zap className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('analytics.hero.efficiency', 'Efficiency')}
        value={data ? fmtNumber(avgEffDisplay, 1) : dash}
        subtitle={efficiencyUnit}
        icon={<Gauge className="h-4 w-4" />}
        color="amber"
      />
      <MetricCard
        label={t('analytics.hero.gasSavings', 'Gas Savings')}
        value={data ? formatCurrency(Math.max(gasSavings, 0), 0) : dash}
        icon={<DollarSign className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('analytics.hero.co2Saved', 'CO₂ Saved')}
        value={data ? fmtNumber(co2Saved, 0) : dash}
        subtitle="kg"
        icon={<Leaf className="h-4 w-4" />}
        color="green"
      />
    </div>
  );
}
