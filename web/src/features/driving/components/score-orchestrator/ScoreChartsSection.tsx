import { LayoutCard } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Icons } from '@/lib/icons';
import { ScoreTrendChart } from '../continuation-driving-primary/ScoreTrendChart';
import { ScoreCategoryChart } from '../continuation-driving-primary/ScoreCategoryChart';
import { CATEGORY_COLORS, gradeColor } from './scoreDomain';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScoreChartsSectionProps = ScoreSectionProps<
  't' | 'hasDrives' | 'drivesLoading' | 'drivesIsError' | 'trendChartData'
  | 'vehicleId' | 'overallGrade' | 'hasData' | 'categoryBarData' | 'noDrivesMsg'
>;

export function ScoreChartsSection({ model, driveState, scoreState }: ScoreChartsSectionProps) {
  const {
    t, hasDrives, drivesLoading, drivesIsError, trendChartData,
    vehicleId, overallGrade, hasData, categoryBarData, noDrivesMsg,
  } = model;

  return (
    <FadeIn delay={0.15}>
      <section
        aria-label={t('driveScore.scoreTrend', 'Score Trend')}
        className="grid grid-cols-1 gap-4 xl:grid-cols-3"
      >
        <div className="min-w-0 xl:col-span-2">
          {hasDrives && !drivesLoading && !drivesIsError ? (
            <ScoreTrendChart data={trendChartData} vehicleId={vehicleId}
              scoreColor={gradeColor(overallGrade)} colors={CATEGORY_COLORS} />
          ) : <LayoutCard title={t('driveScore.scoreTrend', 'Score Trend')}>{driveState(
            300,
            t('driveScore.noTrend', 'No scored drives to chart yet'),
            <Icons.trendUp className="h-8 w-8" aria-hidden="true" />,
          )}</LayoutCard>}
        </div>

        <div className="min-w-0 xl:col-span-1">
          {hasData ? <ScoreCategoryChart data={categoryBarData} /> : (
            <LayoutCard title={t('driveScore.categoryBreakdown', 'Category Breakdown')}>{scoreState(
            260,
            noDrivesMsg,
            <Icons.efficiency className="h-8 w-8" aria-hidden="true" />,
          )}</LayoutCard>)}
        </div>
      </section>
    </FadeIn>
  );
}
