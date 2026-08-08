import { Bar, BarChart, CartesianGrid, CHART_COLORS, ChartContainer, ChartLegend, ChartTooltip, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatDisplayDistance, formatMonth } from './formatters';

export function SeasonalMonthSupport({
  analysis,
  state,
  locale,
  timeZone,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const data = analysis.months.map((month) => ({
    monthKey: `${month.month}-${formatMonth(month.month, locale, timeZone)}`,
    samples: month.sampleCount,
    distance: convertDistanceFromSI(month.distanceM, units.unitPrefs.distance),
  }));
  return (
    <section data-testid="seasonal-month-support">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('seasonalEfficiency.monthSupport.title', 'Month support and distance profile')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t('seasonalEfficiency.monthSupport.subtitle', 'Volume is evidence support, not a ranking of seasonal magnitude; distance uses the selected display unit.')}
        </Text>
        <SeasonalSectionBody state={state}>
          {analysis.includedCount === 0 ? (
            <EmptyState message={t('seasonalEfficiency.monthSupport.empty', 'No included rows are available for month support.')} />
          ) : (
            <ChartContainer
              title={t('seasonalEfficiency.monthSupport.chartTitle', 'Included samples and observed distance')}
              ariaLabel={t('seasonalEfficiency.monthSupport.aria', 'Included sample count and observed distance by vehicle-local calendar month')}
              chartKey="seasonal-efficiency-month-support"
              height={280}
              data={data}
              dataColumns={[
                { key: 'monthKey', label: t('seasonalEfficiency.monthSupport.month', 'Month') },
                { key: 'samples', label: t('seasonalEfficiency.monthSupport.samples', 'Samples') },
                { key: 'distance', label: t('seasonalEfficiency.monthSupport.distance', 'Distance'), format: (value) => formatDisplayDistance(typeof value === 'number' ? value : null, units.unitPrefs) },
              ]}
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="monthKey" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Bar dataKey="samples" name={t('seasonalEfficiency.monthSupport.samples', 'Samples')} hide={hiddenSeries?.isHidden('samples')} fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="distance" name={t('seasonalEfficiency.monthSupport.distance', 'Distance')} hide={hiddenSeries?.isHidden('distance')} fill={CHART_COLORS[4]} radius={[3, 3, 0, 0]} />
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
