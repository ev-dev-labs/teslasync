import { Calculator, Factory, MoveRight, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

export function CarbonOpportunityMath({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const recommendation = analysis.recommendation;
  const difference =
    recommendation.reportedPotentialSavingKg != null
    && recommendation.calculatedPotentialSavingKg != null
      ? recommendation.reportedPotentialSavingKg
        - recommendation.calculatedPotentialSavingKg
      : null;

  return (
    <section
      data-testid="carbon-opportunity-math"
      aria-label={t(
        'carbon.opportunity.aria',
        'Recommendation opportunity formula and scenario boundaries',
      )}
    >
      <LayoutCard
        title={t('carbon.opportunity.title', 'Opportunity math and boundaries')}
        actions={<Calculator className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <CarbonSectionBody state={states.recommendation}>
          <CarbonSectionBody state={states.lifetime}>
            <StatStrip
              id="carbon-opportunity-metrics"
              variant="embedded"
              period={{
                kind: 'alltime',
                label: t('carbon.source.recommendationScope', 'Full vehicle history; independent of the selected range'),
                provenance: t('carbon.source.recommendation', 'Green-window scenario'),
              }}
              metrics={[
                {
                  metricId: 'text', occurrenceId: 'carbon-opportunity-energy',
                  label: t('carbon.opportunity.energy', 'Energy shifted'),
                  rawValue: display.formatEnergy(recommendation.shiftedEnergyWh),
                  context: <><Zap className="h-5 w-5" aria-hidden="true" />{t('carbon.opportunity.energyHint', 'All observed lifetime charging energy')}</>,
                },
                {
                  metricId: 'text', occurrenceId: 'carbon-opportunity-current',
                  label: t('carbon.opportunity.currentCo2', 'Current scenario CO₂'),
                  rawValue: display.formatKg(recommendation.currentScenarioCo2Kg),
                  context: <><Factory className="h-5 w-5" aria-hidden="true" />{t('carbon.opportunity.currentFormula', 'Energy × observed average intensity')}</>,
                },
                {
                  metricId: 'text', occurrenceId: 'carbon-opportunity-shifted',
                  label: t('carbon.opportunity.shiftedCo2', 'Shifted scenario CO₂'),
                  rawValue: display.formatKg(recommendation.shiftedScenarioCo2Kg),
                  context: <><MoveRight className="h-5 w-5" aria-hidden="true" />{t('carbon.opportunity.shiftedFormula', 'Energy × green-window average')}</>,
                },
                {
                  metricId: 'text', occurrenceId: 'carbon-opportunity-recomputed',
                  label: t('carbon.opportunity.recomputed', 'Recomputed saving'),
                  rawValue: display.formatKg(recommendation.calculatedPotentialSavingKg),
                  context: <><Calculator className="h-5 w-5" aria-hidden="true" />{t('carbon.opportunity.recomputedPct', '{{percentage}} by independent frontend formula', {
                    percentage: display.formatPercent(recommendation.calculatedPotentialSavingPct),
                  })}</>,
                },
                {
                  metricId: 'text', occurrenceId: 'carbon-opportunity-residual',
                  label: t('carbon.opportunity.residual', 'Reported minus recomputed'),
                  rawValue: display.formatSignedKg(difference),
                  context: <><Calculator className="h-5 w-5" aria-hidden="true" />{t('carbon.opportunity.residualHint', 'Evaluated against explicit wire-rounding tolerance')}</>,
                },
              ]}
            />
            <AlertBanner className="mt-4" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'carbon.opportunity.boundary',
                  'This is a counterfactual static-model estimate, not a schedule, dispatch command, guarantee, live marginal-emissions forecast, or proof that the same energy could physically move.',
                )}
              </Text>
            </AlertBanner>
          </CarbonSectionBody>
        </CarbonSectionBody>
      </LayoutCard>
    </section>
  );
}
