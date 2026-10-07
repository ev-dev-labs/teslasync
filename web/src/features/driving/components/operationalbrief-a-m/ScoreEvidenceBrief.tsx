import type { ComponentProps } from 'react';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { ScoreKpiSection } from '../score-orchestrator/ScoreKpiSection';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof ScoreKpiSection> & { retained?: boolean };

export function ScoreEvidenceBrief({ model, retained = false }: Props) {
  const { t, drivesIsError, drivesError, refetch, drivesLoading, hasDrives, avgScores,
    trendLabel, allScores, hasDrivePayload, scoredDrives, fmtNumber, efficiencyDisplay, avgWhPerKm, efficiencyUnit } = model;
  const metrics: readonly StatMetric[] = [
    { metricId: 'score', occurrenceId: 'average', rawValue: hasDrives ? avgScores.total : null,
      label: t('driveScore.avgScore', 'Avg Score'),
      description: t('driveScore.brief.average', 'Average computed score for the returned scored-drive cohort, on a 0–100 scale.'),
      context: hasDrives ? trendLabel : undefined, display: { precision: 0 } },
    { metricId: 'score', occurrenceId: 'best', rawValue: allScores.length > 0 ? Math.max(...allScores.map(score => score.total)) : null,
      label: t('driveScore.bestScore', 'Best Score'),
      description: t('driveScore.brief.best', 'Highest computed score among the returned scored drives, on a 0–100 scale.'),
      display: { precision: 0 } },
    { metricId: 'count', occurrenceId: 'drives', rawValue: hasDrivePayload ? scoredDrives.length : null,
      label: t('driveScore.totalDrivesLabel', 'Total Drives'),
      description: t('driveScore.brief.count', 'Returned scored drives, not the independent server score total.') },
    { metricId: 'efficiency', occurrenceId: 'efficiency', rawValue: hasDrives ? avgWhPerKm / 1000 : null,
      label: t('driveScore.avgEffLabel', 'Avg Efficiency'),
      description: t('driveScore.brief.efficiency', 'Average consumption in the returned scored-drive cohort.'),
      display: { formatter: (raw) => ({ value: fmtNumber(efficiencyDisplay(raw * 1000)), unit: efficiencyUnit }) } },
  ];
  return <section>
    <DrivingSummaryBrief metrics={metrics} title={t('driveScore.kpis', 'Key metrics')}
      description={t('driveScore.brief.description', 'Computed driving scores and consumption retain their source cohort; the overall score gauge uses its independent assessment source.')}
      scope={t('driveScore.brief.scope', 'Returned scored-drive subset in the selected period; independent score-assessment coverage may differ')}
      provenance={t('driveScore.brief.source', 'Computed scored-drive cohort; the retained trend label comes from the independent score assessment.')}
      loading={drivesLoading} error={drivesIsError ? drivesError : null}
      statusLabel={!hasDrivePayload && !drivesLoading && !drivesIsError ? t('driving.brief.awaiting', 'Awaiting evidence') : undefined}
      retained={retained}
      onRetry={() => void refetch()} />
  </section>;
}
