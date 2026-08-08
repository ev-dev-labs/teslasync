import { BookOpenCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { fitStatusLabel } from './formatters';

export function SeasonalMethodology({
  analysis,
  state,
  timeZone,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  return (
    <section data-testid="seasonal-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('seasonalEfficiency.methodology.title', 'Methodology and interpretation limits')}
        </PanelTitle>
        <SeasonalSectionBody state={state}>
          <div className="grid gap-4 text-sm xl:grid-cols-3">
            <div>
              <Text variant="subhead" as="h4">{t('seasonalEfficiency.methodology.modelTitle', 'Model')}</Text>
              <Text as="p" variant="bodySm" className="mt-2">
                {t('seasonalEfficiency.methodology.model', 'Six terms are fitted with distance weights: intercept, annual sine/cosine, semiannual sine/cosine, and a linear time term. Ridge regularization is sanitized before solving.')}
              </Text>
            </div>
            <div>
              <Text variant="subhead" as="h4">{t('seasonalEfficiency.methodology.eligibilityTitle', 'Eligibility')}</Text>
              <Text as="p" variant="bodySm" className="mt-2">
                {t('seasonalEfficiency.methodology.eligibility', 'A completed non-live drive needs valid local calendar fields, positive duration, at least the distance floor, finite positive energy, and plausible canonical Wh/m intensity.')}
              </Text>
            </div>
            <div>
              <Text variant="subhead" as="h4">{t('seasonalEfficiency.methodology.scopeTitle', 'Scope')}</Text>
              <Text as="p" variant="bodySm" className="mt-2">
                {t('seasonalEfficiency.methodology.scope', 'The result describes the returned latest history in {{timeZone}}. Weather, temperature, route mix, tyres, firmware, charging losses, and driving behavior are not modeled or attributed.', { timeZone })}
              </Text>
            </div>
          </div>
          <Text as="p" variant="caption" className="mt-4">
            {t('seasonalEfficiency.methodology.disclosure', 'R² is an in-sample descriptive fit statistic and is null for constant observations. Residual bands and support bands describe this returned sample only; they are not a promise about an unobserved interval.')}
          </Text>
          <Text as="p" variant="caption" className="mt-2">
            {t('seasonalEfficiency.methodology.accounting', 'Returned: {{returned}} · included: {{included}} · excluded: {{excluded}} · fit: {{fit}}', {
              returned: analysis.returnedCount,
              included: analysis.includedCount,
              excluded: analysis.excludedCount,
              fit: fitStatusLabel(analysis.fit.status, t),
            })}
          </Text>
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
