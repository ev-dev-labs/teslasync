import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatLocalDate } from './formatters';

export function SeasonalAccounting({
  analysis,
  state,
  locale,
  timeZone,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const categories = [
    ['included', t('seasonalEfficiency.accounting.included', 'Included')],
    ['incompleteLive', t('seasonalEfficiency.accounting.incompleteLive', 'Incomplete / live')],
    ['invalidTimestampOrder', t('seasonalEfficiency.accounting.invalidTimestampOrder', 'Invalid timestamp / order')],
    ['future', t('seasonalEfficiency.accounting.future', 'Future')],
    ['invalidDuration', t('seasonalEfficiency.accounting.invalidDuration', 'Invalid duration')],
    ['invalidDistance', t('seasonalEfficiency.accounting.invalidDistance', 'Invalid / too-short distance')],
    ['missingEnergy', t('seasonalEfficiency.accounting.missingEnergy', 'Missing energy')],
    ['invalidEnergy', t('seasonalEfficiency.accounting.invalidEnergy', 'Invalid / non-positive energy')],
    ['implausibleIntensity', t('seasonalEfficiency.accounting.implausibleIntensity', 'Implausible intensity')],
  ] as const;
  return (
    <section data-testid="seasonal-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('seasonalEfficiency.accounting.title', 'Returned-row accounting and recency')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('seasonalEfficiency.accounting.subtitle', 'Categories are mutually exclusive and reconcile exactly across the latest returned history window.')}
        </Text>
        <SeasonalSectionBody state={state}>
          <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {categories.map(([key, label]) => (
                <div key={key} className="rounded-lg border border-[var(--panel-border)] p-2.5">
                  <Text variant="caption">{label}</Text>
                  <Text variant="bodySm" as="p">{analysis.accounting.counts[key]}</Text>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Text variant="bodySm" as="p">{t('seasonalEfficiency.accounting.totals', '{{returned}} returned = {{included}} included + {{excluded}} excluded', {
                returned: analysis.accounting.returnedRows,
                included: analysis.accounting.includedRows,
                excluded: analysis.accounting.excludedRows,
              })}</Text>
              <Text variant="caption" as="p">{t('seasonalEfficiency.accounting.window', 'History window limit: {{limit}} rows', { limit: analysis.accounting.historyLimit })}</Text>
              <Text variant="caption" as="p">{t('seasonalEfficiency.accounting.first', 'First included local date: {{date}}', {
                date: formatLocalDate(analysis.firstIncludedTimestampMs, locale, timeZone),
              })}</Text>
              <Text variant="caption" as="p">{t('seasonalEfficiency.accounting.last', 'Last included local date: {{date}}', {
                date: formatLocalDate(analysis.lastIncludedTimestampMs, locale, timeZone),
              })}</Text>
              <Text variant="caption" as="p">{t('seasonalEfficiency.accounting.energy', '{{energy}} total energy · {{distance}} total distance', {
                energy: units.formatEnergy(analysis.totalEnergyWh, { precision: 1 }),
                distance: units.formatDistance(analysis.totalDistanceM, { precision: 0 }),
              })}</Text>
            </div>
          </div>
          {analysis.accounting.historyCapReached ? (
            <AlertBanner className="mt-4" variant="warning">
              {t('seasonalEfficiency.accounting.capWarning', 'Exactly the latest 1,000-row return window is represented; findings are not established lifetime history.')}
            </AlertBanner>
          ) : null}
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
