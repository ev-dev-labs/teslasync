import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { Delta } from '@/components/data-display';
import { StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useDrivingStats } from '@/api/hooks/useDriving';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';

import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import type { Direction, MetricUnit } from '@/lib/metricSemantics';
import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';
import { driveEnergyEvidence } from './energyEvidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** The only aggregate summary. Sample extrema belong to the evidence chart. */
export function HeroGauges({ drive, stats, meaningful = true }: {
  drive: DriveDetail;
  stats: DriveStats;
  meaningful?: boolean;
}) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const query = useDrivingStats(drive.vehicleId != null ? String(drive.vehicleId) : undefined);
  const state = useDataState(query, { provenance: 'historical' });
  const fleet = state.data;
  const count = fleet?.totalDrives ?? 0;
  const finite = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? value : null;
  const distance = finite(drive.distanceM);
  const score = finite(drive.score);
  const { energyWh } = driveEnergyEvidence(drive, stats);
  const displayUnitsPerKm = convertDistanceFromSI(1000, unitPrefs.distance);
  const consumption = distance != null && distance > 0
    ? energyWh
    : null;
  const vsAverage = t('driveDetail.vsAverage', 'vs your average');
  const rows: {
    key: string; label: string; value: number | null; unit: string;
    baseline: number | null; comparedTo: string; direction: Direction; metricUnit?: MetricUnit;
  }[] = [
    {
      key: 'distance', label: t('driveDetail.distance', 'Distance'),
      value: meaningful && distance != null ? convertDistanceFromSI(distance, unitPrefs.distance) : null,
      unit: unitPrefs.distance,
      baseline: count > 0 && fleet?.totalDistanceKm != null
        ? convertDistanceFromSI(fleet.totalDistanceKm * 1000 / count, unitPrefs.distance) : null,
      comparedTo: vsAverage, direction: 'neutral', metricUnit: unitPrefs.distance === 'mi' ? 'mi' : 'km',
    },
    {
      key: 'duration', label: t('driveDetail.duration', 'Duration'),
      value: finite(drive.durationS) != null ? Math.max(0, drive.durationS) / 60 : null,
      unit: t('driveDetail.minutesShort', 'min'),
      baseline: count > 0 && fleet?.totalDurationS != null ? fleet.totalDurationS / count / 60 : null,
      comparedTo: vsAverage, direction: 'neutral', metricUnit: 'min',
    },
    {
      key: 'average-speed', label: t('driveDetail.avgSpeed', 'Average speed'),
      value: finite(drive.avgSpeedMps) != null && meaningful
        ? convertSpeedFromSI(drive.avgSpeedMps!, unitPrefs.speed) : null,
      unit: unitPrefs.speed, baseline: null, comparedTo: vsAverage, direction: 'neutral',
    },
    {
      key: 'maximum-speed', label: t('driveDetail.maxSpeed', 'Maximum speed'),
      value: finite(drive.maxSpeedMps) != null && meaningful
        ? convertSpeedFromSI(drive.maxSpeedMps!, unitPrefs.speed) : null,
      unit: unitPrefs.speed,
      baseline: finite(fleet?.topSpeedKmh) != null
        ? convertSpeedFromSI(fleet!.topSpeedKmh / 3.6, unitPrefs.speed) : null,
      comparedTo: t('driveDetail.vsRecord', 'vs your record'), direction: 'neutral',
      metricUnit: unitPrefs.speed === 'mph' ? 'mph' : 'kph',
    },
    {
      key: 'consumption', label: t('driveDetail.consumption', 'Consumption'),
      value: consumption != null && distance != null
        ? consumption / (distance / 1000) / displayUnitsPerKm : null,
      unit: `Wh/${unitPrefs.distance}`,
      baseline: finite(fleet?.avgEfficiencyWhKm) != null
        ? fleet!.avgEfficiencyWhKm / displayUnitsPerKm : null,
      comparedTo: vsAverage, direction: 'lower_better',
    },
    {
      key: 'battery-rate', label: t('driveDetail.report.batteryRate', 'Battery use per 100 {{unit}}', { unit: unitPrefs.distance }),
      value: distance != null && distance > 0 && drive.startBatteryPct != null && drive.endBatteryPct != null
        ? (drive.startBatteryPct - drive.endBatteryPct) / convertDistanceFromSI(distance, unitPrefs.distance) * 100 : null,
      unit: '%', baseline: null, comparedTo: vsAverage, direction: 'lower_better', metricUnit: 'percent',
    },
  ];
  return (
    <FadeIn>
      <GlassPanel className="p-4 sm:p-5" data-testid="drive-canonical-summary">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <PanelTitle className="mb-0">{t('driveDetail.report.overview', 'Overview')}</PanelTitle>
          <Text as="p" variant="caption">
            {t('driveDetail.report.aggregateSource', 'Drive aggregates · comparisons use this vehicle’s history')}
          </Text>
          <Text as="p" variant="caption">
            {t('driveDetail.report.recordedScore', 'Recorded score')}: {score != null ? fmtNumber(score) : '—'}
          </Text>
        </div>
        <StaleRefreshWarning state={state} label={t('driveDetail.report.baselines', 'Vehicle baselines')} />
        <div role="group" aria-label={t('driveDetail.heroGauges', 'Drive summary')} className="grid grid-cols-2 gap-x-5 gap-y-5 md:grid-cols-3 xl:grid-cols-6">
          {rows.map((row) => (
            <div key={row.key} className="min-w-0">
              <Text variant="metricLabel">{row.label}</Text>
              <div className="mt-1 flex flex-wrap items-baseline gap-1 text-[var(--text-primary)]">
                <Text as="span" variant="metricValue" className="text-xl tabular-nums sm:text-2xl">
                  {row.value != null ? fmtNumber(row.value) : '—'}
                </Text>
                <Text as="span" size="xs" color="muted">{row.unit}</Text>
              </div>
              {row.value != null && row.baseline != null ? (
                <Delta metric={{ direction: row.direction, unit: row.metricUnit }} current={row.value} previous={row.baseline} display="percent" comparedTo={row.comparedTo} />
              ) : null}
            </div>
          ))}
        </div>
        {drive.energyUsedWh == null && consumption != null ? (
          <Text as="p" variant="caption" className="mt-3">
            {t('driveDetail.report.consumptionEstimate', 'Consumption uses estimated energy; see energy evidence for assumptions.')}
          </Text>
        ) : null}
      </GlassPanel>
    </FadeIn>
  );
}
