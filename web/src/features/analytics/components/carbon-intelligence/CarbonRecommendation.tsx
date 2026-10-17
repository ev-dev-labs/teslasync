import { Clock3, History, Sparkles, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
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
      <LayoutCard
        title={t('carbon.recommendation.title', 'Full-history greenest-window scenario')}
        actions={<Sparkles className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
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
              <StatStrip
                id="carbon-recommendation-metrics"
                variant="embedded"
                period={{
                  kind: 'alltime',
                  label: t('carbon.source.recommendationScope', 'Full vehicle history; independent of the selected range'),
                  provenance: t('carbon.source.recommendation', 'Green-window scenario'),
                }}
                metrics={[
                  {
                    metricId: 'text', occurrenceId: 'carbon-recommendation-window',
                    label: t('carbon.recommendation.window', 'Greenest 3-hour window'),
                    rawValue: windowLabel,
                    context: <><Clock3 className="h-5 w-5" aria-hidden="true" />{t('carbon.recommendation.windowHint', 'Start inclusive; end exclusive; wraps at midnight')}</>,
                  },
                  {
                    metricId: 'text', occurrenceId: 'carbon-recommendation-current',
                    label: t('carbon.recommendation.current', 'Observed lifetime average'),
                    rawValue: display.formatIntensity(recommendation.currentAvgIntensityGPerKwh),
                    context: <><History className="h-5 w-5" aria-hidden="true" />{t('carbon.recommendation.currentHint', 'Energy-weighted full-history intensity')}</>,
                  },
                  {
                    metricId: 'text', occurrenceId: 'carbon-recommendation-average',
                    label: t('carbon.recommendation.windowAverage', 'Window average'),
                    rawValue: display.formatIntensity(recommendation.windowAvgIntensityGPerKwh),
                    context: <><Sparkles className="h-5 w-5" aria-hidden="true" />{t('carbon.recommendation.modelHint', 'Mean of three static model rows')}</>,
                  },
                  {
                    metricId: 'text', occurrenceId: 'carbon-recommendation-saving',
                    label: t('carbon.recommendation.reportedSaving', 'Reported potential saving'),
                    rawValue: display.formatKg(recommendation.reportedPotentialSavingKg),
                    context: <><TrendingDown className="h-5 w-5" aria-hidden="true" />{t('carbon.recommendation.reportedPct', '{{percentage}} of modeled charging CO₂', {
                      percentage: display.formatPercent(recommendation.reportedPotentialSavingPct),
                    })}</>,
                  },
                ]}
              />
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
      </LayoutCard>
    </section>
  );
}
