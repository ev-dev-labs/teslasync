import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatDecimal, formatIntensityWhPerM, formatSignedIntensityWhPerMPerYear, supportBandLabel } from './formatters';

export function SeasonalComponentDiagnostics({
  analysis,
  state,
  locale,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const rows = [
    [t('seasonalEfficiency.diagnostics.annual', 'Annual component amplitude'), formatIntensityWhPerM(analysis.diagnostics.annualComponentAmplitudeWhPerM, units.unitPrefs)],
    [t('seasonalEfficiency.diagnostics.semiannual', 'Semiannual component amplitude'), formatIntensityWhPerM(analysis.diagnostics.semiannualComponentAmplitudeWhPerM, units.unitPrefs)],
    [t('seasonalEfficiency.diagnostics.seasonalAmplitude', 'Peak-to-trough half range'), formatIntensityWhPerM(analysis.diagnostics.seasonalAmplitudeWhPerM, units.unitPrefs)],
    [t('seasonalEfficiency.diagnostics.rmse', 'Weighted RMSE'), formatIntensityWhPerM(analysis.diagnostics.weightedRmseWhPerM, units.unitPrefs)],
    [t('seasonalEfficiency.diagnostics.mae', 'Weighted MAE'), formatIntensityWhPerM(analysis.diagnostics.weightedMaeWhPerM, units.unitPrefs)],
    [t('seasonalEfficiency.diagnostics.trend', 'Trend coefficient'), formatSignedIntensityWhPerMPerYear(analysis.trendWhPerMPerYear, units.unitPrefs)],
    [t('seasonalEfficiency.diagnostics.ratio', 'Samples / parameters'), formatDecimal(analysis.fit.sampleToParameterRatio, locale, 1)],
    [t('seasonalEfficiency.diagnostics.support', 'Support band'), supportBandLabel(analysis.support.band, t)],
  ];
  return (
    <section data-testid="seasonal-component-diagnostics">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t('seasonalEfficiency.diagnostics.title', 'Model component diagnostics')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('seasonalEfficiency.diagnostics.subtitle', 'Fit magnitude and evidence support are reported separately. R² is explicitly in-sample and descriptive.')}
        </Text>
        <SeasonalSectionBody state={state}>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 border-b border-[var(--panel-border)] pb-2">
                <Text variant="caption">{label}</Text>
                <Text variant="bodySm" className="text-right">{state.isResolved && !state.error ? value : '—'}</Text>
              </div>
            ))}
          </div>
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
