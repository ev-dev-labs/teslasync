import { Calculator, Factory, MoveRight, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
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
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Calculator
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('carbon.opportunity.title', 'Opportunity math and boundaries')}
        </PanelTitle>
        <CarbonSectionBody state={states.recommendation}>
          <CarbonSectionBody state={states.lifetime}>
            <Grid cols={{ default: 1, sm: 2, xl: 5 }} gap={3}>
              <MetricCard
                label={t('carbon.opportunity.energy', 'Energy shifted')}
                value={display.formatEnergy(recommendation.shiftedEnergyWh)}
                subtitle={t(
                  'carbon.opportunity.energyHint',
                  'All observed lifetime charging energy',
                )}
                icon={<Zap className="h-5 w-5" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('carbon.opportunity.currentCo2', 'Current scenario CO₂')}
                value={display.formatKg(recommendation.currentScenarioCo2Kg)}
                subtitle={t(
                  'carbon.opportunity.currentFormula',
                  'Energy × observed average intensity',
                )}
                icon={<Factory className="h-5 w-5" aria-hidden="true" />}
                color="amber"
              />
              <MetricCard
                label={t('carbon.opportunity.shiftedCo2', 'Shifted scenario CO₂')}
                value={display.formatKg(recommendation.shiftedScenarioCo2Kg)}
                subtitle={t(
                  'carbon.opportunity.shiftedFormula',
                  'Energy × green-window average',
                )}
                icon={<MoveRight className="h-5 w-5" aria-hidden="true" />}
                color="green"
              />
              <MetricCard
                label={t('carbon.opportunity.recomputed', 'Recomputed saving')}
                value={display.formatKg(
                  recommendation.calculatedPotentialSavingKg,
                )}
                subtitle={t(
                  'carbon.opportunity.recomputedPct',
                  '{{percentage}} by independent frontend formula',
                  {
                    percentage: display.formatPercent(
                      recommendation.calculatedPotentialSavingPct,
                    ),
                  },
                )}
                icon={<Calculator className="h-5 w-5" aria-hidden="true" />}
                color="green"
              />
              <MetricCard
                label={t('carbon.opportunity.residual', 'Reported minus recomputed')}
                value={display.formatSignedKg(difference, 3)}
                subtitle={t(
                  'carbon.opportunity.residualHint',
                  'Evaluated against explicit wire-rounding tolerance',
                )}
                icon={<Calculator className="h-5 w-5" aria-hidden="true" />}
                color="purple"
              />
            </Grid>
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
      </GlassPanel>
    </section>
  );
}
