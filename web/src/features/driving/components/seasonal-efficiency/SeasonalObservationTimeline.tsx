import { CartesianGrid, CHART_COLORS, ChartContainer, ChartLegend, ChartTooltip, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatDisplayIntensity, formatLocalDate, toDisplayIntensity } from './formatters';

export function SeasonalObservationTimeline({
  analysis,
  state,
  locale,
  timeZone,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const chartData = analysis.timeline.map((row) => ({
    dateKey: `${row.timestampMs}-${row.driveId}`,
    date: formatLocalDate(row.timestampMs, locale, timeZone, { month: 'short', day: 'numeric' }),
    actual: toDisplayIntensity(row.actualEnergyIntensityWhPerM, units.unitPrefs),
    fitted: toDisplayIntensity(row.fittedEnergyIntensityWhPerM, units.unitPrefs),
    deseasonalized: toDisplayIntensity(row.deseasonalizedEnergyIntensityWhPerM, units.unitPrefs),
  }));
  return (
    <section data-testid="seasonal-observation-timeline">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('seasonalEfficiency.timeline.title', 'Observed-vs-fitted timeline')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t('seasonalEfficiency.timeline.subtitle', 'Rows are ordered by vehicle-local start date; dense histories are deterministically downsampled while retaining first and last observations.')}
        </Text>
        <SeasonalSectionBody state={state}>
          {analysis.includedCount === 0 ? (
            <EmptyState message={t('seasonalEfficiency.states.noTimeline', 'No included observations are available for the timeline.')} />
          ) : (
            <ChartContainer
              title={t('seasonalEfficiency.timeline.chartTitle', 'Drive intensity over returned history')}
              ariaLabel={t('seasonalEfficiency.timeline.aria', 'Observed, fitted, and deseasonalized energy intensity over the vehicle-local observation timeline')}
              chartKey="seasonal-efficiency-timeline"
              height={320}
              data={chartData}
              dataColumns={[
                { key: 'date', label: t('seasonalEfficiency.timeline.date', 'Vehicle-local date') },
                { key: 'actual', label: t('seasonalEfficiency.timeline.actual', 'Observed'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
                { key: 'fitted', label: t('seasonalEfficiency.timeline.fitted', 'Fitted'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
                { key: 'deseasonalized', label: t('seasonalEfficiency.timeline.deseasonalized', 'Deseasonalized'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
              ]}
              empty={chartData.length === 0}
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="dateKey" tickFormatter={(_, index) => chartData[index]?.date ?? ''} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={28} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Line type="monotone" dataKey="actual" name={t('seasonalEfficiency.timeline.actual', 'Observed')} hide={hiddenSeries?.isHidden('actual')} stroke={CHART_COLORS[0]} dot={false} />
                    <Line type="monotone" dataKey="fitted" name={t('seasonalEfficiency.timeline.fitted', 'Fitted')} hide={hiddenSeries?.isHidden('fitted')} stroke={CHART_COLORS[2]} dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="deseasonalized" name={t('seasonalEfficiency.timeline.deseasonalized', 'Deseasonalized')} hide={hiddenSeries?.isHidden('deseasonalized')} stroke={CHART_COLORS[4]} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartContainer>
          )}
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
