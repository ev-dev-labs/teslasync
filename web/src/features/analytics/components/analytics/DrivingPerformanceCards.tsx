import { useTranslation } from 'react-i18next';
import { Gauge, TrendingUp, Zap, BatteryCharging, MapPin, Car } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { safe } from '@/components/charts';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';

export function DrivingPerformanceCards({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertDistance, convertSpeed, distanceUnit, speedUnit } = useSettings();

  const da = data?.drive_analytics;
  const ss = da?.speed_stats;
  const ps = da?.power_stats;
  const rs = da?.regen_stats;
  const ds = da?.distance_stats;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <MetricCard
        label={t('analytics.driving.topSpeed', 'Top Speed')}
        value={ss ? fmtNumber(convertSpeed(safe(ss.max)), 0) : '—'}
        subtitle={speedUnit}
        icon={<Gauge className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('analytics.driving.avgSpeed', 'Avg Speed')}
        value={ss ? fmtNumber(convertSpeed(safe(ss.avg)), 0) : '—'}
        subtitle={speedUnit}
        icon={<TrendingUp className="h-4 w-4" />}
        color="purple"
      />
      <MetricCard
        label={t('analytics.driving.peakPower', 'Peak Power')}
        value={ps ? fmtNumber(safe(ps.max), 0) : '—'}
        subtitle="kW"
        icon={<Zap className="h-4 w-4" />}
        color="amber"
      />
      <MetricCard
        label={t('analytics.driving.peakRegen', 'Peak Regen')}
        value={rs ? fmtNumber(safe(rs.max), 0) : '—'}
        subtitle="kW"
        icon={<BatteryCharging className="h-4 w-4" />}
        color="green"
      />
      <MetricCard
        label={t('analytics.driving.avgDriveDist', 'Avg Drive Distance')}
        value={ds ? fmtNumber(convertDistance(safe(ds.avg)), 1) : '—'}
        subtitle={distanceUnit}
        icon={<MapPin className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('analytics.driving.longestDrive', 'Longest Drive')}
        value={ds ? fmtNumber(convertDistance(safe(ds.max)), 1) : '—'}
        subtitle={distanceUnit}
        icon={<Car className="h-4 w-4" />}
        color="purple"
      />
    </div>
  );
}
