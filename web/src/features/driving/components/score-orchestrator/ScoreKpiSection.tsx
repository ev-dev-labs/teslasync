import { GlassPanel } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Icons } from '@/lib/icons';
import type { DriveScorePageModel } from '../../hooks/useDriveScorePage';

interface ScoreKpiSectionProps {
  model: Pick<DriveScorePageModel,
    't' | 'drivesIsError' | 'drivesError' | 'refetch' | 'drivesLoading'
    | 'hasDrives' | 'avgScores' | 'overallTrend' | 'trendLabel' | 'allScores'
    | 'hasDrivePayload' | 'scoredDrives' | 'fmtNumber' | 'efficiencyDisplay'
    | 'avgWhPerKm' | 'efficiencyUnit'>;
}

export function ScoreKpiSection({ model }: ScoreKpiSectionProps) {
  const {
    t, drivesIsError, drivesError, refetch, drivesLoading, hasDrives,
    avgScores, overallTrend, trendLabel, allScores, hasDrivePayload,
    scoredDrives, fmtNumber, efficiencyDisplay, avgWhPerKm, efficiencyUnit,
  } = model;

  return (
    <FadeIn>
      <section aria-label={t('driveScore.kpis', 'Key metrics')}>
        {drivesIsError ? (
          <GlassPanel className="p-4 sm:p-5">
            <QueryError
              error={drivesError}
              onRetry={() => refetch()}
              resourceName={t('driveScore.resource', 'drive')}
            />
          </GlassPanel>
        ) : null}
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            loading={drivesLoading}
            label={t('driveScore.avgScore', 'Avg Score')}
            value={hasDrives ? avgScores.total : '—'}
            unit="/100"
            icon={<Icons.target className="h-5 w-5" aria-hidden="true" />}
            trend={hasDrives ? {
              direction: overallTrend,
              value: trendLabel,
              positive: overallTrend === 'up',
            } : undefined}
          />
          <StatCard
            loading={drivesLoading}
            label={t('driveScore.bestScore', 'Best Score')}
            value={allScores.length > 0 ? Math.max(...allScores.map((s) => s.total)) : '—'}
            unit="/100"
            icon={<Icons.trophy className="h-5 w-5 text-amber-300" aria-hidden="true" />}
          />
          <StatCard
            loading={drivesLoading}
            label={t('driveScore.totalDrivesLabel', 'Total Drives')}
            value={hasDrivePayload ? scoredDrives.length : '—'}
            icon={<Icons.drive className="h-5 w-5" aria-hidden="true" />}
          />
          <StatCard
            loading={drivesLoading}
            label={t('driveScore.avgEffLabel', 'Avg Efficiency')}
            value={hasDrives ? fmtNumber(efficiencyDisplay(avgWhPerKm)) : '—'}
            unit={efficiencyUnit}
            icon={<Icons.charging className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
          />
        </div>
      </section>
    </FadeIn>
  );
}
