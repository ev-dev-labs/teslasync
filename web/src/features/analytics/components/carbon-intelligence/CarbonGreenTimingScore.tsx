import { Gauge, ListChecks, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LinearGauge } from '@/components/charts';
import { StatStrip } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const COLOR_GOOD = '#10b981';
const COLOR_MIDDLE = '#f59e0b';
const COLOR_LOW = '#f43f5e';

export function CarbonGreenTimingScore({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { precision: displayPrecision } = useNumberFormatting();
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
      <LayoutCard
        title={t('carbon.score.title', 'Green timing score and evidence support')}
        actions={<Gauge className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <CarbonSectionBody state={states.lifetime}>
          {hasScoredSessions && score != null ? (
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
              <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4 text-center">
                <LinearGauge
                  value={score}
                  max={100}
                  label={t('carbon.score.gaugeLabel', 'Lifetime green score')}
                  color={scoreColor}
                  size={170}
                  decimals={displayPrecision}
                />
                <Text as="p" variant="caption" className="mt-2">
                  {t(
                    'carbon.score.scale',
                    '100 maps to the model minimum; 0 maps to the model maximum.',
                  )}
                </Text>
              </div>
              <StatStrip
                id="carbon-green-score-support"
                variant="embedded"
                period={{
                  kind: 'alltime',
                  label: t('carbon.source.lifetimeScope', 'Full vehicle history'),
                  provenance: t('carbon.source.lifetime', 'Lifetime summary'),
                }}
                metrics={[
                  {
                    metricId: 'text', occurrenceId: 'carbon-score-sessions',
                    label: t('carbon.score.sessions', 'Support sessions'),
                    rawValue: display.formatNumber(lifetime.sessionsScored),
                    context: <><ListChecks className="h-5 w-5" aria-hidden="true" />{t('carbon.score.sessionsHint', 'Full-history positive-energy sessions')}</>,
                  },
                  {
                    metricId: 'text', occurrenceId: 'carbon-score-realized',
                    label: t('carbon.score.realized', 'Realized intensity'),
                    rawValue: display.formatIntensity(lifetime.energyWeightedIntensityGPerKwh),
                    context: <><Scale className="h-5 w-5" aria-hidden="true" />{t('carbon.score.realizedHint', 'Derived from lifetime CO₂ ÷ energy')}</>,
                  },
                  {
                    metricId: 'text', occurrenceId: 'carbon-score-span',
                    label: t('carbon.score.curveSpan', 'Model intensity span'),
                    rawValue: display.formatIntensity(analysis.curve.stats.spanGPerKwh),
                    context: <><Gauge className="h-5 w-5" aria-hidden="true" />{t('carbon.score.spanHint', 'A flat curve makes every hour equivalent')}</>,
                  },
                ]}
              />
            </div>
          ) : (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
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
      </LayoutCard>
    </section>
  );
}
