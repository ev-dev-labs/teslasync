import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import { ArrivalReliabilityEvidenceMetrics } from './ArrivalReliabilityEvidenceMetrics';
import { ArrivalReliabilitySectionBody } from './ArrivalReliabilitySectionBody';
import type { ArrivalReliabilityQueryState } from './types';

interface ArrivalReliabilityEvidenceQualityProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  locale: string;
  timeZone: string;
}

export function ArrivalReliabilityEvidenceQuality({
  analysis,
  state,
  locale,
  timeZone,
}: ArrivalReliabilityEvidenceQualityProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="arrival-evidence-quality">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'arrivalReliability.quality.title',
            'Evidence quality, accounting, and coverage',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'arrivalReliability.quality.subtitle',
            'Every returned row is counted once, while sample support remains separate from observed timing consistency.',
          )}
        </Text>
        <ArrivalReliabilitySectionBody
          analysis={analysis}
          state={state}
          requirement="none"
        >
          <ArrivalReliabilityEvidenceMetrics
            analysis={analysis}
            locale={locale}
            timeZone={timeZone}
          />
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'arrivalReliability.quality.supportFormula',
                'Global support index = 100 × (0.35 × supported-drive volume + 0.20 × supported-route count + 0.25 × supported active weeks + 0.20 × repeated-route coverage).',
              )}
            </Text>
          </AlertBanner>
          {analysis.accounting.historyCapReached ? (
            <AlertBanner className="mt-3" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'arrivalReliability.quality.capWarning',
                  'The 1,000-row return cap was reached. Accounting is complete for returned rows, not established lifetime history.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
        </ArrivalReliabilitySectionBody>
      </GlassPanel>
    </section>
  );
}
