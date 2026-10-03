import { useTranslation } from 'react-i18next';
import { Gauge, TrendingUp, Zap, BatteryCharging, MapPin, Car } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { safe } from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

import { MetricBandSkeleton } from './helpers';
import type { FleetAnalyticsQuery } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;

export function DrivingPerformanceCards({ query }: { query: FleetAnalyticsQuery }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  // backend `speed_stats` is km/h; SI floor is m/s.
  const fromKmh = (kmh: number) => convertSpeedFromSI((kmh * METERS_PER_KM) / SECONDS_PER_HOUR, speedUnit);
  // backend `distance_stats` is km; SI floor is meters.
  const fromKm = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);

  const { data, isLoading } = query;
  if (isLoading) {
    return <MetricBandSkeleton count={6} />;
  }

  const da = data?.drive_analytics;
  const ss = da?.speed_stats;
  // The `/analytics/fleet` `drive_analytics` payload does not (yet) carry
  // driving `power_stats` / `regen_stats`, so these two cards degrade to the
  // em-dash placeholder until the backend surfaces those aggregates. They are
  // guarded exactly like the stats that are present so nothing throws in the
  // meantime.
  const ps = da?.power_stats;
  const rs = da?.regen_stats;
  const ds = da?.distance_stats;

  return (
    <div
      role="group"
      aria-label={t('analytics.driving.performanceBand', 'Driving performance metrics')}
      className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6"
    >
      <MetricCard
        label={t('analytics.driving.topSpeed', 'Top speed')}
        value={ss ? fmtNumber(fromKmh(safe(ss.max))) : '—'}
        subtitle={speedUnit}
        icon={<Gauge className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('analytics.driving.avgSpeed', 'Avg speed')}
        value={ss ? fmtNumber(fromKmh(safe(ss.avg))) : '—'}
        subtitle={speedUnit}
        icon={<TrendingUp className="h-4 w-4" />}
        color="purple"
      />
      <MetricCard
        label={t('analytics.driving.peakPower', 'Peak power')}
        value={ps ? fmtNumber(safe(ps.max)) : '—'}
        subtitle="kW"
        icon={<Zap className="h-4 w-4" />}
        color="amber"
      />
      <MetricCard
        label={t('analytics.driving.peakRegen', 'Peak regen')}
        value={rs ? fmtNumber(safe(rs.max)) : '—'}
        subtitle="kW"
        icon={<BatteryCharging className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('analytics.driving.avgDriveDist', 'Avg drive distance')}
        value={ds ? fmtNumber(fromKm(safe(ds.avg))) : '—'}
        subtitle={distanceUnit}
        icon={<MapPin className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('analytics.driving.longestDrive', 'Longest drive')}
        value={ds ? fmtNumber(fromKm(safe(ds.max))) : '—'}
        subtitle={distanceUnit}
        icon={<Car className="h-4 w-4" />}
        color="purple"
      />
    </div>
  );
}
