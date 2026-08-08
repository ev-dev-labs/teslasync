import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { SeasonalEmpty } from './SeasonalEmpty';
import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatInteger } from './formatters';

export function SeasonalCalendarCoverage({
  analysis,
  state,
  locale,
  timeZone,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  return (
    <section data-testid="seasonal-calendar-coverage">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('seasonalEfficiency.calendar.title', 'Vehicle-local calendar coverage')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'seasonalEfficiency.calendar.subtitle',
            'Month and date fields use the vehicle IANA timezone, including DST boundaries.',
          )}
        </Text>
        <SeasonalSectionBody state={state}>
          {analysis.includedCount === 0 ? (
            <SeasonalEmpty message={t(
              analysis.returnedCount === 0
                ? 'seasonalEfficiency.states.empty'
                : 'seasonalEfficiency.states.noQualified',
              analysis.returnedCount === 0
                ? 'No drives were returned for this vehicle.'
                : 'No returned rows met the completed-drive and Wh/m eligibility rules.',
            )} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-[var(--panel-border)] p-3">
                <Text variant="metricLabel">{t('seasonalEfficiency.calendar.months', 'Calendar months')}</Text>
                <Text variant="metricValue" as="p">{analysis.localMonthCoverage} / 12</Text>
                <Text variant="caption">{t('seasonalEfficiency.calendar.monthHint', 'distinct months of year')}</Text>
              </div>
              <div className="rounded-lg border border-[var(--panel-border)] p-3">
                <Text variant="metricLabel">{t('seasonalEfficiency.calendar.span', 'Observed span')}</Text>
                <Text variant="metricValue" as="p">{formatInteger(analysis.spanDays, locale)} d</Text>
                <Text variant="caption">{t('seasonalEfficiency.calendar.spanHint', 'first to last included start')}</Text>
              </div>
              <div className="rounded-lg border border-[var(--panel-border)] p-3">
                <Text variant="metricLabel">{t('seasonalEfficiency.calendar.active', 'Active local periods')}</Text>
                <Text variant="metricValue" as="p">{analysis.activeLocalDays} / {analysis.activeLocalWeeks}</Text>
                <Text variant="caption">{t('seasonalEfficiency.calendar.activeHint', 'days / weeks')}</Text>
              </div>
              <div className="rounded-lg border border-[var(--panel-border)] p-3">
                <Text variant="metricLabel">{t('seasonalEfficiency.calendar.zone', 'Timezone')}</Text>
                <Text variant="metricValue" as="p" className="truncate">{timeZone}</Text>
                <Text variant="caption">{t('seasonalEfficiency.calendar.rows', '{{count}} included rows', { count: analysis.includedCount })}</Text>
              </div>
            </div>
          )}
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
