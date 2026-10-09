import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { CarbonSectionProps } from '../carbon-intelligence/types';
import { CarbonBriefBand } from './CarbonBriefBand';

export function CarbonRecommendationBrief({ analysis, states, display }: CarbonSectionProps) {
  const { t } = useTranslation();
  const recommendation = analysis.recommendation;
  const resolved = states.recommendation.hasData;
  const metrics: StatMetric[] = [
    { metricId: 'text', occurrenceId: 'carbon-recommendation-window',
      rawValue: resolved ? t('carbon.recommendation.windowValue', '{{start}} – {{end}}', {
        start: display.formatHour(recommendation.windowStartHour), end: display.formatHour(recommendation.windowEndHour) }) : null,
      label: t('carbon.recommendation.window', 'Greenest 3-hour window'),
      context: t('carbon.recommendation.windowHint', 'Start inclusive; end exclusive; wraps at midnight') },
    { metricId: 'rate', occurrenceId: 'carbon-recommendation-current', rawValue: resolved ? recommendation.currentAvgIntensityGPerKwh : null,
      label: t('carbon.recommendation.current', 'Observed lifetime average'),
      display: { formatter: raw => ({ value: display.formatIntensity(raw), unit: '' }) },
      context: t('carbon.recommendation.currentHint', 'Energy-weighted full-history intensity') },
    { metricId: 'rate', occurrenceId: 'carbon-recommendation-average', rawValue: resolved ? recommendation.windowAvgIntensityGPerKwh : null,
      label: t('carbon.recommendation.windowAverage', 'Window average'),
      display: { formatter: raw => ({ value: display.formatIntensity(raw), unit: '' }) },
      context: t('carbon.recommendation.modelHint', 'Mean of three static model rows') },
    { metricId: 'mass', occurrenceId: 'carbon-recommendation-saving', rawValue: resolved ? recommendation.reportedPotentialSavingKg : null,
      label: t('carbon.recommendation.reportedSaving', 'Reported potential saving'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.recommendation.reportedPct', '{{percentage}} of modeled charging CO₂', { percentage: display.formatPercent(recommendation.reportedPotentialSavingPct) }) },
  ];
  const scope = t('carbon.recommendation.scope', 'Lifetime scope: the backend estimates moving all observed full-history charging energy into this fixed window. The selected date range does not constrain this scenario.');
  return <CarbonBriefBand testId="carbon-recommendation" metrics={metrics} state={states.recommendation}
    title={t('carbon.recommendation.title', 'Full-history greenest-window scenario')}
    description={t('carbon.source.recommendation', 'Green-window scenario')}
    scope={<span>{t('carbon.source.recommendationScope', 'Full vehicle history; independent of the selected range')}</span>}>
    {// no-action: No lifetime charging energy supports this read-only scenario; range changes cannot supply it, and source recovery lives in the ledger.
    recommendation.availability === 'empty' ? <EmptyState
      message={t('carbon.recommendation.empty', 'No lifetime charging energy supports a green-window scenario.')} />
      : recommendation.availability === 'invalid' ? <AlertBanner className="mt-4" variant="warning">
        {t('carbon.recommendation.invalid', 'Recommendation fields failed runtime or three-hour-window validation; unknown values remain withheld.')}
      </AlertBanner> : null}
    <AlertBanner className="mt-4" variant="info"><Text as="p" variant="caption">{scope}</Text></AlertBanner>
  </CarbonBriefBand>;
}
