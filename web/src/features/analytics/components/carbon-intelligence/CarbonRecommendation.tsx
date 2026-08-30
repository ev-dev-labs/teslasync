import { Clock3, History, Sparkles, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

export function CarbonRecommendation({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const recommendation = analysis.recommendation;
  const windowLabel = t(
    'carbon.recommendation.windowValue',
    '{{start}} – {{end}}',
    {
      start: display.formatHour(recommendation.windowStartHour),
      end: display.formatHour(recommendation.windowEndHour),
    },
  );

  return (
    <section
      data-testid="carbon-recommendation"
      aria-label={t(
        'carbon.recommendation.aria',
        'Full-history greenest-window recommendation scenario',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Sparkles
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t(
            'carbon.recommendation.title',
            'Full-history greenest-window scenario',
          )}
        </PanelTitle>
        <CarbonSectionBody state={states.recommendation}>
          {recommendation.availability === 'empty' ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              message={t(
                'carbon.recommendation.empty',
                'No lifetime charging energy supports a green-window scenario.',
              )}
            />
          ) : (
            <>
              <Grid cols={{ default: 1, sm: 2, xl: 4 }} gap={3}>
                <MetricCard
                  label={t('carbon.recommendation.window', 'Greenest 3-hour window')}
                  value={windowLabel}
                  subtitle={t(
                    'carbon.recommendation.windowHint',
                    'Start inclusive; end exclusive; wraps at midnight',
                  )}
                  icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
                  color="green"
                />
                <MetricCard
                  label={t('carbon.recommendation.current', 'Observed lifetime average')}
                  value={display.formatIntensity(
                    recommendation.currentAvgIntensityGPerKwh,
                  )}
                  subtitle={t(
                    'carbon.recommendation.currentHint',
                    'Energy-weighted full-history intensity',
                  )}
                  icon={<History className="h-5 w-5" aria-hidden="true" />}
                  color="amber"
                />
                <MetricCard
                  label={t('carbon.recommendation.windowAverage', 'Window average')}
                  value={display.formatIntensity(
                    recommendation.windowAvgIntensityGPerKwh,
                  )}
                  subtitle={t(
                    'carbon.recommendation.modelHint',
                    'Mean of three static model rows',
                  )}
                  icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
                  color="green"
                />
                <MetricCard
                  label={t('carbon.recommendation.reportedSaving', 'Reported potential saving')}
                  value={display.formatKg(
                    recommendation.reportedPotentialSavingKg,
                  )}
                  subtitle={t(
                    'carbon.recommendation.reportedPct',
                    '{{percentage}} of modeled charging CO₂',
                    {
                      percentage: display.formatPercent(
                        recommendation.reportedPotentialSavingPct,
                      ),
                    },
                  )}
                  icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
                  color="green"
                />
              </Grid>
              {recommendation.availability === 'invalid' ? (
                <AlertBanner className="mt-4" variant="warning">
                  {t(
                    'carbon.recommendation.invalid',
                    'Recommendation fields failed runtime or three-hour-window validation; unknown values remain withheld.',
                  )}
                </AlertBanner>
              ) : null}
            </>
          )}
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'carbon.recommendation.scope',
                'Lifetime scope: the backend estimates moving all observed full-history charging energy into this fixed window. The selected date range does not constrain this scenario.',
              )}
            </Text>
          </AlertBanner>
        </CarbonSectionBody>
      </GlassPanel>
    </section>
  );
}
