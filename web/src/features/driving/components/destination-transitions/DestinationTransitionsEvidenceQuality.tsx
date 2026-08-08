import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import { DestinationContinuityMetrics } from './DestinationContinuityMetrics';
import { DestinationCoverageMetrics } from './DestinationCoverageMetrics';
import { DestinationRowAccountingMetrics } from './DestinationRowAccountingMetrics';
import { DestinationSupportMetrics } from './DestinationSupportMetrics';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface DestinationTransitionsEvidenceQualityProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
  timeZone: string;
}

export function DestinationTransitionsEvidenceQuality({
  model,
  state,
  locale,
  timeZone,
}: DestinationTransitionsEvidenceQualityProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="destination-evidence-quality">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'destinationTransitions.quality.title',
            'Evidence quality, accounting, and continuity',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'destinationTransitions.quality.subtitle',
            'Every returned row and every chronologically adjacent candidate pair enters one mutually exclusive category.',
          )}
        </Text>
        <DestinationTransitionsSectionBody
          model={model}
          state={state}
          requirement="none"
        >
          <div className="space-y-5">
            <DestinationRowAccountingMetrics model={model} />
            <DestinationContinuityMetrics
              model={model}
              locale={locale}
            />
            <DestinationCoverageMetrics
              model={model}
              locale={locale}
              timeZone={timeZone}
            />
            <DestinationSupportMetrics model={model} locale={locale} />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'destinationTransitions.quality.supportFormula',
                'Origin support index = 100 × (0.40 × outgoing volume + 0.25 × active days + 0.20 × active weeks + 0.15 × recurrence). The displayed aggregate is weighted by accepted outgoing transitions.',
              )}
            </Text>
          </AlertBanner>
          {model.accounting.historyCapReached ? (
            <AlertBanner className="mt-3" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'destinationTransitions.quality.capWarning',
                  'The 1,000-row return cap was reached. Accounting is complete for returned rows, not established lifetime history.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
        </DestinationTransitionsSectionBody>
      </GlassPanel>
    </section>
  );
}
