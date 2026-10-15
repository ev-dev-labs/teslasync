import { FadeIn } from '@/components/motion';
import { Icons } from '@/lib/icons';
import { ScorePeriodAverages } from '../continuation-driving-primary/ScorePeriodAverages';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScorePeriodAveragesSectionProps = ScoreSectionProps<'t' | 'periodStats'>;

export function ScorePeriodAveragesSection({ model, driveState }: ScorePeriodAveragesSectionProps) {
  const { t, periodStats } = model;

  return (
    <FadeIn delay={0.35}>
      <section
        aria-label={t('driveScore.periodAverages', 'Period averages')}
        className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <ScorePeriodAverages stats={periodStats} sourceFallback={driveState(
          120,
          t('driveScore.noPeriodStats', 'No weekly/monthly averages available yet'),
          <Icons.target className="h-8 w-8" aria-hidden="true" />,
        )} />
      </section>
    </FadeIn>
  );
}
