import { GlassPanel, PanelTitle, Text, Caption, HelpTooltip, Badge } from '@/components/ui';
import { LinearGauge } from '@/components/charts';
import { AnimatedNumber } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { knownNumber } from '@/api/dataState';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { Icons } from '@/lib/icons';
import { gradeColor, gradeVariant } from './scoreDomain';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScoreHeroSectionProps = ScoreSectionProps<
  't' | 'noDrivesMsg' | 'overallReading' | 'overallGrade' | 'trendColor'
  | 'TrendIcon' | 'trendLabel' | 'apiScore' | 'hasDrivePayload' | 'scoredDrives'
>;

export function ScoreHeroSection({ model, scoreState }: ScoreHeroSectionProps) {
  const {
    t, noDrivesMsg, overallReading, overallGrade, trendColor,
    TrendIcon, trendLabel, apiScore, hasDrivePayload, scoredDrives,
  } = model;

  return (
    <FadeIn delay={0.05}>
      <section
        aria-label={t('driveScore.overall', 'Overall Score')}
        className="grid grid-cols-1 gap-4 xl:grid-cols-3"
      >
        <GlassPanel className="flex flex-col p-4 sm:p-5 xl:col-span-2">
          <PanelTitle className="mb-3">{t('driveScore.overall', 'Overall Score')}</PanelTitle>
          {scoreState(240, noDrivesMsg, <Icons.speed className="h-8 w-8" aria-hidden="true" />) ?? (
            <div className="flex flex-1 flex-col items-center justify-center py-4">
              <LinearGauge
                value={overallReading}
                max={100}
                label={t('driveScore.overall', 'Overall Score')}
                color={gradeColor(overallGrade)}
                size={200}
              />
              <div className="mt-4 flex items-baseline justify-center gap-1">
                <Text as="span" size="3xl" weight="bold" color="primary" className="tabular-nums">
                  {overallReading != null ? <AnimatedNumber value={overallReading} /> : '—'}
                </Text>
                <Text variant="body" className={typography.color.secondary}>
                  /100
                </Text>
                <HelpTooltip
                  className="ms-1.5"
                  size="sm"
                  i18nKey="help.driveScore.body"
                  defaultValue="0–100 score derived from smoothness of acceleration, braking, and cornering combined with energy efficiency. Tunable in Settings → Driving."
                  ariaLabel={t('help.driveScore.iconLabel', {
                    defaultValue: 'More info about Drive Score',
                  })}
                />
              </div>
              <div className={cn('mt-2 flex items-center gap-2', trendColor)}>
                <TrendIcon className="h-4 w-4" aria-hidden="true" />
                <Text variant="body" className={typography.weight.medium}>
                  {trendLabel}
                </Text>
              </div>
              {apiScore && (
                <Caption className="mt-1">
                  {t('driveScore.basedOn', 'Based on {{displayCount}} drives', {
                    count: knownNumber(apiScore.totalDrives) ?? undefined,
                    displayCount: knownNumber(apiScore.totalDrives) ?? '—',
                  })}
                </Caption>
              )}
            </div>
          )}
        </GlassPanel>

        <GlassPanel className="flex flex-col p-4 sm:p-5 xl:col-span-1">
          <PanelTitle className="mb-3">{t('driveScore.gradeTitle', 'Grade')}</PanelTitle>
          {scoreState(240, noDrivesMsg, <Icons.award className="h-8 w-8" aria-hidden="true" />) ?? (
            <div className="flex flex-1 flex-col justify-center gap-4">
              <div className="flex items-center gap-4">
                <Badge variant={gradeVariant(overallGrade)} size="lg">
                  {overallGrade}
                </Badge>
                <div>
                  <Text as="div" variant="body" className={typography.weight.semibold}>
                    {t('driveScore.gradeLabel', 'Grade: {{grade}}', {
                      grade: overallGrade,
                    })}
                  </Text>
                  <div className={cn('flex items-center gap-1', trendColor)}>
                    <TrendIcon className="h-3 w-3" aria-hidden="true" />
                    <Caption className={trendColor}>{trendLabel}</Caption>
                  </div>
                </div>
              </div>
              <Caption>
                {t('driveScore.drivesInPeriod', '{{displayCount}} drives in period', {
                  count: hasDrivePayload ? scoredDrives.length : undefined,
                  displayCount: hasDrivePayload ? scoredDrives.length : '—',
                })}
              </Caption>
            </div>
          )}
        </GlassPanel>
      </section>
    </FadeIn>
  );
}
