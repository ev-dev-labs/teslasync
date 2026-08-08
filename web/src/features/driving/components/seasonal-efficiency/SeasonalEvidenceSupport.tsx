import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { fitStatusLabel, formatDecimal, supportBandLabel } from './formatters';

export function SeasonalEvidenceSupport({
  analysis,
  state,
  locale,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const factors = [
    [t('seasonalEfficiency.support.volume', 'Included volume'), analysis.support.volumeScore],
    [t('seasonalEfficiency.support.months', 'Calendar-month coverage'), analysis.support.calendarMonthScore],
    [t('seasonalEfficiency.support.weeks', 'Active local weeks'), analysis.support.activeWeekScore],
    [t('seasonalEfficiency.support.years', 'Active local years'), analysis.support.activeYearScore],
    [t('seasonalEfficiency.support.ratio', 'Sample / parameter support'), analysis.support.sampleParameterScore],
  ] as const;
  return (
    <section data-testid="seasonal-evidence-support">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t('seasonalEfficiency.support.title', 'Evidence support and fit eligibility')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('seasonalEfficiency.support.subtitle', 'Support describes the amount and breadth of evidence separately from the fitted seasonal magnitude.')}
        </Text>
        <SeasonalSectionBody state={state}>
          <div className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
            <div className="rounded-lg border border-[var(--panel-border)] p-4 text-center">
              <Text variant="metricLabel">{t('seasonalEfficiency.support.index', 'Evidence support index')}</Text>
              <Text variant="metricValue" as="p">{analysis.support.index} / 100</Text>
              <Text variant="bodySm" as="p" className="mt-1">{supportBandLabel(analysis.support.band, t)}</Text>
              <Text variant="caption" as="p" className="mt-2">{t('seasonalEfficiency.support.ratioValue', '{{ratio}} samples per parameter', {
                ratio: formatDecimal(analysis.fit.sampleToParameterRatio, locale, 1),
              })}</Text>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {factors.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-[var(--panel-border)] p-3">
                  <div className="flex justify-between gap-3">
                    <Text variant="caption">{label}</Text>
                    <Text variant="bodySm">{Math.round(value * 100)}%</Text>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Text as="p" variant="caption" className="mt-4">
            {t('seasonalEfficiency.support.gate', 'Fit status: {{status}} — {{reason}}. Eligibility requires at least 24 included samples, about 300 observed days, and 9 local calendar months by default.', {
              status: fitStatusLabel(analysis.fit.status, t),
              reason: analysis.fit.reason,
            })}
          </Text>
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
