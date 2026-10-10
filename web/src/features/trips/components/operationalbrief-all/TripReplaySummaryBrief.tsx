import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { DriveDetail } from '@/types/driving';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import { TripOperationalBrief } from './TripOperationalBrief';

interface TripReplaySummaryBriefProps {
  drive: DriveDetail | undefined;
  source: DataState<unknown>;
  elevation: { gain: number; loss: number; has: boolean };
  formatDriveTime: (minutes: number) => string;
}

export function TripReplaySummaryBrief({ drive, source, elevation, formatDriveTime }: TripReplaySummaryBriefProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const distanceDisplay = drive?.distanceM != null ? convertDistanceFromSI(drive.distanceM, unitPrefs.distance) : null;
  const efficiency = distanceDisplay != null && distanceDisplay > 0 && drive?.energyUsedWh != null
    ? drive.energyUsedWh / distanceDisplay : null;
  const scope = drive
    ? t('trips.brief.replay.scope', 'Drive #{{id}} · {{start}} – {{end}}', {
      id: drive.id, start: drive.startTs, end: drive.endTs ?? t('trips.detail.inProgress', 'In progress'),
    })
    : t('trips.brief.replay.missingScope', 'Drive record unavailable; event bounds unknown.');
  const summaryDescription = t('trips.brief.replay.description', 'Stored drive totals are independent of the GPS trail. Elevation gain and loss use only consecutive positions with measured elevation.');
  const batteryKnown = drive?.startBatteryPct != null && drive?.endBatteryPct != null;
  const batteryFinite = batteryKnown && Number.isFinite(drive?.startBatteryPct) && Number.isFinite(drive?.endBatteryPct);
  const metrics: readonly StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'distance', rawValue: drive?.distanceM,
      label: t('replay.summary.distance', 'Distance'), description: scope,
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, unitPrefs.distance)), unit: unitPrefs.distance }) } },
    { metricId: 'duration', occurrenceId: 'duration', rawValue: drive?.durationS,
      label: t('replay.summary.duration', 'Duration'), description: scope,
      display: { formatter: raw => ({ value: formatDriveTime(raw / 60), unit: '' }) } },
    { metricId: 'speed', occurrenceId: 'average-speed', rawValue: drive?.avgSpeedMps,
      label: t('replay.summary.avgSpeed', 'Avg Speed'), description: scope,
      display: { formatter: raw => ({ value: fmtNumber(convertSpeedFromSI(raw, unitPrefs.speed)), unit: unitPrefs.speed }) } },
    { metricId: 'speed', occurrenceId: 'maximum-speed', rawValue: drive?.maxSpeedMps,
      label: t('replay.summary.maxSpeed', 'Max Speed'), description: scope,
      display: { formatter: raw => ({ value: fmtNumber(convertSpeedFromSI(raw, unitPrefs.speed)), unit: unitPrefs.speed }) } },
    { metricId: 'efficiency', occurrenceId: 'efficiency',
      rawValue: efficiency != null && drive?.distanceM ? (drive.energyUsedWh ?? 0) / drive.distanceM : null,
      label: t('replay.summary.efficiency', 'Efficiency'), description: scope,
      missingReason: t('trips.brief.detail.efficiencyReason', 'Efficiency requires a positive trip distance.'),
      display: { formatter: () => ({ value: fmtNumber(efficiency ?? 0), unit: unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km' }) } },
    { metricId: 'percent', occurrenceId: 'battery', rawValue: batteryKnown ? batteryFinite ? drive?.startBatteryPct : Number.NaN : null,
      label: t('replay.summary.battery', 'Battery'), description: scope,
      context: batteryFinite ? t('trips.brief.replay.batteryContext', 'Start {{start}}% → end {{end}}%', {
        start: fmtInt(drive?.startBatteryPct ?? 0), end: fmtInt(drive?.endBatteryPct ?? 0),
      }) : undefined,
      display: { formatter: raw => ({ value: `${fmtInt(raw)}% → ${fmtInt(drive?.endBatteryPct ?? 0)}%`, unit: '' }) } },
    { metricId: 'distance', occurrenceId: 'elevation-gain', rawValue: elevation.has ? elevation.gain : null,
      label: t('replay.summary.elevGain', 'Elevation Gain'), description: summaryDescription,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: 'm' }) } },
    { metricId: 'distance', occurrenceId: 'elevation-loss', rawValue: elevation.has ? elevation.loss : null,
      label: t('replay.summary.elevLoss', 'Elevation Loss'), description: summaryDescription,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: 'm' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return (
      <TripOperationalBrief source={source} metrics={operationalMetrics} scope={scope}
        eyebrow={t('trips.brief.replay.eyebrow', 'Trip replay')}
        title={t('replay.summary.title', 'Drive Summary')}
        description={summaryDescription}
        provenance={t('trips.brief.replay.provenance', 'Stored drive summary and the loaded, telemetry-enriched GPS trail.')} />
  );
}
