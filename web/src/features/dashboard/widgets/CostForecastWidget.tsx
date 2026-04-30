import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
} from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useCostForecast } from '@/api/hooks/useCharging';
import { useSettings } from '@/hooks/useSettings';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { CostHistoricalMonth, CostForecastMonth } from '@/types/charging';

interface BarDatum {
  month: string;
  cost: number;
  isForecast: boolean;
}

function buildChartData(
  historical: CostHistoricalMonth[],
  forecast: CostForecastMonth[],
): BarDatum[] {
  const hist: BarDatum[] = historical.map((h) => ({
    month: h.month ?? '—',
    cost: h.cost ?? 0,
    isForecast: false,
  }));
  const fore: BarDatum[] = forecast.map((f) => ({
    month: f.month ?? '—',
    cost: f.cost ?? 0,
    isForecast: true,
  }));
  return [...hist, ...fore].slice(-6);
}

export default function CostForecastWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? null;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useCostForecast(vid != null ? String(vid) : null);

  const { formatCurrency, currencySymbol } = useSettings();

  const chartData = useMemo(
    () => buildChartData(data?.historical ?? [], data?.forecast ?? []),
    [data],
  );

  const nextForecast = (data?.forecast ?? [])[0];
  const nextCost = nextForecast?.cost ?? 0;

  const hist = data?.historical ?? [];
  const lastHistorical = hist.length > 0 ? hist[hist.length - 1] : undefined;
  const lastCost = lastHistorical?.cost ?? 0;
  const trendUp = nextCost >= lastCost;

  const isCompact = size.cols <= 1;
  const hasData = chartData.length > 0;

  // ── Compact (1×2): big predicted cost + trend ──
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.costForecast.noData', 'No forecast data')}
          emptyIcon={<TrendingUp className="h-5 w-5" />}
          stats={hasData ? [
            {
              label: t('widget.costForecast.nextMonth', 'Next Month'),
              value: formatCurrency(nextCost, 0),
            },
            {
              label: t('widget.costForecast.trend', 'Trend'),
              value: trendUp ? '↑' : '↓',
            },
          ] : []}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×4): stat header + bar chart ──
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.costForecast.nextMonth', 'Next Month'),
          value: formatCurrency(nextCost, 0),
        },
        {
          label: t('widget.costForecast.avgPerKwh', 'Avg $/kWh'),
          value: lastHistorical
            ? formatCurrency(lastHistorical.cost_per_kwh ?? 0, 2)
            : '—',
        },
        {
          label: t('widget.costForecast.trend', 'Trend'),
          value: trendUp
            ? `↑ ${formatCurrency(nextCost - lastCost, 0)}`
            : `↓ ${formatCurrency(lastCost - nextCost, 0)}`,
        },
      ]
    : [];

  const isWide = size.cols >= 3;
  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.costForecast.title', 'Cost Forecast')}
      icon={
        trendUp
          ? <TrendingUp className="h-3.5 w-3.5 text-amber-400" />
          : <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
      }
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.costForecast.noData', 'No forecast data')}
        emptyIcon={<TrendingUp className="h-5 w-5" />}
        stats={stats}
        chart={
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis dataKey="month" tick={tick} tickLine={false} axisLine={false} />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => `${currencySymbol}${fmt(v, 0)}`}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(0,0,0,0.85)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number) => [
                  formatCurrency(value),
                  t('widget.costForecast.costLabel', 'Cost'),
                ]}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar
                dataKey="cost"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                fill="#6366f1"
                name={t('widget.costForecast.costLabel', 'Cost')}
              />
            </BarChart>
          </ResponsiveContainer>
        }
      />
    </WidgetShell>
  );
}
