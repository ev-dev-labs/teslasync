import { GlassPanel } from '@/components/ui';
import { Delta } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { QueryError, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { formatDurationMinutes } from '@/lib/dateFormat';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { useUnits } from '@/hooks/useUnits';

type Props = Pick<DrivesListPageController,
  't' | 'drivesState' | 'refetchDrives' | 'isDrivesLoading' | 'currentStats'
  | 'periodLabel' | 'priorLabel' | 'fmtCompact' | 'priorHasData' | 'priorStats'
  | 'distanceUnit' | 'distMi' | 'priorDistMi' | 'driveTimeMin' | 'priorDriveTimeMin'
  | 'avgGrade' | 'efficiencyUnit' | 'avgEffDisp' | 'fmtInt' | 'priorEffDisp'
  | 'formatEnergy' | 'formatEnergyCost' | 'priorTotalCost' | 'totalCost'>;

export function DrivesOverview({
  t, drivesState, refetchDrives, isDrivesLoading, currentStats, periodLabel,
  priorLabel, fmtCompact, priorHasData, priorStats, distanceUnit, distMi,
  priorDistMi, driveTimeMin, priorDriveTimeMin, avgGrade, efficiencyUnit,
  avgEffDisp, fmtInt, priorEffDisp, formatEnergy, formatEnergyCost, priorTotalCost, totalCost,
}: Props) {
  const { unitPrefs } = useUnits();
  const available = drivesState.hasData && !isDrivesLoading;
  const scope = t('drives.brief.overviewScope', 'Aggregated returned drives in the selected window; comparison uses the independent prior window. These are not server-wide totals.');
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'drives', rawValue: available ? currentStats.count : null,
      label: t('drives.totalDrives', 'Drives'),
      display: { formatter: raw => ({ value: fmtCompact(raw), unit: '' }) },
      comparisonContent: priorHasData && priorStats ? <Delta metric="trip_count" previous={priorStats.count}
        current={currentStats.count} display="percent" comparedTo={priorLabel} /> : undefined },
    { metricId: 'distance', occurrenceId: 'distance', rawValue: available ? currentStats.totalDistanceM : null,
      label: `${t('drives.distance', 'Distance')} (${distanceUnit})`,
      display: { formatter: () => ({ value: fmtCompact(distMi, 10000), unit: '' }) },
      comparisonContent: priorHasData ? <Delta metric="distance" previous={priorDistMi}
        current={distMi} display="percent" comparedTo={priorLabel} /> : undefined },
    { metricId: 'duration', occurrenceId: 'drive-time', rawValue: available ? currentStats.totalDurationS : null,
      label: t('drives.driveTime', 'Drive time'),
      display: { formatter: raw => ({ value: formatDurationMinutes(raw / 60), unit: '' }) },
      comparisonContent: priorHasData ? <Delta metric={{ direction: 'neutral' }} previous={priorDriveTimeMin}
        current={driveTimeMin} display="percent" comparedTo={priorLabel} /> : undefined },
    { metricId: 'status', occurrenceId: 'efficiency-grade',
      rawValue: available && currentStats.avgEfficiencyWhKm != null && Number.isFinite(currentStats.avgEfficiencyWhKm) ? avgGrade.label : null,
      label: t('drives.avgGrade', 'Efficiency grade') },
    { metricId: 'efficiency', occurrenceId: 'efficiency',
      rawValue: available && currentStats.avgEfficiencyWhKm != null ? currentStats.avgEfficiencyWhKm / 1000 : null,
      label: `${t('drives.efficiency', 'Energy intensity')} (${efficiencyUnit})`,
      display: { formatter: () => ({ value: avgEffDisp != null ? fmtInt(avgEffDisp) : '—', unit: '' }) },
      description: t('operations.drives.efficiencyDetail', '{{measured}} of {{total}} drives have measured energy and sufficient distance.', {
        measured: currentStats.efficiencyMeasuredCount, total: currentStats.count,
      }),
      comparisonContent: priorHasData && avgEffDisp != null && priorEffDisp != null
        ? <Delta metric="efficiency" previous={priorEffDisp} current={avgEffDisp} display="percent" comparedTo={priorLabel} /> : undefined },
    { metricId: 'energy', occurrenceId: 'measured-energy',
      rawValue: available && currentStats.energyMeasuredCount > 0 ? currentStats.totalEnergyWh : null,
      label: t('drives.energyAndCost', 'Measured energy / cost'),
      display: { formatter: raw => ({ value: `${formatEnergy(raw)} · ${formatEnergyCost(raw / 1000)}`, unit: '' }) },
      context: t('drives.brief.measuredEnergyScope', '{{measured}} of {{total}} returned drives supply energy; cost uses the configured rate, not invoices.', {
        measured: currentStats.energyMeasuredCount, total: currentStats.count,
      }),
      comparisonContent: priorHasData && priorTotalCost != null && currentStats.energyMeasuredCount > 0
        ? <Delta metric="cost" previous={priorTotalCost} current={totalCost} display="percent" comparedTo={priorLabel} /> : undefined },
  ];
  return <FadeIn>
    <GlassPanel id="drives-overview" className="p-4 sm:p-5">
      <NestedDrivingBrief metrics={metrics} title={t('drives.overview', 'Overview')}
        testId="drives-overview" description={scope}
        preferences={{ units: unitPrefs, currency: { kind: 'symbol', value: '' } }}
        loading={isDrivesLoading} retained={drivesState.refreshError != null}
        unavailable={drivesState.fatalError != null}
        period={{ kind: 'unknown', label: periodLabel,
          reason: `${scope}${priorLabel ? ` · ${priorLabel}` : ''}` }} />
      {drivesState.fatalError ? <QueryError error={drivesState.fatalError} onRetry={() => { void refetchDrives(); }} /> : null}
      {available && currentStats.count === 0 ? <EmptyState
        /* no-action: the header owns the selected window. */
        message={t('drives.noStatsRange', 'No drives in this range')} /> : null}
    </GlassPanel>
  </FadeIn>;
}
