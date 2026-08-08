import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { DepartureForecast } from '../../lib/departureForecast';
import { DepartureForecastEvidenceMetrics } from './DepartureForecastEvidenceMetrics';
import { DepartureForecastSectionBody } from './DepartureForecastSectionBody';
import { departureEvidenceBandLabel } from './labels';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastEvidenceQualityProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
}

export function DepartureForecastEvidenceQuality({
  forecast,
  state,
  locale,
}: DepartureForecastEvidenceQualityProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="departure-evidence-quality">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('departure.quality.title', 'Evidence quality and coverage')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'departure.quality.subtitle',
            'Complete accounting for every returned row plus the transparent ingredients of the descriptive support index.',
          )}
        </Text>
        <DepartureForecastSectionBody
          forecast={forecast}
          state={state}
          allowEmpty
        >
          <DepartureForecastEvidenceMetrics
            forecast={forecast}
            locale={locale}
          />
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'departure.quality.indexExplanation',
                '{{band}}. The support index gates elapsed exposure with event volume, active weeks, repeat events, and occupied-cell occurrences; it is not statistical confidence.',
                {
                  band: departureEvidenceBandLabel(
                    t,
                    forecast.evidenceStrength.band,
                  ),
                },
              )}
            </Text>
          </AlertBanner>
          {forecast.accounting.historyCapReached ? (
            <AlertBanner className="mt-3" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'departure.quality.capWarning',
                  'The 1,000-row return cap was reached. Included and excluded counts are complete for returned rows, not guaranteed lifetime history.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
        </DepartureForecastSectionBody>
      </GlassPanel>
    </section>
  );
}
