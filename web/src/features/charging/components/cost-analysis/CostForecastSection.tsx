import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import {
  ChartTooltip, chartGrid, axisTickSm,
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
  CHART_COLORS,
} from '@/components/charts';
import type { CostForecastData } from '@/types/charging';
import { ForecastDetails } from './ForecastDetails';

interface CostForecastSectionProps {
  forecastData: CostForecastData | undefined;
}

export function CostForecastSection({ forecastData }: CostForecastSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Main forecast chart */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <TrendingUp className="h-4 w-4 text-neon-purple" />
            {t('costAnalysis.forecast.title', 'Cost Forecast')}
          </h3>
          {(forecastData?.historical ?? []).length >= 3 && (forecastData?.forecast ?? []).length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart
                data={[
                  ...(forecastData?.historical ?? []).map((h) => ({
                    month: h.month,
                    actual: h.cost,
                    forecast: undefined as number | undefined,
                    ci_low: undefined as number | undefined,
                    ci_band: undefined as number | undefined,
                  })),
                  ...(forecastData?.forecast ?? []).map((f) => ({
                    month: f.month,
                    actual: undefined as number | undefined,
                    forecast: f.cost,
                    ci_low: f.cost_low,
                    ci_band: Math.max(0, f.cost_high - f.cost_low),
                  })),
                ]}
              >
                <CartesianGrid {...chartGrid} />
                <defs>
                  <linearGradient id="forecastBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#a855f7" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="actualCostFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit="$" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Area type="monotone" dataKey="ci_low" stackId="ci" stroke="none" fill="transparent" fillOpacity={0} legendType="none" />
                <Area type="monotone" dataKey="ci_band" stackId="ci" stroke="none" fill="url(#forecastBand)" name={t('costAnalysis.forecast.confidence', '95% Confidence')} connectNulls={false} />
                <Area type="monotone" dataKey="actual" stroke={CHART_COLORS[0]} fill="url(#actualCostFill)" strokeWidth={2} name={t('costAnalysis.forecast.actual', 'Actual Cost')} connectNulls={false} />
                <Line type="monotone" dataKey="forecast" stroke="#a855f7" strokeWidth={2} strokeDasharray="8 4" dot={false} name={t('costAnalysis.forecast.projected', 'Projected Cost')} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('costAnalysis.forecast.needData', 'Need at least 3 months of charging data for cost forecasting.')} />
          )}
        </GlassPanel>
      </FadeIn>

      <ForecastDetails forecastData={forecastData} />

      {/* Cost per kWh trend from forecast historical data */}
      {(forecastData?.historical ?? []).length > 1 && (
        <FadeIn>
          <GlassPanel className="p-6">
            <h3 className="mb-4 text-sm font-semibold text-white">
              {t('costAnalysis.forecast.costPerKwhTrend', 'Cost per kWh Trend')}
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={forecastData?.historical ?? []}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit="$" />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="cost_per_kwh" stroke="#06b6d4" strokeWidth={2} dot={{ fill: '#06b6d4', r: 3 }} name={t('costAnalysis.forecast.costPerKwh', '$/kWh')} />
              </LineChart>
            </ResponsiveContainer>
          </GlassPanel>
        </FadeIn>
      )}
    </>
  );
}
