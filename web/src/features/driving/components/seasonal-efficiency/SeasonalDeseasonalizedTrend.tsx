import { CartesianGrid, CHART_COLORS, ChartContainer, ChartTooltip, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatDisplayIntensity, formatLocalDate, toDisplayIntensity } from './formatters';

export function SeasonalDeseasonalizedTrend({
  analysis,
  state,
  locale,
  timeZone,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const data = analysis.timeline.map((row) => ({
    dateKey: `${row.timestampMs}-${row.driveId}`,
    date: formatLocalDate(row.timestampMs, locale, timeZone, { month: 'short', year: '2-digit' }),
    deseasonalized: toDisplayIntensity(row.deseasonalizedEnergyIntensityWhPerM, units.unitPrefs),
  }));
  return (
    <section data-testid="seasonal-deseasonalized-trend">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('seasonalEfficiency.trendSection.title', 'Deseasonalized trend')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t('seasonalEfficiency.trendSection.subtitle', 'Calendar harmonics are removed before the descriptive linear time term is shown; route and operating mix remain in the residual.')}
        </Text>
        <SeasonalSectionBody state={state} requirement="fit" fitStatus={analysis.fit.status}>
          <ChartContainer
            title={t('seasonalEfficiency.trendSection.chartTitle', 'Seasonally adjusted observed intensity')}
            ariaLabel={t('seasonalEfficiency.trendSection.aria', 'Deseasonalized energy intensity over the vehicle-local timeline')}
            height={290}
            data={data}
            dataColumns={[
              { key: 'date', label: t('seasonalEfficiency.trendSection.date', 'Vehicle-local date') },
              { key: 'deseasonalized', label: t('seasonalEfficiency.trendSection.value', 'Deseasonalized intensity'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
            ]}
            empty={data.length === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="dateKey" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} minTickGap={28} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="deseasonalized" name={t('seasonalEfficiency.trendSection.value', 'Deseasonalized intensity')} stroke={CHART_COLORS[1]} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
