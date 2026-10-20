import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { CarbonSectionProps } from '../carbon-intelligence/types';
import { CarbonSectionBody } from '../carbon-intelligence/CarbonSectionBody';
import { CarbonBriefBand } from './CarbonBriefBand';

export function CarbonOpportunityBrief({ analysis, states, display }: CarbonSectionProps) {
  const { t } = useTranslation();
  const recommendation = analysis.recommendation;
  const difference = recommendation.reportedPotentialSavingKg != null && recommendation.calculatedPotentialSavingKg != null
    ? recommendation.reportedPotentialSavingKg - recommendation.calculatedPotentialSavingKg : null;
  const resolved = states.recommendation.hasData && states.lifetime.hasData;
  const metrics: StatMetric[] = [
    { metricId: 'energy', occurrenceId: 'carbon-opportunity-energy', rawValue: resolved ? recommendation.shiftedEnergyWh : null,
      label: t('carbon.opportunity.energy', 'Energy shifted'),
      display: { formatter: raw => ({ value: display.formatEnergy(raw), unit: '' }) },
      context: t('carbon.opportunity.energyHint', 'All observed lifetime charging energy') },
    { metricId: 'mass', occurrenceId: 'carbon-opportunity-current', rawValue: resolved ? recommendation.currentScenarioCo2Kg : null,
      label: t('carbon.opportunity.currentCo2', 'Current scenario CO₂'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.opportunity.currentFormula', 'Energy × observed average intensity') },
    { metricId: 'mass', occurrenceId: 'carbon-opportunity-shifted', rawValue: resolved ? recommendation.shiftedScenarioCo2Kg : null,
      label: t('carbon.opportunity.shiftedCo2', 'Shifted scenario CO₂'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.opportunity.shiftedFormula', 'Energy × green-window average') },
    { metricId: 'mass', occurrenceId: 'carbon-opportunity-recomputed', rawValue: resolved ? recommendation.calculatedPotentialSavingKg : null,
      label: t('carbon.opportunity.recomputed', 'Recomputed saving'),
      display: { formatter: raw => ({ value: display.formatKg(raw), unit: '' }) },
      context: t('carbon.opportunity.recomputedPct', '{{percentage}} by independent frontend formula', { percentage: display.formatPercent(recommendation.calculatedPotentialSavingPct) }) },
    { metricId: 'mass', occurrenceId: 'carbon-opportunity-residual', rawValue: resolved ? difference : null,
      label: t('carbon.opportunity.residual', 'Reported minus recomputed'),
      display: { formatter: raw => ({ value: display.formatSignedKg(raw), unit: '' }) },
      context: t('carbon.opportunity.residualHint', 'Evaluated against explicit wire-rounding tolerance') },
  ];
  const boundary = t('carbon.opportunity.boundary', 'This is a counterfactual static-model estimate, not a schedule, dispatch command, guarantee, live marginal-emissions forecast, or proof that the same energy could physically move.');
  const combinedState = {
    ...states.recommendation,
    hasData: resolved,
    isLoading: !resolved && (states.recommendation.isLoading || states.lifetime.isLoading),
    refreshError: states.recommendation.refreshError || states.lifetime.refreshError,
    refreshPaused: states.recommendation.refreshPaused || states.lifetime.refreshPaused,
  };
  return <CarbonBriefBand testId="carbon-opportunity-math" metrics={metrics} state={combinedState}
    title={t('carbon.opportunity.title', 'Opportunity math and boundaries')}
    description={t('carbon.source.recommendation', 'Green-window scenario')}
    scope={<span>{t('carbon.source.recommendationScope', 'Full vehicle history; independent of the selected range')}</span>}>
    <CarbonSectionBody state={states.lifetime}>
      <AlertBanner className="mt-4" variant="warning"><Text as="p" variant="caption">{boundary}</Text></AlertBanner>
    </CarbonSectionBody>
  </CarbonBriefBand>;
}
