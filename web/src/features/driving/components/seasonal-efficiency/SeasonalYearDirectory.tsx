import { FolderClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatIntensityWhPerM } from './formatters';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function SeasonalYearDirectory({
  analysis,
  state,
  units,
}: SeasonalSectionProps) {
  useNumberFormatting();
  const { t } = useTranslation();
  return (
    <section data-testid="seasonal-year-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FolderClock className="h-4 w-4 text-theme-accent" aria-hidden="true" />
          {t('seasonalEfficiency.yearDirectory.title', 'Year-over-year directory')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t('seasonalEfficiency.yearDirectory.subtitle', 'Local-calendar year summaries are descriptive and include sample volume and observed distance for context.')}
        </Text>
        <SeasonalSectionBody state={state}>
          {analysis.years.length === 0 ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('seasonalEfficiency.yearDirectory.empty', 'No local calendar years have included observations.')} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {analysis.years.map((year) => (
                <div data-app-part="card" data-surface-variant="standalone" key={year.year} className="rounded-lg border border-[var(--panel-border)] p-3">
                  <div className="flex items-center justify-between">
                    <Text variant="subhead">{year.year}</Text>
                    <Text variant="caption">{t('seasonalEfficiency.yearDirectory.samples', '{{count}} samples', { count: year.sampleCount })}</Text>
                  </div>
                  <dl data-app-part="list" data-app-list="definitions" className="mt-3 grid grid-cols-2 gap-2">
                    <div data-app-part="list-row">
                      <Text data-app-part="metric-label" variant="caption" as="dt">{t('seasonalEfficiency.yearDirectory.observed', 'Observed')}</Text>
                      <Text data-app-part="metric-reading" variant="bodySm" as="dd"><span data-app-part="metric-value">{formatIntensityWhPerM(year.observedEnergyIntensityWhPerM, units.unitPrefs)}</span></Text>
                    </div>
                    <div data-app-part="list-row">
                      <Text data-app-part="metric-label" variant="caption" as="dt">{t('seasonalEfficiency.yearDirectory.adjusted', 'Deseasonalized')}</Text>
                      <Text data-app-part="metric-reading" variant="bodySm" as="dd"><span data-app-part="metric-value">{formatIntensityWhPerM(year.deseasonalizedEnergyIntensityWhPerM, units.unitPrefs)}</span></Text>
                    </div>
                  </dl>
                  <Text variant="caption" as="p" className="mt-2">
                    {t('seasonalEfficiency.yearDirectory.distance', '{{distance}} observed distance', {
                      distance: units.formatDistance(year.distanceM),
                    })}
                  </Text>
                  <Text variant="caption" as="p">
                    {t('seasonalEfficiency.yearDirectory.change', 'Change from prior year: {{value}}', {
                      value: formatIntensityWhPerM(year.changeFromPreviousWhPerM, units.unitPrefs),
                    })}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
