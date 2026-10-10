import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { Delta } from '@/components/data-display';
import type { StatMetric, StatPeriod } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useDrivingStats } from '@/api/hooks/useDriving';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';

import { convertDistanceFromSI, convertDistanceToSI, convertSpeedFromSI } from '@/lib/unitConversion';
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
  const { formatEnergyCost, pricingState, costPerKwh } = useFormatting();
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
  const recordPeriod: StatPeriod = {
    kind: 'event', eventId: String(drive.id), start: drive.startTs,
    end: drive.endTs ?? null, label: t('driveDetail.heroGauges', 'Drive summary'),
    provenance: t('driveDetail.report.summarySource', 'Recorded drive details · comparisons use this vehicle’s history'),
  };
  const canonicalMetric = (row: SummaryMetric): StatMetric => {
    let metricId: StatMetric['metricId'] = 'number';
    let rawValue: number | null = row.value;
    switch (row.key) {
      case 'drive-cost':
        metricId = 'currency';
        rawValue = energyWh != null && costPerKwh != null ? energyWh / 1000 * costPerKwh : null;
        break;
      case 'distance': metricId = 'distance'; rawValue = meaningful ? distance : null; break;
      case 'duration': metricId = 'duration'; rawValue = row.value != null ? row.value * 60 : null; break;
      case 'average-speed': metricId = 'speed'; rawValue = meaningful ? finite(drive.avgSpeedMps) : null; break;
      case 'maximum-speed': metricId = 'speed'; rawValue = meaningful ? finite(drive.maxSpeedMps) : null; break;
      case 'consumption': metricId = 'efficiency'; rawValue = consumption != null && distance != null && distance > 0 ? consumption / distance : null; break;
      case 'drive-energy': metricId = 'energy'; rawValue = energyWh; break;
      case 'battery-change': metricId = 'percent'; rawValue = finite(drive.startBatteryPct) ?? finite(drive.endBatteryPct); break;
      case 'odometer': metricId = 'distance'; rawValue = odometer.start != null || odometer.end != null
        ? convertDistanceToSI(odometer.start ?? odometer.end ?? 0, unitPrefs.distance) : null; break;
      case 'battery-rate': metricId = 'rate'; break;
    }
    return {
      metricId, occurrenceId: row.key, label: row.label, rawValue,
      description: row.description ?? t('driveDetail.report.summarySource', 'Recorded drive details · comparisons use this vehicle’s history'),
      display: { formatter: () => ({
        value: row.formattedValue ?? (row.value != null ? fmtNumber(row.value) : '—'),
        unit: row.unit,
      }) },
      context: row.key === 'battery-change'
        ? t('driveDetail.brief.batteryEndpoints', 'Recorded battery endpoints: {{start}}% → {{end}}%; an absent endpoint remains unknown.', {
          start: finite(drive.startBatteryPct) != null ? fmtNumber(drive.startBatteryPct!) : '—',
          end: finite(drive.endBatteryPct) != null ? fmtNumber(drive.endBatteryPct!) : '—',
        })
        : row.key === 'odometer' ? t('driveDetail.brief.odometerSource', 'Odometer endpoints use {{source}} evidence; missing endpoints are not zero.', { source: odometer.source })
          : row.key === 'battery-rate' ? t('driveDetail.brief.batteryRateBasis', 'Recorded battery percentage-point change divided by positive measured distance, per 100 {{unit}}.', { unit: unitPrefs.distance })
            : undefined,
      comparison: row.key === 'battery-change' && finite(drive.endBatteryPct) != null
        ? { metricId: 'percent', rawValue: drive.endBatteryPct!, period: recordPeriod,
          label: t('driveDetail.brief.endBattery', 'Recorded end battery') }
        : row.key === 'odometer' && odometer.end != null
          ? { metricId: 'distance', rawValue: convertDistanceToSI(odometer.end, unitPrefs.distance), period: recordPeriod,
            label: drive.endTs == null ? t('driveDetail.brief.latestOdometer', 'Latest observed odometer') : t('driveDetail.brief.endOdometer', 'Recorded end odometer') }
          : undefined,
      comparisonContent: row.value != null && row.baseline != null
        ? <Delta metric={{ direction: row.direction, unit: row.metricUnit }}
          current={row.value} previous={row.baseline} display="percent" comparedTo={row.comparedTo} /> : undefined,
    };
  };
  const basicMetrics = basics.map(canonicalMetric);
  const performanceMetrics = performance.map(canonicalMetric);
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
          <NestedDrivingBrief metrics={basicMetrics}
            title={t('driveDetail.heroGauges', 'Drive summary')}
            description={t('driveDetail.report.summarySource', 'Recorded drive details · comparisons use this vehicle’s history')}
            period={recordPeriod}
            retained={state.refreshError != null || pricingState?.refreshError != null} />
        </div>
        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
          <NestedDrivingBrief metrics={performanceMetrics}
            title={t('driveDetail.report.performance', 'Performance and comparisons')}
            description={t('driveDetail.report.summarySource', 'Recorded drive details · comparisons use this vehicle’s history')}
            period={recordPeriod} retained={state.refreshError != null} />
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
