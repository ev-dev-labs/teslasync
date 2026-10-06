import { FadeIn } from '@/components/motion';
import { Icons } from '@/lib/icons';
import { ScoreAchievements } from '../continuation-driving-primary/ScoreAchievements';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScoreAchievementsSectionProps = ScoreSectionProps<'t' | 'unlockedAchievements'>;

export function ScoreAchievementsSection({ model, driveState }: ScoreAchievementsSectionProps) {
  const { t, unlockedAchievements } = model;

  return (
    <FadeIn delay={0.4}>
      <section aria-label={t('driveScore.achievements.title', 'Achievements')}>
        <ScoreAchievements items={unlockedAchievements} sourceFallback={driveState(
          200,
          t('driveScore.noAchievements', 'Achievements unlock as you complete scored drives'),
          <Icons.trophy className="h-8 w-8" aria-hidden="true" />,
        )} />
      </section>
    </FadeIn>
  );
}
