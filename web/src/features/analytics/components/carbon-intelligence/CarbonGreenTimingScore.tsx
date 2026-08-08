import { Gauge, ListChecks, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LinearGauge } from '@/components/charts';
import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

const COLOR_GOOD = '#10b981';
const COLOR_MIDDLE = '#f59e0b';
const COLOR_LOW = '#f43f5e';

export function CarbonGreenTimingScore({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const lifetime = analysis.lifetime;
  const score = lifetime.greenScore;
  const hasScoredSessions =
    lifetime.sessionsScored != null && lifetime.sessionsScored > 0;
  const scoreColor = score == null || score < 35
    ? COLOR_LOW
    : score < 70
      ? COLOR_MIDDLE
      : COLOR_GOOD;

  return (
    <section
      data-testid="carbon-green-timing-score"
      aria-label={t(
        'carbon.score.aria',
        'Lifetime green charging timing score evidence',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Gauge
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('carbon.score.title', 'Green timing score and evidence support')}
        </PanelTitle>
        <CarbonSectionBody state={states.lifetime}>
          {hasScoredSessions && score != null ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
              <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4 text-center">
                <LinearGauge
                  value={score}
                  max={100}
                  label={t('carbon.score.gaugeLabel', 'Lifetime green score')}
                  color={scoreColor}
                  size={170}
                  decimals={1}
                />
                <Text as="p" variant="caption" className="mt-2">
                  {t(
                    'carbon.score.scale',
                    '100 maps to the model minimum; 0 maps to the model maximum.',
                  )}
                </Text>
              </div>
              <Grid cols={{ default: 1, sm: 3 }} gap={3}>
                <MetricCard
                  label={t('carbon.score.sessions', 'Support sessions')}
                  value={display.formatNumber(lifetime.sessionsScored, 0)}
                  subtitle={t(
                    'carbon.score.sessionsHint',
                    'Full-history positive-energy sessions',
                  )}
                  icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
                  color="blue"
                />
                <MetricCard
                  label={t('carbon.score.realized', 'Realized intensity')}
                  value={display.formatIntensity(
                    lifetime.energyWeightedIntensityGPerKwh,
                  )}
                  subtitle={t(
                    'carbon.score.realizedHint',
                    'Derived from lifetime CO₂ ÷ energy',
                  )}
                  icon={<Scale className="h-5 w-5" aria-hidden="true" />}
                  color="amber"
                />
                <MetricCard
                  label={t('carbon.score.curveSpan', 'Model intensity span')}
                  value={display.formatIntensity(
                    analysis.curve.stats.spanGPerKwh,
                  )}
                  subtitle={t(
                    'carbon.score.spanHint',
                    'A flat curve makes every hour equivalent',
                  )}
                  icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
                  color="purple"
                />
              </Grid>
            </div>
          ) : (
            <EmptyState
              message={t(
                hasScoredSessions
                  ? 'carbon.score.unavailable'
                  : 'carbon.score.empty',
                hasScoredSessions
                  ? 'A timing score is unavailable because the returned score failed validation.'
                  : 'No scored lifetime charging sessions support a timing score.',
              )}
            />
          )}
          <Text as="p" variant="caption" className="mt-4">
            {t(
              'carbon.score.disclosure',
              'This is a model-relative timing score, not evidence of renewable generation, marginal emissions, location, or a causal schedule benefit.',
            )}
          </Text>
        </CarbonSectionBody>
      </GlassPanel>
    </section>
  );
}
