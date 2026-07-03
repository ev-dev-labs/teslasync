import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import {
  ChartTooltip, chartGrid, axisTickSm, AREA_DEFAULTS, areaGradient,
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import type { CostForecastData } from '@/types/charging';
import { CostSection } from './CostSection';
import { ForecastDetails } from './ForecastDetails';

interface CostForecastSectionProps {
  forecastData: CostForecastData | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function CostForecastSection({
  forecastData, isLoading, error, onRetry,
}: CostForecastSectionProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const historicalData = forecastData?.historical ?? [];
  const forecast = forecastData?.forecast ?? [];
  const hasForecast = historicalData.length >= 3 && forecast.length > 0;
  const hasCostPerKwhTrend = historicalData.length > 1;

  return (
    <div className="space-y-6">
      {/* Main forecast chart */}
      <CostSection
        title={t('costAnalysis.forecast.title', 'Cost Forecast')}
        icon={<TrendingUp className="h-4 w-4 text-purple-300" aria-hidden="true" />}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        isEmpty={!hasForecast}
        emptyMessage={t('costAnalysis.forecast.needData', 'Need at least 3 months of charging data for cost forecasting.')}
        skeletonHeight={300}
      >
        <div className="h-72 sm:h-80" role="img" aria-label={t('costAnalysis.forecast.chartAria', 'Historical and projected monthly charging cost with confidence band')}>
          <ResponsiveContainer width="100%" height="100%">
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
              {areaGradient('actualCostFill', palette[0], 0.3)}
              <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
              <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit="$" />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Area {...AREA_DEFAULTS} dataKey="ci_low" stackId="ci" stroke="none" fill="transparent" fillOpacity={0} legendType="none" connectNulls={false} />
              <Area {...AREA_DEFAULTS} dataKey="ci_band" stackId="ci" stroke="none" fill="url(#forecastBand)" name={t('costAnalysis.forecast.confidence', '95% Confidence')} connectNulls={false} />
              <Area {...AREA_DEFAULTS} dataKey="actual" stroke={palette[0]} fill="url(#actualCostFill)" name={t('costAnalysis.forecast.actual', 'Actual Cost')} connectNulls={false} />
              <Line {...AREA_DEFAULTS} dataKey="forecast" stroke="#a855f7" strokeDasharray="8 4" name={t('costAnalysis.forecast.projected', 'Projected Cost')} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CostSection>

      <ForecastDetails
        forecastData={forecastData}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
      />

      {/* Cost per kWh trend from forecast historical data */}
      <CostSection
        title={t('costAnalysis.forecast.costPerKwhTrend', 'Cost per kWh Trend')}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        isEmpty={!hasCostPerKwhTrend}
        emptyMessage={t('costAnalysis.forecast.needTrendData', 'Need at least 2 months of charging data to show the cost per kWh trend.')}
        skeletonHeight={200}
      >
        <div className="h-52" role="img" aria-label={t('costAnalysis.forecast.trendAria', 'Monthly average cost per kilowatt-hour trend')}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historicalData}>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
              <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit="$" />
              <Tooltip content={<ChartTooltip />} />
              <Line {...AREA_DEFAULTS} dataKey="cost_per_kwh" stroke="#06b6d4" dot={{ fill: '#06b6d4', r: 3 }} name={t('costAnalysis.forecast.costPerKwh', '$/kWh')} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CostSection>
    </div>
  );
}
