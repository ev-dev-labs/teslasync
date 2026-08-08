import { Bar, BarChart, CartesianGrid, ChartContainer, CHART_COLORS, ChartLegend, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatDisplayIntensity, formatMonth, toDisplayIntensity } from './formatters';

export function SeasonalMonthProfile({
  analysis,
  state,
  locale,
  timeZone,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const chartData = analysis.months.map((month) => ({
    monthKey: `${month.month}-${formatMonth(month.month, locale, timeZone)}`,
    observed: toDisplayIntensity(month.observedEnergyIntensityWhPerM, units.unitPrefs),
    fitted: toDisplayIntensity(month.fittedEnergyIntensityWhPerM, units.unitPrefs),
    samples: month.sampleCount,
  }));
  return (
    <section data-testid="seasonal-month-profile">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-green-300" aria-hidden="true" />
          {t('seasonalEfficiency.monthProfile.title', 'Observed local-month profile')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t('seasonalEfficiency.monthProfile.subtitle', 'Observed intensity and fitted month averages remain descriptive; month volume is shown alongside each point.')}
        </Text>
        <SeasonalSectionBody state={state}>
          {analysis.includedCount === 0 ? (
            <EmptyState message={t('seasonalEfficiency.states.noMonthProfile', 'No included rows are available for a local-month profile.')} />
          ) : (
            <ChartContainer
              title={t('seasonalEfficiency.monthProfile.chartTitle', 'Twelve local calendar months')}
              ariaLabel={t('seasonalEfficiency.monthProfile.aria', 'Observed and fitted intensity by vehicle-local calendar month')}
              chartKey="seasonal-efficiency-month-profile"
              height={300}
              data={chartData}
              dataColumns={[
                { key: 'monthKey', label: t('seasonalEfficiency.monthProfile.month', 'Month') },
                { key: 'observed', label: t('seasonalEfficiency.monthProfile.observed', 'Observed'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
                { key: 'fitted', label: t('seasonalEfficiency.monthProfile.fitted', 'Fitted'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
                { key: 'samples', label: t('seasonalEfficiency.monthProfile.samples', 'Samples') },
              ]}
              empty={chartData.every((row) => row.observed == null && row.fitted == null)}
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="monthKey" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Bar dataKey="observed" name={t('seasonalEfficiency.monthProfile.observed', 'Observed')} hide={hiddenSeries?.isHidden('observed')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="fitted" name={t('seasonalEfficiency.monthProfile.fitted', 'Fitted')} hide={hiddenSeries?.isHidden('fitted')} fill={CHART_COLORS[2]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartContainer>
          )}
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
