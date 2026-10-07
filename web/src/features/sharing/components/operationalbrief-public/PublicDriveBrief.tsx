import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { MetricPreferences } from '@/lib/metric-reference';
import type { SharedDriveData } from '@/types/sharing';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import { PublicReportBrief } from './PublicReportBrief';

interface Props {
  readonly drive: SharedDriveData['drive'];
  readonly preferences: MetricPreferences;
  readonly formatDistance: (value: number) => string;
  readonly formatSpeed: (value: number) => string;
  readonly formatEfficiency: (value: number) => string;
  readonly formatElevation: (value: number) => string;
  readonly fmtNumber: (value: unknown) => string;
}

export function PublicDriveBrief({
  drive, preferences, formatDistance, formatSpeed, formatEfficiency, formatElevation, fmtNumber,
}: Props) {
  const { t } = useTranslation();
  const source = t('share.publicBrief.driveSource', 'Owner-shared drive payload');
  const metrics: StatMetric[] = [
    {
      metricId: 'distance', occurrenceId: 'public-drive-distance', rawValue: drive.distance_m,
      label: t('share.distance', 'Distance'),
      description: t('share.publicBrief.distanceDetail', 'Recorded drive distance; source distance_m in meters.'),
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
    },
    {
      metricId: 'duration', occurrenceId: 'public-drive-duration', rawValue: drive.duration_s,
      label: t('share.duration', 'Duration'),
      description: t('share.publicBrief.durationDetail', 'Recorded elapsed seconds, displayed with the existing rounded-minute formatter.'),
      display: { formatter: raw => ({ value: formatDurationSecondsAsMinutes(raw), unit: '' }) },
    },
  ];
  if (drive.efficiency_wh_per_m != null) metrics.push({
    metricId: 'efficiency', occurrenceId: 'public-drive-efficiency', rawValue: drive.efficiency_wh_per_m,
    label: t('share.efficiency', 'Efficiency'),
    description: t('share.publicBrief.driveEfficiencyDetail', 'Recorded consumption intensity; source efficiency_wh_per_m in Wh/m, displayed in Wh/km or Wh/mi.'),
    display: { formatter: raw => ({ value: formatEfficiency(raw), unit: '' }) },
  });
  if (drive.start_battery != null && drive.end_battery != null) metrics.push({
    metricId: 'percent', occurrenceId: 'public-drive-battery', rawValue: drive.start_battery,
    label: t('share.battery', 'Battery'),
    description: t('share.publicBrief.driveBatteryDetail', 'Start and end battery percentages are separate recorded endpoints, not a calculated battery delta.'),
    display: { formatter: raw => ({
      value: `${fmtNumber(raw)}% → ${fmtNumber(drive.end_battery)}%`, unit: '',
    }) },
  });
  if (drive.max_speed_mps != null) metrics.push({
    metricId: 'speed', occurrenceId: 'public-drive-max-speed', rawValue: drive.max_speed_mps,
    label: t('share.maxSpeed', 'Max speed'),
    description: t('share.publicBrief.maxSpeedDetail', 'Recorded maximum speed; source max_speed_mps in m/s.'),
    display: { formatter: raw => ({ value: formatSpeed(raw), unit: '' }) },
  });
  if (drive.avg_speed_mps != null) metrics.push({
    metricId: 'speed', occurrenceId: 'public-drive-avg-speed', rawValue: drive.avg_speed_mps,
    label: t('share.avgSpeed', 'Avg speed'),
    description: t('share.publicBrief.avgSpeedDetail', 'Recorded average speed; source avg_speed_mps in m/s, distinct from maximum speed.'),
    display: { formatter: raw => ({ value: formatSpeed(raw), unit: '' }) },
  });
  if (drive.elevation_gain != null) metrics.push({
    metricId: 'distance', occurrenceId: 'public-drive-elevation', rawValue: drive.elevation_gain,
    label: t('share.elevGain', 'Elevation gain'),
    description: t('share.publicBrief.elevationDetail', 'Recorded elevation gain; source elevation_gain in meters, displayed in m or ft.'),
    display: { formatter: raw => ({ value: formatElevation(raw), unit: '' }) },
  });
  return (
    <PublicReportBrief
      title={t('share.publicBrief.driveTitle', 'Shared drive measurements')}
      description={t('share.publicBrief.driveDescription', 'Distance, duration, consumption, battery endpoints, speed and elevation retain the owner-shared values and existing display preferences.')}
      eventDate={drive.date}
      source={source}
      metrics={metrics}
      preferences={preferences}
      testId="public-drive-brief"
      evidence={[
        { field: 'distance_m', value: drive.distance_m, unit: 'm' },
        { field: 'duration_s', value: drive.duration_s, unit: 's' },
        { field: 'efficiency_wh_per_m', value: drive.efficiency_wh_per_m, unit: 'Wh/m' },
        { field: 'start_battery', value: drive.start_battery, unit: '%' },
        { field: 'end_battery', value: drive.end_battery, unit: '%' },
        { field: 'max_speed_mps', value: drive.max_speed_mps, unit: 'm/s' },
        { field: 'avg_speed_mps', value: drive.avg_speed_mps, unit: 'm/s' },
        { field: 'elevation_gain', value: drive.elevation_gain, unit: 'm' },
      ]}
    />
  );
}
