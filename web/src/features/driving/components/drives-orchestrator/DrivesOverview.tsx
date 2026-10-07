import { GlassPanel, PanelTitle } from '@/components/ui';
import { KpiOverviewCard, MetricCard } from '@/components/data-display';
import { QueryError, Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { formatDurationMinutes } from '@/lib/dateFormat';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

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
  return (
    <FadeIn>
      {drivesState.fatalError ? (
        <GlassPanel id="drives-overview" className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('drives.overview', 'Overview')}</PanelTitle>
          <QueryError error={drivesState.fatalError} onRetry={() => { void refetchDrives(); }} />
        </GlassPanel>
      ) : isDrivesLoading ? (
        <GlassPanel id="drives-overview" className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('drives.overview', 'Overview')}</PanelTitle>
          <Skeleton className="h-32" />
        </GlassPanel>
      ) : currentStats.count > 0 ? (
        <KpiOverviewCard
          id="drives-overview"
          testId="drives-overview"
          compact
          gridClassName="grid-cols-2 lg:grid-cols-3"
          header={{
            title: t('drives.overview', 'Overview'),
            currentLabel: periodLabel,
            comparisonLabel: priorLabel,
          }}
          kpis={
            <>
              <MetricCard
                compact
                label={t('drives.totalDrives', 'Drives')}
                value={fmtCompact(currentStats.count)}
                color="cyan"
                delta={priorHasData ? {
                  metric: 'trip_count',
                  previous: priorStats!.count,
                  current: currentStats.count,
                  display: 'percent',
                } : undefined}
              />
              <MetricCard
                compact
                label={`${t('drives.distance', 'Distance')} (${distanceUnit})`}
                value={fmtCompact(distMi, 10000)}
                color="green"
                delta={priorHasData ? {
                  metric: 'distance',
                  previous: priorDistMi,
                  current: distMi,
                  display: 'percent',
                } : undefined}
              />
              <MetricCard
                compact
                label={t('drives.driveTime', 'Drive time')}
                value={formatDurationMinutes(driveTimeMin)}
                color="blue"
                delta={priorHasData ? {
                  metric: { direction: 'neutral' },
                  previous: priorDriveTimeMin,
                  current: driveTimeMin,
                  display: 'percent',
                } : undefined}
              />
              <MetricCard
                compact
                label={t('drives.avgGrade', 'Efficiency grade')}
                value={avgGrade.label}
                color="purple"
              />
              <MetricCard
                compact
                label={`${t('drives.efficiency', 'Energy intensity')} (${efficiencyUnit})`}
                value={avgEffDisp != null ? fmtInt(avgEffDisp) : '—'}
                color="amber"
                delta={priorHasData && avgEffDisp != null && priorEffDisp != null ? {
                  metric: 'efficiency',
                  previous: priorEffDisp,
                  current: avgEffDisp,
                  display: 'percent',
                } : undefined}
              />
              <MetricCard
                compact
                label={t('drives.energyAndCost', 'Measured energy / cost')}
                value={currentStats.energyMeasuredCount > 0
                  ? `${formatEnergy(currentStats.totalEnergyWh)} · ${formatEnergyCost(currentStats.totalEnergyWh / 1_000)}`
                  : '—'}
                color="red"
                delta={priorHasData && priorTotalCost != null && currentStats.energyMeasuredCount > 0 ? {
                  metric: 'cost',
                  previous: priorTotalCost,
                  current: totalCost,
                  display: 'percent',
                } : undefined}
              />
            </>
          }
        />
      ) : (
        <GlassPanel id="drives-overview" className="p-6">
          <PanelTitle className="mb-3">{t('drives.overview', 'Overview')}</PanelTitle>
          <EmptyState
            /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t('drives.noStatsRange', 'No drives in this range')}
          />
        </GlassPanel>
      )}
    </FadeIn>
  );
}
