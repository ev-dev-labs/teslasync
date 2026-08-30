import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import {
  ChartLegend, ChartTooltip, EmbeddedChart, chartGrid, axisTickSm, AREA_DEFAULTS, areaGradient,
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, type ChartDataRow,
} from '@/components/charts';
import { useChartPalette } from '@/hooks/useChartPalette';
import { useFormatting } from '@/hooks/useFormatting';
import type { CostForecastData } from '@/types/charging';
import { CostSection } from './CostSection';
import { ForecastDetails } from './ForecastDetails';

interface CostForecastSectionProps {
  forecastData: CostForecastData | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

/**
 * One row of the historical + projected composed chart. Every numeric series is
 * optional so a month contributes only the series it owns — historical months
 * carry `actual`, projected months carry `forecast` plus the stacked confidence
 * band (`ci_low` base + `ci_band` height) — leaving the rest as gaps under
 * `connectNulls={false}`.
 */
interface ForecastChartRow extends ChartDataRow {
  month: string;
  actual?: number;
  forecast?: number;
  ci_low?: number;
  ci_band?: number;
  ci_high?: number;
}

export function CostForecastSection({
  forecastData, isLoading, error, onRetry,
}: CostForecastSectionProps) {
  const { t } = useTranslation();
  const palette = useChartPalette();
  const { currencySymbol } = useFormatting();
  const historicalData = forecastData?.historical ?? [];
  const forecast = forecastData?.forecast ?? [];
  const hasForecast = historicalData.length >= 3 && forecast.length > 0;
  const hasCostPerKwhTrend = historicalData.length > 1;

  // Merge history + projection onto one shared month axis. Memoised so the row
  // array (and its per-month objects) keeps a stable reference across renders
  // instead of being rebuilt inline in the chart's props. The confidence band
  // is guarded against malformed rows: a missing / non-finite bound would
  // otherwise turn `cost_high - cost_low` into NaN and inject a broken segment
  // into the stacked <Area>, so such rows drop the band rather than corrupt it.
  const chartData = useMemo<ForecastChartRow[]>(() => [
    ...historicalData.map((h) => ({ month: h.month, actual: h.cost })),
    ...forecast.map((f) => {
      const low = f.cost_low;
      const high = f.cost_high;
      const hasBand = Number.isFinite(low) && Number.isFinite(high);
      return {
        month: f.month,
        forecast: f.cost,
        ci_low: hasBand ? low : undefined,
        ci_band: hasBand ? Math.max(0, high - low) : undefined,
        ci_high: hasBand ? high : undefined,
      };
    }),
  ], [historicalData, forecast]);

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
        <EmbeddedChart
          title={t('costAnalysis.forecast.title', 'Cost Forecast')}
          ariaLabel={t('costAnalysis.forecast.chartAria', 'Historical and projected monthly charging cost with confidence band')}
          data={chartData}
          dataColumns={[
            { key: 'month', label: t('costAnalysis.forecast.month', 'Month') },
            { key: 'actual', label: t('costAnalysis.forecast.actual', 'Actual Cost') },
            { key: 'forecast', label: t('costAnalysis.forecast.projected', 'Projected Cost') },
            { key: 'ci_low', label: t('costAnalysis.forecast.lowerBound', 'Lower bound') },
            { key: 'ci_high', label: t('costAnalysis.forecast.upperBound', 'Upper bound') },
          ]}
          chartKey="cost-analysis-forecast"
          fluid={false}
          mobileHeight={288}
          height={320}
        >
          {({ hiddenSeries }) => (
            <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid {...chartGrid} />
              {areaGradient('forecastBand', '#a855f7', 0.15)}
              {areaGradient('actualCostFill', palette[0], 0.3)}
              <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
              <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit={currencySymbol} />
              <Tooltip content={<ChartTooltip />} />
              <ChartLegend />
              <Area {...AREA_DEFAULTS} dataKey="ci_low" stackId="ci" stroke="none" fill="transparent" fillOpacity={0} legendType="none" connectNulls={false} hide={hiddenSeries?.isHidden('ci_band')} />
              <Area {...AREA_DEFAULTS} dataKey="ci_band" stackId="ci" stroke="none" fill="url(#forecastBand)" name={t('costAnalysis.forecast.confidence', '95% Confidence')} connectNulls={false} hide={hiddenSeries?.isHidden('ci_band')} />
              <Area {...AREA_DEFAULTS} dataKey="actual" stroke={palette[0]} fill="url(#actualCostFill)" name={t('costAnalysis.forecast.actual', 'Actual Cost')} connectNulls={false} hide={hiddenSeries?.isHidden('actual')} />
              <Line {...AREA_DEFAULTS} dataKey="forecast" stroke="#a855f7" strokeDasharray="8 4" name={t('costAnalysis.forecast.projected', 'Projected Cost')} connectNulls={false} hide={hiddenSeries?.isHidden('forecast')} />
            </ComposedChart>
            </ResponsiveContainer>
          )}
        </EmbeddedChart>
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
        <EmbeddedChart
          title={t('costAnalysis.forecast.costPerKwhTrend', 'Cost per kWh Trend')}
          ariaLabel={t('costAnalysis.forecast.trendAria', 'Monthly average cost per kilowatt-hour trend')}
          data={historicalData.map(({ month, cost_per_kwh }) => ({ month, cost_per_kwh }))}
          dataColumns={[
            { key: 'month', label: t('costAnalysis.forecast.month', 'Month') },
            { key: 'cost_per_kwh', label: t('costAnalysis.forecast.costPerKwh', '$/kWh') },
          ]}
          fluid={false}
          height={208}
          mobileHeight={208}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historicalData}>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
              <YAxis tick={axisTickSm} tickLine={false} axisLine={false} unit={currencySymbol} />
              <Tooltip content={<ChartTooltip />} />
              <Line {...AREA_DEFAULTS} dataKey="cost_per_kwh" stroke="#06b6d4" dot={{ fill: '#06b6d4', r: 3 }} name={t('costAnalysis.forecast.costPerKwh', '$/kWh')} />
            </LineChart>
          </ResponsiveContainer>
        </EmbeddedChart>
      </CostSection>
    </div>
  );
}
