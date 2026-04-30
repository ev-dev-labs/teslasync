import { useTranslation } from 'react-i18next';
import { MapPin, Car, Zap, Gauge, DollarSign, Leaf } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { safe } from '@/components/charts';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';
import { MetricSkeleton } from './helpers';

export function HeroGauges({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings();

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <MetricSkeleton key={i} />)}
      </div>
    );
  }

  const totalDist = convertDistance(data.total_distance_km ?? 0);
  const gasSavings = totalDist * 0.085 * 1.5 - safe(data.total_cost);
  const co2Saved = totalDist * 0.12;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <MetricCard
        label={t('analytics.hero.distance', 'Distance')}
        value={fmtNumber(totalDist, 1)}
        subtitle={distanceUnit}
        icon={<MapPin className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('analytics.hero.drives', 'Drives')}
        value={fmtInt(data.total_drives)}
        icon={<Car className="h-4 w-4" />}
        color="purple"
      />
      <MetricCard
        label={t('analytics.hero.energy', 'Energy')}
        value={fmtNumber(data.total_energy_kwh, 1)}
        subtitle="kWh"
        icon={<Zap className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('analytics.hero.efficiency', 'Efficiency')}
        value={fmtNumber(convertEfficiency(data.avg_efficiency_wh_km ?? 0), 1)}
        subtitle={efficiencyUnit}
        icon={<Gauge className="h-4 w-4" />}
        color="amber"
      />
      <MetricCard
        label={t('analytics.hero.gasSavings', 'Gas Savings')}
        value={`$${fmtNumber(Math.max(gasSavings, 0), 0)}`}
        icon={<DollarSign className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('analytics.hero.co2Saved', 'CO₂ Saved')}
        value={fmtNumber(co2Saved, 0)}
        subtitle="kg"
        icon={<Leaf className="h-4 w-4" />}
        color="green"
      />
    </div>
  );
}
