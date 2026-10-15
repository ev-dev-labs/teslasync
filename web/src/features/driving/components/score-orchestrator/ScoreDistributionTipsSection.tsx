import { LayoutCard } from '@/components/layout';
import { GlassPanel, PanelTitle, Caption, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { Icons } from '@/lib/icons';
import { ScoreDistributionChart } from '../continuation-driving-primary/ScoreDistributionChart';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScoreDistributionTipsSectionProps = ScoreSectionProps<
  't' | 'hasDrives' | 'drivesLoading' | 'drivesIsError' | 'histogramData'
  | 'hasCategoryReadings' | 'weakestCategoryLabel' | 'relevantTips'
>;

export function ScoreDistributionTipsSection({
  model, driveState, scoreState,
}: ScoreDistributionTipsSectionProps) {
  const {
    t, hasDrives, drivesLoading, drivesIsError, histogramData,
    hasCategoryReadings, weakestCategoryLabel, relevantTips,
  } = model;

  return (
    <FadeIn delay={0.2}>
      <section
        aria-label={t('driveScore.scoreDistribution', 'Score Distribution')}
        className="grid grid-cols-1 gap-4 xl:grid-cols-3"
      >
        <div className="min-w-0 xl:col-span-2">
          {hasDrives && !drivesLoading && !drivesIsError ? (
            <ScoreDistributionChart data={histogramData} />
          ) : <LayoutCard title={t('driveScore.scoreDistribution', 'Score Distribution')}>{driveState(
            220,
            t('driveScore.noDistribution', 'No scored drives to chart yet'),
            <Icons.target className="h-8 w-8" aria-hidden="true" />,
          )}</LayoutCard>}
        </div>

        <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
          <PanelTitle className="mb-1">{t('driveScore.tipsTitle', 'Improvement Tips')}</PanelTitle>
          {hasCategoryReadings && <Caption className="mb-3 block">
            {t('driveScore.tipsSubtitle', 'Based on your weakest category: {{category}}', {
              category: weakestCategoryLabel,
            })}
          </Caption>}
          {scoreState(
            220,
            t('driveScore.noTips', 'Tips appear once drives are scored'),
            <Icons.lightbulb className="h-8 w-8" aria-hidden="true" />,
          ) ?? (hasCategoryReadings ? (
            <ul className="space-y-3">
              {relevantTips.map((tip, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-3 rounded-lg bg-[var(--surface-2)] p-3"
                >
                  <Icons.lightbulb
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-300"
                    aria-hidden="true"
                  />
                  <Text variant="body">{tip.key}</Text>
                </li>
              ))}
            </ul>
          ) : <EmptyState /* no-action: tips derive from reported category scores, not a separately retryable source */
            message={t('driveScore.noTips', 'Tips appear once drives are scored')} />)}
        </GlassPanel>
      </section>
    </FadeIn>
  );
}
