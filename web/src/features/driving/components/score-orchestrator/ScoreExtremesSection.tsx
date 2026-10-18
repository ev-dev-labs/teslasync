import { GlassPanel, PanelTitle, Caption } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Icons } from '@/lib/icons';
import { ScoreExtremeDrive } from '../continuation-driving-primary/ScoreExtremeDrive';
import { ScorePeriodStatisticsPanel } from './ScorePeriodStatisticsPanel';
import { gradeVariant, localScoreExplanation, localScoreInsight } from './scoreDomain';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScoreExtremesSectionProps = ScoreSectionProps<
  't' | 'bestDrive' | 'worstDrive' | 'formatDistance' | 'formatEfficiency'
  | 'noDrivesMsg' | 'efficiencyReading' | 'smoothnessReading' | 'speedReading'
  | 'overallReading' | 'completeDistance' | 'filteredDrives' | 'completeDuration'
  | 'measuredMaxSpeeds' | 'formatSpeed' | 'fmtInt' | 'allScores'
  | 'refetch' | 'hasDrivePayload' | 'drivesSource' | 'drivesLoading'
>;

export function ScoreExtremesSection({ model, driveState, scoreState }: ScoreExtremesSectionProps) {
  const {
    t, bestDrive, worstDrive, formatDistance, formatEfficiency,
    noDrivesMsg, efficiencyReading, smoothnessReading, speedReading, overallReading,
  } = model;

  return (
    <FadeIn delay={0.25}>
      <section
        aria-label={t('driveScore.bestWorst', 'Best and worst drives')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 3xl:grid-cols-4"
      >
        {/* Best drive */}
        <ScoreExtremeDrive
          kind="best"
          entry={bestDrive}
          badgeVariant={bestDrive ? gradeVariant(bestDrive.score.grade) : 'neutral'}
          formatDistance={formatDistance}
          formatEfficiency={formatEfficiency}
          insight={localScoreInsight(t, 'best', bestDrive?.score)}
          sourceFallback={driveState(
            200,
            t('driveScore.noDrives', 'No drives available'),
            <Icons.star className="h-8 w-8" aria-hidden="true" />,
          )}
        />

        {/* Worst drive */}
        <ScoreExtremeDrive
          kind="worst"
          entry={worstDrive}
          badgeVariant={worstDrive ? gradeVariant(worstDrive.score.grade) : 'neutral'}
          formatDistance={formatDistance}
          formatEfficiency={formatEfficiency}
          insight={localScoreInsight(t, 'worst', worstDrive?.score)}
          sourceFallback={driveState(
            200,
            t('driveScore.noDrives', 'No drives available'),
            <Icons.severityWarn className="h-8 w-8" aria-hidden="true" />,
          )}
        />

        {/* Score breakdown */}
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('driveScore.breakdown', "Score breakdown")}</PanelTitle>
          {scoreState(
            200,
            noDrivesMsg,
            <Icons.target className="h-8 w-8" aria-hidden="true" />,
          ) ?? (
            <KVList
              layout="responsive"
              items={[
                {
                  id: 'efficiency',
                  label: t('driveScore.efficiencyLabel', 'Efficiency (Wh/km)'),
                  value: efficiencyReading != null ? `${efficiencyReading}/40` : '—',
                },
                {
                  id: 'smoothness',
                  label: t('driveScore.smoothness', 'Smoothness'),
                  value: smoothnessReading != null ? `${smoothnessReading}/30` : '—',
                },
                {
                  id: 'speed',
                  label: t('driveScore.speedLabel', "Speed discipline"),
                  value: speedReading != null ? `${speedReading}/30` : '—',
                },
                {
                  id: 'total',
                  label: t('driveScore.totalLabel', 'Total'),
                  value: overallReading != null ? `${overallReading}/100` : '—',
                },
              ]}
            />
          )}
          <Caption className="mt-3">{localScoreExplanation(t)}</Caption>
        </GlassPanel>

        {/* Period statistics */}
        <ScorePeriodStatisticsPanel model={model} driveState={driveState} scoreState={scoreState} />
      </section>
    </FadeIn>
  );
}
