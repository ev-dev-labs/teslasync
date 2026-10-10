import type { ReactNode } from 'react';
import { PageLayout, SourceContent } from '@/components/layout';
import { Button } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { useDriveScorePage } from '../hooks/useDriveScorePage';
import { ScoreSourceNotices } from '../components/score-orchestrator/ScoreSourceNotices';
import { ScoreEvidenceBrief } from '../components/operationalbrief-a-m/ScoreEvidenceBrief';
import { ScoreHeroSection } from '../components/score-orchestrator/ScoreHeroSection';
import { ScoreCategoriesSection } from '../components/score-orchestrator/ScoreCategoriesSection';
import { ScoreChartsSection } from '../components/score-orchestrator/ScoreChartsSection';
import { ScoreDistributionTipsSection } from '../components/score-orchestrator/ScoreDistributionTipsSection';
import { ScoreExtremesSection } from '../components/score-orchestrator/ScoreExtremesSection';
import { ScoreHistorySection } from '../components/score-orchestrator/ScoreHistorySection';
import { ScorePeriodAveragesSection } from '../components/score-orchestrator/ScorePeriodAveragesSection';
import { ScoreAchievementsSection } from '../components/score-orchestrator/ScoreAchievementsSection';

export {
  scoreDrive, gradeFromScore, gradeVariant, gradeColor,
} from '../components/score-orchestrator/scoreDomain';
export type {
  ComputedScore, ScoredDrive, HistoryRow,
} from '../components/score-orchestrator/scoreDomain';
export { buildTips } from '../components/score-orchestrator/scoreTips';
export { buildAchievements } from '../components/score-orchestrator/scoreAchievements';
export { computePeriodStats } from '../components/score-orchestrator/scorePeriodStats';
export type { PeriodStats } from '../components/score-orchestrator/scorePeriodStats';

export default function DriveScorePage() {
  const model = useDriveScorePage();
  const {
    t, hasData, hasDrives, drivesLoading, vehicleIdStr,
    apiScoreState, drivesError, scoreQuery, refetch, drivesQuery,
  } = model;

  /* ---- per-section state fallback (loading / error / empty) ---- */
  const buildState =
    (isEmpty: boolean, combinedScore = false) =>
    (height: number, emptyMsg: string, emptyIcon?: ReactNode): ReactNode | null => {
      // Server score and locally scored history are independent evidence.
      if (combinedScore && hasData) return null;
      const loading = drivesLoading || (vehicleIdStr != null && combinedScore
        && apiScoreState.status === 'initial');
      const fatalError = drivesError ?? (combinedScore ? apiScoreState.fatalError : null);
      if (!loading && !fatalError && !isEmpty) return null;
      return (
        <SourceContent
          state={loading ? 'loading' : fatalError ? 'error' : 'empty'}
          label={t('driveScore.resource', 'drive')}
          emptyMessage={emptyMsg}
          errorMessage={t('driveScore.sourceError', 'Drive score evidence could not be loaded')}
          error={fatalError}
          errorRecovery={{
            onRetry: () => { void (combinedScore && !drivesError ? scoreQuery.refetch() : refetch()); },
            resourceName: t('driveScore.resource', 'drive'),
          }}
          loadingContent={<Skeleton height={height} />}
          emptyContent={<EmptyState
            /* no-action: transient empty state — surfaces when no scored drives
               exist in the selected period; recovery is picking a wider range. */
            icon={emptyIcon}
            message={emptyMsg}
          />}
        >
          {null}
        </SourceContent>
      );
    };
  const driveState = buildState(!hasDrives);
  const scoreState = buildState(!hasData, true);
  const sectionProps = { model, driveState, scoreState };

  /* ---- header actions ---- */
  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <Button
        variant="ghost"
        onClick={() => refetch()}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <Icons.refresh className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageLayout
      title={t('driveScore.title', 'Drive Score')}
      subtitle={t('driveScore.subtitle', 'Your driving rating and breakdown')}
      secondaryActions={actions}
      query={[drivesQuery, scoreQuery]}
    >
      <ScoreSourceNotices model={model} />
      {/* ── Band A — KPI summary ─────────────────────────────────── */}
      <ScoreEvidenceBrief model={model}
        retained={model.drivesSource.status === 'stale' || model.drivesSource.refreshError != null} />
      {/* ── Band B — Hero: overall score + grade ─────────────────── */}
      <ScoreHeroSection {...sectionProps} />
      {/* ── Band C — Category gauges ─────────────────────────────── */}
      <ScoreCategoriesSection {...sectionProps} />
      {/* ── Band D — Trend (hero) + Category bar (side) ──────────── */}
      <ScoreChartsSection {...sectionProps} />
      {/* ── Band E — Histogram (hero) + Tips (side) ──────────────── */}
      <ScoreDistributionTipsSection {...sectionProps} />
      {/* ── Band F — Best / Worst drives + detail lists ──────────── */}
      <ScoreExtremesSection {...sectionProps} />
      {/* ── Band G — Drive history table (full-width) ────────────── */}
      <ScoreHistorySection {...sectionProps} />
      {/* ── Band H — Weekly / monthly averages ───────────────────── */}
      <ScorePeriodAveragesSection {...sectionProps} />
      {/* ── Band I — Achievements ────────────────────────────────── */}
      <ScoreAchievementsSection {...sectionProps} />
    </PageLayout>
  );
}
