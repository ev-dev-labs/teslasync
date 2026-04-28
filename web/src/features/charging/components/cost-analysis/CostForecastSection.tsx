import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import {
  ChartTooltip, chartGrid, axisTickSm, AREA_DEFAULTS, areaGradient,
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
  const historicalData = forecastData?.historical ?? [];
  const forecast = forecastData?.forecast ?? [];
  const hasForecast = historicalData.length >= 3 && forecast.length > 0;
  const hasCostPerKwhTrend = historicalData.length > 1;

  return (
    <>
      {/* Main forecast chart */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <TrendingUp className="h-4 w-4 text-neon-purple" />
            {t('costAnalysis.forecast.title', 'Cost Forecast')}
          </h3>
          {hasForecast ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart
                data={[
                  ...historicalData.map((h) => ({
                    month: h.month,
                    actual: h.cost,
                    forecast: undefined as number | undefined,
                    ci_low: undefined as number | undefined,
                    ci_band: undefined as number | undefined,
                  })),
                  ...forecast.map((f) => ({
                    month: f.month,
                    actual: undefined as number | undefined,
                    forecast: f.cost,
                    ci_low: f.cost_low,
                    ci_band: Math.max(0, f.cost_high - f.cost_low),
                  })),
                ]}
              >
                <CartesianGrid {...chartGrid} />
                {areaGradient('forecastBand', '#a855f7', 0.15)}
                {areaGradient('actualCostFill', CHART_COLORS[0], 0.3)}
                <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit="$" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Area {...AREA_DEFAULTS} dataKey="ci_low" stackId="ci" stroke="none" fill="transparent" fillOpacity={0} legendType="none" connectNulls={false} />
                <Area {...AREA_DEFAULTS} dataKey="ci_band" stackId="ci" stroke="none" fill="url(#forecastBand)" name={t('costAnalysis.forecast.confidence', '95% Confidence')} connectNulls={false} />
                <Area {...AREA_DEFAULTS} dataKey="actual" stroke={CHART_COLORS[0]} fill="url(#actualCostFill)" name={t('costAnalysis.forecast.actual', 'Actual Cost')} connectNulls={false} />
                <Line {...AREA_DEFAULTS} dataKey="forecast" stroke="#a855f7" strokeDasharray="8 4" name={t('costAnalysis.forecast.projected', 'Projected Cost')} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('costAnalysis.forecast.needData', 'Need at least 3 months of charging data for cost forecasting.')} />
          )}
        </GlassPanel>
      </FadeIn>

      <ForecastDetails forecastData={forecastData} />

      {/* Cost per kWh trend from forecast historical data */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-white">
            {t('costAnalysis.forecast.costPerKwhTrend', 'Cost per kWh Trend')}
          </h3>
          {hasCostPerKwhTrend ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={historicalData}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit="$" />
                <Tooltip content={<ChartTooltip />} />
                <Line {...AREA_DEFAULTS} dataKey="cost_per_kwh" stroke="#06b6d4" dot={{ fill: '#06b6d4', r: 3 }} name={t('costAnalysis.forecast.costPerKwh', '$/kWh')} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('costAnalysis.forecast.needTrendData', 'Need at least 2 months of charging data to show the cost per kWh trend.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </>
  );
}
