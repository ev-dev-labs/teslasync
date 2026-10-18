import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageLayout, SourceContent } from '@/components/layout';
import { Button, Icon } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
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
    t, hasData, hasDrives, drivesLoading, scoreLoading, drivesPaused, scorePaused, vehicleIdStr,
    apiScoreState, drivesError, scoreQuery, refetch, drivesQuery, resetRange,
  } = model;
  const historyPausedMessage = t('driveScore.historyPaused', 'Drive history loading is deferred.');
  const serverPausedMessage = t('driveScore.serverPaused', 'Server drive score loading is deferred.');
  const pausedRecovery = t(
    'driveScore.pausedRecovery',
    'Retry this source now, or wait for the request to resume. No result has been received yet.',
  );

  /* ---- per-section state fallback (loading / error / empty) ---- */
  const buildState =
    (isEmpty: boolean, combinedScore = false) =>
    (height: number, emptyMsg: string, emptyIcon?: ReactNode): ReactNode | null => {
      // Server score and locally scored history are independent evidence.
      if (combinedScore && hasData) return null;
      const paused = drivesPaused || (combinedScore && scorePaused);
      const loading = !paused && (drivesLoading || (combinedScore && scoreLoading));
      const fatalError = drivesError ?? (combinedScore ? apiScoreState.fatalError : null);
      if (!paused && !loading && !fatalError && !isEmpty) return null;
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
            /* Recovery is source-local above for deferred requests, or a wider
               header range for successfully loaded empty evidence. */
            icon={emptyIcon}
            message={paused ? (drivesPaused ? historyPausedMessage : serverPausedMessage) : emptyMsg}
            action={{
              label: t(paused ? 'common.retry' : 'common.clearFilters', paused ? 'Retry' : 'Clear filters'),
              onClick: () => {
                if (paused) void (combinedScore && !drivesPaused ? scoreQuery.refetch() : refetch());
                else resetRange();
              },
            }}
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
        className="h-11 w-11 p-0 md:h-10 md:w-10"
        disabled={vehicleIdStr == null}
        onClick={() => {
          if (vehicleIdStr == null) return;
          void refetch();
          void scoreQuery.refetch();
        }}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <Icon icon={RefreshCw} />
      </Button>
    </div>
  );

  return (
    <PageLayout
      title={t('driveScore.title', "Drive score")}
      subtitle={t('driveScore.subtitle', 'Your driving rating and breakdown')}
      secondaryActions={actions}
      query={[drivesQuery, scoreQuery]}
    >
      <ScoreSourceNotices model={model} />
      {[
        { source: 'history', paused: drivesPaused, label: historyPausedMessage, retry: refetch },
        { source: 'server', paused: scorePaused, label: serverPausedMessage, retry: scoreQuery.refetch },
      ].map(({ source, paused, label, retry }) => paused && (
        <EmptyState
          key={source}
          message={label}
          description={pausedRecovery}
          action={{ label: t('common.retry', 'Retry'), onClick: () => { void retry(); } }}
        />
      ))}
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
