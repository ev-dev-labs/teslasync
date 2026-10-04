import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { Delta } from '@/components/data-display';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useDrivingStats } from '@/api/hooks/useDriving';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';

import { convertDistanceFromSI, convertSpeedFromSI } from '@/lib/unitConversion';
import type { Direction, MetricUnit } from '@/lib/metricSemantics';
import type { DriveDetail } from '@/types/driving';
import type { ChartDataPoint, DriveStats } from './types';
import { driveEnergyEvidence } from './energyEvidence';
import { driveOdometerEvidence } from './odometerEvidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type SummaryMetric = {
  key: string; label: string; value: number | null; unit: string;
  baseline: number | null; comparedTo: string; direction: Direction; metricUnit?: MetricUnit;
  formattedValue?: string; description?: string;
};

/** Recorded basics first; sample extrema remain in the evidence charts. */
export function HeroGauges({ drive, stats, chartData, meaningful = true }: {
  drive: DriveDetail;
  stats: DriveStats;
  chartData?: ChartDataPoint[];
  meaningful?: boolean;
}) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatEnergyCost, pricingState } = useFormatting();
  const query = useDrivingStats(drive.vehicleId != null ? String(drive.vehicleId) : undefined);
  const state = useDataState(query, { provenance: 'historical' });
  const fleet = state.data;
  const count = fleet?.totalDrives ?? 0;
  const finite = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? value : null;
  const distance = finite(drive.distanceM);
  const score = finite(drive.score);
  const historyTopSpeed = finite(fleet?.topSpeedKmh);
  const historyEfficiency = finite(fleet?.avgEfficiencyWhKm);
  const { energyWh } = driveEnergyEvidence(drive, stats);
  const odometer = driveOdometerEvidence(drive, stats, unitPrefs.distance, chartData);
  const displayUnitsPerKm = convertDistanceFromSI(1000, unitPrefs.distance);
  const consumption = distance != null && distance > 0
    ? energyWh
    : null;
  const vsAverage = t('driveDetail.vsAverage', 'vs your average');
  const rows: SummaryMetric[] = [
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
      baseline: historyTopSpeed != null
        ? convertSpeedFromSI(historyTopSpeed / 3.6, unitPrefs.speed) : null,
      comparedTo: t('driveDetail.vsRecord', 'vs your record'), direction: 'neutral',
      metricUnit: unitPrefs.speed === 'mph' ? 'mph' : 'kph',
    },
    {
      key: 'consumption', label: t('driveDetail.consumption', 'Consumption'),
      value: consumption != null && distance != null
        ? consumption / (distance / 1000) / displayUnitsPerKm : null,
      unit: `Wh/${unitPrefs.distance}`,
      baseline: historyEfficiency != null
        ? historyEfficiency / displayUnitsPerKm : null,
      comparedTo: vsAverage, direction: 'lower_better',
    },
    {
      key: 'battery-rate', label: t('driveDetail.report.batteryRate', 'Battery use per 100 {{unit}}', { unit: unitPrefs.distance }),
      value: distance != null && distance > 0 && drive.startBatteryPct != null && drive.endBatteryPct != null
        ? (drive.startBatteryPct - drive.endBatteryPct) / convertDistanceFromSI(distance, unitPrefs.distance) * 100 : null,
      unit: '%', baseline: null, comparedTo: vsAverage, direction: 'lower_better', metricUnit: 'percent',
    },
  ];
  const basicMetric = (key: string, label: string, value: number | null, unit = ''): SummaryMetric =>
    ({ key, label, value, unit, baseline: null, comparedTo: vsAverage, direction: 'neutral' });
  const basics: SummaryMetric[] = [
    {
      ...basicMetric('drive-cost', t('driveDetail.report.driveCost', 'Drive cost'), energyWh),
      formattedValue: energyWh != null ? formatEnergyCost(energyWh / 1000) : undefined,
      description: t('driveDetail.report.costSummaryNote', 'Configured-rate estimate, not a charging invoice'),
    },
    ...rows.filter((row) => row.key === 'distance' || row.key === 'duration'),
    {
      ...basicMetric('battery-change', t('driveDetail.report.batteryChange', 'Battery change'), null),
      formattedValue: finite(drive.startBatteryPct) != null || finite(drive.endBatteryPct) != null
        ? `${finite(drive.startBatteryPct) != null ? fmtNumber(drive.startBatteryPct!) : '—'}% → ${finite(drive.endBatteryPct) != null ? fmtNumber(drive.endBatteryPct!) : '—'}%`
        : undefined,
    },
    {
      ...basicMetric('odometer', drive.endTs == null
        ? t('driveDetail.report.ongoingOdometer', 'Odometer (start → latest)')
        : t('driveDetail.odometer', 'Odometer (from → to)'), null, unitPrefs.distance),
      formattedValue: odometer.start != null || odometer.end != null
        ? `${odometer.start != null ? fmtNumber(odometer.start) : '—'} → ${odometer.end != null ? fmtNumber(odometer.end) : '—'}`
        : undefined,
    },
    {
      ...basicMetric('drive-energy', t('driveDetail.report.driveEnergy', 'Drive energy'), energyWh),
      formattedValue: energyWh != null ? formatEnergy(energyWh) : undefined,
      description: drive.energyUsedWh != null ? t('driveDetail.report.persisted', 'Persisted drive aggregate')
        : t('driveDetail.report.estimatedEnergy', 'Estimated from recorded power'),
    },
    ...rows.filter((row) => row.key === 'consumption'),
  ];
  const performance = rows.filter((row) =>
    row.key === 'average-speed' || row.key === 'maximum-speed' || row.key === 'battery-rate');
  const metric = (row: SummaryMetric, tiled: boolean) => (
    <div key={row.key} data-drive-metric={row.key}
      className={`min-w-0 ${tiled ? 'rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 sm:p-4' : 'py-2'} ${row.key === 'odometer' ? 'min-[380px]:col-span-2 xl:col-span-1' : ''}`}>
      <Text variant="metricLabel">{row.label}</Text>
      <div className="mt-2 flex flex-wrap items-baseline gap-1">
        <Text as="span" variant="metricValue" className="break-words tabular-nums">
          {row.formattedValue ?? (row.value != null ? fmtNumber(row.value) : '—')}
        </Text>
        {row.unit ? <Text as="span" size="xs" color="muted">{row.unit}</Text> : null}
      </div>
      {row.description ? <Text as="p" variant="caption" className="mt-2">{row.description}</Text> : null}
      {row.value != null && row.baseline != null ? (
        <Delta metric={{ direction: row.direction, unit: row.metricUnit }} current={row.value} previous={row.baseline} display="percent" comparedTo={row.comparedTo} />
      ) : null}
    </div>
  );
  return (
    <FadeIn>
      <GlassPanel className="p-4 sm:p-5" data-testid="drive-canonical-summary">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <PanelTitle className="mb-0">{t('driveDetail.report.overview', 'Overview')}</PanelTitle>
          <Text as="p" variant="caption">
            {t('driveDetail.report.summarySource', 'Recorded drive details · comparisons use this vehicle’s history')}
          </Text>
          <Text as="p" variant="caption">
            {t('driveDetail.report.recordedScore', 'Recorded score')}: {score != null ? fmtNumber(score) : '—'}
          </Text>
        </div>
        {state.fatalError ? (
          <div aria-label={t('driveDetail.report.baselines', 'Vehicle baselines')}>
            <QueryError error={state.fatalError} onRetry={() => void query.refetch()} />
          </div>
        ) : null}
        <StaleRefreshWarning state={state} label={t('driveDetail.report.baselines', 'Vehicle baselines')} />
        {pricingState?.fatalError ? (
          <QueryError error={pricingState.fatalError} onRetry={pricingState.retry ?? undefined} />
        ) : null}
        {pricingState ? <StaleRefreshWarning state={pricingState} label={t('nav.settings', 'Settings')} /> : null}
        <div role="group" aria-label={t('driveDetail.heroGauges', 'Drive summary')}>
          <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 xl:grid-cols-4">
            {basics.slice(0, 4).map(row => metric(row, true))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 xl:grid-cols-3">
            {basics.slice(4).map(row => metric(row, true))}
          </div>
        </div>
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
          <Text as="p" variant="caption" className="mb-3">
            {t('driveDetail.report.performance', 'Performance and comparisons')}
          </Text>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{performance.map(row => metric(row, false))}</div>
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
