import { FadeIn } from '@/components/motion';
import { Icons } from '@/lib/icons';
import { ScoreCategoryCard } from '../continuation-driving-primary/ScoreCategoryCard';
import { CATEGORY_COLORS } from './scoreDomain';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScoreCategoriesSectionProps = ScoreSectionProps<
  't' | 'efficiencyReading' | 'smoothnessReading' | 'speedReading'
  | 'hasDrives' | 'formatEfficiency' | 'avgWhPerKm' | 'noDrivesMsg'
  | 'formatPower' | 'avgPowerW' | 'formatSpeed' | 'avgMaxSpeedMps'
>;

export function ScoreCategoriesSection({ model, scoreState }: ScoreCategoriesSectionProps) {
  const {
    t, efficiencyReading, smoothnessReading, speedReading,
    hasDrives, formatEfficiency, avgWhPerKm, noDrivesMsg,
    formatPower, avgPowerW, formatSpeed, avgMaxSpeedMps,
  } = model;

  return (
    <FadeIn delay={0.1}>
      <section
        aria-label={t('driveScore.categoryBreakdown', 'Category Breakdown')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <ScoreCategoryCard
          title={t('driveScore.efficiency', 'Efficiency')}
          value={efficiencyReading}
          max={40}
          color={CATEGORY_COLORS.efficiency}
          icon={<Icons.charging className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
          metricLabel={t('driveScore.avgConsumption', 'Avg consumption')}
          metricValue={hasDrives ? formatEfficiency(avgWhPerKm) : '—'}
          sourceFallback={scoreState(260, noDrivesMsg)}
        />
        <ScoreCategoryCard
          title={t('driveScore.smoothness', 'Smoothness')}
          value={smoothnessReading}
          max={30}
          color={CATEGORY_COLORS.smoothness}
          icon={<Icons.efficiency className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
          metricLabel={t('driveScore.powerRange', 'Power range')}
          metricValue={hasDrives ? formatPower(avgPowerW) : '—'}
          sourceFallback={scoreState(260, noDrivesMsg)}
        />
        <ScoreCategoryCard
          title={t('driveScore.speedDiscipline', 'Speed Discipline')}
          value={speedReading}
          max={30}
          color={CATEGORY_COLORS.speed}
          icon={<Icons.speed className="h-4 w-4 text-purple-300" aria-hidden="true" />}
          metricLabel={t('driveScore.avgMaxSpeed', 'Avg max speed')}
          metricValue={hasDrives ? formatSpeed(avgMaxSpeedMps) : '—'}
          sourceFallback={scoreState(260, noDrivesMsg)}
        />
      </section>
    </FadeIn>
  );
}
