import { useTranslation } from 'react-i18next';
import { LinearGauge } from '@/components/charts';
import type { StatMetric } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { CarbonSectionProps } from '../carbon-intelligence/types';
import { CarbonBriefBand } from './CarbonBriefBand';

export function CarbonScoreBrief({ analysis, states, display }: CarbonSectionProps) {
  const { t } = useTranslation();
  const { precision } = useNumberFormatting();
  const lifetime = analysis.lifetime;
  const score = lifetime.greenScore;
  const hasScoredSessions = lifetime.sessionsScored != null && lifetime.sessionsScored > 0;
  const supported = states.lifetime.hasData && hasScoredSessions && score != null;
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'carbon-score-sessions', rawValue: supported ? lifetime.sessionsScored : null,
      label: t('carbon.score.sessions', 'Support sessions'),
      display: { formatter: raw => ({ value: display.formatNumber(raw), unit: '' }) },
      context: t('carbon.score.sessionsHint', 'Full-history positive-energy sessions') },
    { metricId: 'rate', occurrenceId: 'carbon-score-realized', rawValue: supported ? lifetime.energyWeightedIntensityGPerKwh : null,
      label: t('carbon.score.realized', 'Realized intensity'),
      display: { formatter: raw => ({ value: display.formatIntensity(raw), unit: '' }) },
      context: t('carbon.score.realizedHint', 'Derived from lifetime CO₂ ÷ energy') },
    { metricId: 'rate', occurrenceId: 'carbon-score-span',
      rawValue: supported && states.intensity.hasData ? analysis.curve.stats.spanGPerKwh : null,
      label: t('carbon.score.curveSpan', 'Model intensity span'),
      display: { formatter: raw => ({ value: display.formatIntensity(raw), unit: '' }) },
      context: t('carbon.score.spanHint', 'A flat curve makes every hour equivalent') },
  ];
  const disclosure = t('carbon.score.disclosure', 'This is a model-relative timing score, not evidence of renewable generation, marginal emissions, location, or a causal schedule benefit.');
  return <CarbonBriefBand testId="carbon-green-timing-score" metrics={metrics} state={states.lifetime}
    title={t('carbon.score.title', 'Green timing score and evidence support')}
    description={t('carbon.source.lifetime', 'Lifetime summary')}
    scope={<span>{t('carbon.source.lifetimeScope', 'Full vehicle history')}</span>}>
    {hasScoredSessions && score != null ? <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4 text-center">
      <LinearGauge value={score} max={100} label={t('carbon.score.gaugeLabel', 'Lifetime green score')}
        color={score < 35 ? '#f43f5e' : score < 70 ? '#f59e0b' : '#10b981'} size={170} decimals={precision} />
      <Text as="p" variant="caption" className="mt-2">{t('carbon.score.scale', '100 maps to the model minimum; 0 maps to the model maximum.')}</Text>
    </div> : <EmptyState message={// no-action: Missing scored sessions or an invalid score cannot be repaired by this read-only gauge; source recovery belongs to the ledger.
      hasScoredSessions
      ? t('carbon.score.unavailable', 'A timing score is unavailable because the returned score failed validation.')
      : t('carbon.score.empty', 'No scored lifetime charging sessions support a timing score.')} />}
    <Text as="p" variant="caption" className="mt-4">{disclosure}</Text>
  </CarbonBriefBand>;
}
