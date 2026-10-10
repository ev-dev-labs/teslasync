import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';

import { FleetSectionBrief } from '../operationalbrief-a-m/FleetSectionBrief';
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
  const { data } = query;

  const da = data?.drive_analytics;
  const ss = da?.speed_stats;
  // The `/analytics/fleet` `drive_analytics` payload does not (yet) carry
  // driving `power_stats` / `regen_stats`, so these two metrics degrade to the
  // em-dash placeholder until the backend surfaces those aggregates. They are
  // guarded exactly like the stats that are present so nothing throws in the
  // meantime.
  const ps = da?.power_stats;
  const rs = da?.regen_stats;
  const ds = da?.distance_stats;
  const metrics: StatMetric[] = [
    { metricId: 'speed', occurrenceId: 'driving-top-speed', rawValue: ss?.max != null ? ss.max * METERS_PER_KM / SECONDS_PER_HOUR : null,
      label: t('analytics.driving.topSpeed', 'Top speed'),
      display: { formatter: raw => ({ value: fmtNumber(convertSpeedFromSI(raw, speedUnit)), unit: speedUnit }) } },
    { metricId: 'speed', occurrenceId: 'driving-average-speed', rawValue: ss?.avg != null ? ss.avg * METERS_PER_KM / SECONDS_PER_HOUR : null,
      label: t('analytics.driving.avgSpeed', 'Avg speed'),
      display: { formatter: raw => ({ value: fmtNumber(convertSpeedFromSI(raw, speedUnit)), unit: speedUnit }) } },
    { metricId: 'power', occurrenceId: 'driving-peak-power', rawValue: ps?.max != null ? ps.max * 1000 : null,
      label: t('analytics.driving.peakPower', 'Peak power'),
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kW' }) } },
    { metricId: 'power', occurrenceId: 'driving-peak-regen', rawValue: rs?.max != null ? rs.max * 1000 : null,
      label: t('analytics.driving.peakRegen', 'Peak regen'),
      display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kW' }) } },
    { metricId: 'distance', occurrenceId: 'driving-average-distance', rawValue: ds?.avg != null ? ds.avg * METERS_PER_KM : null,
      label: t('analytics.driving.avgDriveDist', 'Avg drive distance'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) } },
    { metricId: 'distance', occurrenceId: 'driving-longest-distance', rawValue: ds?.max != null ? ds.max * METERS_PER_KM : null,
      label: t('analytics.driving.longestDrive', 'Longest drive'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) } },
  ];

  return (
    <div
      role="group"
      aria-label={t('analytics.driving.performanceBand', 'Driving performance metrics')}
      className="min-w-0"
    >
      <FleetSectionBrief query={query} metrics={metrics}
        title={t('analytics.driving.performanceBand', 'Driving performance metrics')}
        description={t('analytics.brief.drivingDescription', 'Returned speed and distance statistics; power and regeneration remain unknown when the response omits them.')} />
    </div>
  );
}
