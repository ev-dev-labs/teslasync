import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Button, Drawer, GlassPanel, PanelTitle, Text } from '@/components/ui';
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
import { JourneySequence } from './JourneySequence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type SummaryMetric = {
  key: string; label: string; value: number | null; unit: string;
  baseline: number | null; comparedTo: string; direction: Direction; metricUnit?: MetricUnit;
  formattedValue?: string; description?: string;
};

/**
 * Drive Overview: one hero surface (route map + the journey told in order with
 * its key energy numbers), then one evenly sized grid for the remaining
 * metrics. Each value appears once; per-field sources live in the details
 * drawer, not on the card face. Presentation only — calculations unchanged.
 */
export function HeroGauges({ drive, stats, chartData, meaningful = true, map }: {
  drive: DriveDetail;
  stats: DriveStats;
  chartData?: ChartDataPoint[];
  meaningful?: boolean;
  /** Route map rendered in the hero's map cell (RouteMapSection, embedded). */
  map?: ReactNode;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { costPerKwh, formatEnergyCost, pricingState } = useFormatting();
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
  const odometerSource = odometer.source === 'aggregate'
    ? t('driveDetail.report.persisted', 'Persisted drive aggregate')
    : odometer.source === 'sampled'
      ? t('driveDetail.report.sampled', 'Recorded telemetry samples')
      : t('driveDetail.report.odometerMixed', 'Recorded endpoints with telemetry fallback');
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
      formattedValue: energyWh == null ? undefined : costPerKwh == null ? t('driveDetail.noRateConfigured', 'No rate configured') : formatEnergyCost(energyWh / 1000),
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
  const byKey = (key: string) => [...basics, ...rows].find((row) => row.key === key)!;
  const withUnit = (value: string, unit: string) => (!unit ? value : unit === '%' ? `${value}%` : `${value} ${unit}`);
  const display = (row: SummaryMetric) => (row.formattedValue != null
    ? row.key === 'odometer' ? withUnit(row.formattedValue, row.unit) : row.formattedValue
    : row.value != null ? withUnit(fmtNumber(row.value), row.unit) : '—');
  const comparison = (row: SummaryMetric, comparedTo = row.comparedTo) => (row.value != null && row.baseline != null
    ? <Delta metric={{ direction: row.direction, unit: row.metricUnit }}
      current={row.value} previous={row.baseline} display="percent" comparedTo={comparedTo} />
    : null);
  const stat = (row: SummaryMetric) => (
    <div key={row.key} className="min-w-0" data-overview-metric={row.key}>
      <Text as="dt" variant="caption" className="break-words">{row.label}</Text>
      <Text as="dd" variant="body" weight="semibold" color="primary" className="tabular-nums">{display(row)}</Text>
      {comparison(row) ? <dd className="mt-0.5">{comparison(row)}</dd> : null}
    </div>
  );
  const distanceRow = byKey('distance');
  const durationRow = byKey('duration');
  // Key numbers sit under the journey; the grid holds the remaining metrics.
  const keyNumbers = [byKey('drive-energy'), byKey('consumption'), byKey('drive-cost')]
    .map((row) => row.key === 'drive-energy' ? { ...row, label: t('driveDetail.energyUsed', 'Energy used') } : row);
  const gridMetrics = [byKey('average-speed'), byKey('maximum-speed'), byKey('battery-rate'), byKey('odometer')];
  const odometerRow = byKey('odometer');
  const details: Array<{ id: string; label: string; value: ReactNode }> = [
    { id: 'source', label: t('driveDetail.report.source', 'Source and method'), value: t('driveDetail.report.summarySource', 'Recorded drive details · comparisons use this vehicle’s history') },
    { id: 'score', label: t('driveDetail.report.recordedScore', 'Recorded score'), value: score != null ? fmtNumber(score) : '—' },
    { id: 'energy', label: t('driveDetail.energyUsed', 'Energy used'), value: byKey('drive-energy').description },
    { id: 'cost', label: t('driveDetail.report.driveCost', 'Drive cost'), value: byKey('drive-cost').description },
    { id: 'battery', label: t('driveDetail.report.batteryChange', 'Battery change'), value: t('driveDetail.brief.batteryEndpoints', 'Recorded battery endpoints: {{start}}% → {{end}}%; an absent endpoint remains unknown.', {
      start: finite(drive.startBatteryPct) != null ? fmtNumber(drive.startBatteryPct!) : '—',
      end: finite(drive.endBatteryPct) != null ? fmtNumber(drive.endBatteryPct!) : '—',
    }) },
    { id: 'odometer', label: odometerRow.label, value: t('driveDetail.brief.odometerSource', 'Odometer endpoints use {{source}} evidence; missing endpoints are not zero.', { source: odometerSource }) },
    { id: 'battery-rate', label: byKey('battery-rate').label, value: t('driveDetail.brief.batteryRateBasis', 'Recorded battery percentage-point change divided by positive measured distance, per 100 {{unit}}.', { unit: unitPrefs.distance }) },
    ...(drive.energyUsedWh == null && consumption != null ? [{
      id: 'consumption', label: t('driveDetail.consumption', 'Consumption'),
      value: t('driveDetail.report.consumptionEstimate', 'Consumption uses estimated energy; see energy evidence for assumptions.'),
    }] : []),
  ];
  const overviewTitle = t('driveDetail.report.overview', 'Overview');

  return (
    <FadeIn>
      <GlassPanel className="overflow-hidden p-0" data-testid="drive-canonical-summary">
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
          <PanelTitle className="mb-0">{overviewTitle}</PanelTitle>
          <Button type="button" variant="ghost" size="sm" aria-haspopup="dialog" aria-expanded={detailsOpen}
            icon={<Info className="h-4 w-4" aria-hidden="true" />} onClick={() => setDetailsOpen(true)}>
            {t('driveDetail.report.details', 'Details')}
          </Button>
        </header>
        <div className="space-y-3 px-4 sm:px-5 [&:empty]:hidden">
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
        </div>
        {/* Hero: map (~60%) beside the journey panel; stacked map-first on mobile. */}
        <div className="mt-4 grid border-t border-[var(--border-subtle)] lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]" data-testid="drive-overview-hero">
          <div id="route" data-testid="drive-detail-route" className="min-w-0 scroll-mt-24">{map}</div>
          <div id="journey" className="flex min-w-0 scroll-mt-24 flex-col gap-4 border-t border-[var(--border-subtle)] p-4 sm:p-5 lg:border-s lg:border-t-0">
            <JourneySequence drive={drive}
              distance={display(distanceRow)} duration={display(durationRow)}
              comparisons={[
                comparison(distanceRow, t('driveDetail.distanceVsAverage', 'distance vs your average')),
                comparison(durationRow, t('driveDetail.durationVsAverage', 'duration vs your average')),
              ]} />
            <dl role="group" aria-label={t('driveDetail.report.keyNumbers', 'Energy and cost')}
              className="grid grid-cols-3 gap-3 border-t border-[var(--border-subtle)] pt-4">
              {keyNumbers.map(stat)}
            </dl>
          </div>
        </div>
        {/* Remaining metrics: one grid, the same column count on every row. */}
        <dl role="group" aria-label={t('driveDetail.report.performance', 'Performance and comparisons')}
          className="grid grid-cols-2 gap-4 border-t border-[var(--border-subtle)] p-4 sm:p-5 lg:grid-cols-4" data-testid="drive-overview-grid">
          {gridMetrics.map(stat)}
        </dl>
      </GlassPanel>
      <Drawer open={detailsOpen} onClose={() => setDetailsOpen(false)}
        title={t('driveDetail.report.overviewDetails', 'Overview details')}>
        <dl className="space-y-3">
          {details.map((item) => (
            <div key={item.id} className="min-w-0">
              <Text as="dt" variant="label">{item.label}</Text>
              <Text as="dd" variant="bodySm" color="secondary" className="break-words">{item.value ?? '—'}</Text>
            </div>
          ))}
        </dl>
      </Drawer>
    </FadeIn>
  );
}
