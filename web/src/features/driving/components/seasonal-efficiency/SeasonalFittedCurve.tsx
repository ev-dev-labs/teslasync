import { Area, AreaChart, CartesianGrid, ChartContainer, CHART_COLORS, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ChartTooltip } from '@/components/charts';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useTranslation } from 'react-i18next';
import { Waves } from 'lucide-react';

import { SeasonalSectionBody } from './SeasonalSectionBody';
import type { SeasonalSectionProps } from './types';
import { formatDisplayIntensity, toDisplayIntensity } from './formatters';

export function SeasonalFittedCurve({
  analysis,
  state,
  units,
}: SeasonalSectionProps) {
  const { t } = useTranslation();
  const chartData = analysis.curve.map((point) => ({
    day: point.dayOfYear,
    fitted: toDisplayIntensity(point.fittedEnergyIntensityWhPerM, units.unitPrefs),
    lower: toDisplayIntensity(point.lowerEnergyIntensityWhPerM, units.unitPrefs),
    band: point.upperEnergyIntensityWhPerM == null || point.lowerEnergyIntensityWhPerM == null
      ? null
      : toDisplayIntensity(
          point.upperEnergyIntensityWhPerM - point.lowerEnergyIntensityWhPerM,
          units.unitPrefs,
        ),
  }));
  return (
    <section data-testid="seasonal-fitted-curve">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Waves className="h-4 w-4 text-purple-300" aria-hidden="true" />
          {t('seasonalEfficiency.curve.title', 'Fitted annual curve and residual band')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t('seasonalEfficiency.curve.subtitle', 'A distance-weighted descriptive harmonic fit across local calendar day; the shaded band is the central residual range.')}
        </Text>
        <SeasonalSectionBody state={state} requirement="fit" fitStatus={analysis.fit.status}>
          {/* chart-legend-audit:skip transparent lower offset and residual width form one fitted uncertainty band and cannot be hidden independently */}
          <ChartContainer
            title={t('seasonalEfficiency.curve.chartTitle', '365-day fitted intensity')}
            subtitle={t('seasonalEfficiency.curve.chartSubtitle', 'Values are converted from canonical Wh/m at display time.')}
            ariaLabel={t('seasonalEfficiency.curve.aria', 'Fitted annual Wh per distance curve with a central residual band')}
            chartKey="seasonal-efficiency-fitted-curve"
            height={310}
            data={chartData}
            dataColumns={[
              { key: 'day', label: t('seasonalEfficiency.curve.day', 'Local calendar day') },
              { key: 'fitted', label: t('seasonalEfficiency.curve.fitted', 'Fitted intensity'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
              { key: 'lower', label: t('seasonalEfficiency.curve.lower', 'Band lower'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
              { key: 'band', label: t('seasonalEfficiency.curve.band', 'Band width'), format: (value) => formatDisplayIntensity(typeof value === 'number' ? value : null, units.unitPrefs) },
            ]}
            empty={chartData.length === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="lower" stackId="band" stroke="transparent" fill="transparent" />
                <Area type="monotone" dataKey="band" stackId="band" stroke="transparent" fill={CHART_COLORS[3]} fillOpacity={0.18} />
                <Line type="monotone" dataKey="fitted" name={t('seasonalEfficiency.curve.fitted', 'Fitted intensity')} stroke={CHART_COLORS[2]} dot={false} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </SeasonalSectionBody>
      </GlassPanel>
    </section>
  );
}
