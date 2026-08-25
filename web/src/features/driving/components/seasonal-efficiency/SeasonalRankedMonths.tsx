import { ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatIntensityWhPerM, formatMonth } from './formatters';

export function SeasonalRankedMonths({
  analysis,
  state,
  locale,
  timeZone,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const ranked = analysis.months
    .filter((month) => month.sampleCount > 0)
    .slice()
    .sort((a, b) =>
      (b.observedEnergyIntensityWhPerM ?? Number.NEGATIVE_INFINITY)
      - (a.observedEnergyIntensityWhPerM ?? Number.NEGATIVE_INFINITY)
      || a.month - b.month);
  return (
    <section data-testid="seasonal-ranked-months">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('seasonalEfficiency.rankedMonths.title', 'Ranked local-month evidence')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t('seasonalEfficiency.rankedMonths.subtitle', 'A descriptive ordering of observed month averages; support and distance remain visible so magnitude is not read without volume.')}
        </Text>
        <SeasonalSectionBody state={state}>
          {ranked.length === 0 ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('seasonalEfficiency.rankedMonths.empty', 'No local month has an included observation yet.')} />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {ranked.map((month, index) => (
                <div key={month.month} className="flex items-center gap-3 rounded-lg border border-[var(--panel-border)] p-3">
                  <Text variant="metricValue" className="w-7 text-center text-[var(--text-muted)]">{index + 1}</Text>
                  <div className="min-w-0 flex-1">
                    <Text variant="bodySm" as="p">{formatMonth(month.month, locale, timeZone)}</Text>
                    <Text variant="caption" as="p">{t('seasonalEfficiency.rankedMonths.support', '{{samples}} samples · {{distance}}', {
                      samples: month.sampleCount,
                      distance: units.formatDistance(month.distanceM, { precision: 0 }),
                    })}</Text>
                  </div>
                  <Text variant="bodySm">{formatIntensityWhPerM(month.observedEnergyIntensityWhPerM, units.unitPrefs)}</Text>
                </div>
              ))}
            </div>
          )}
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
