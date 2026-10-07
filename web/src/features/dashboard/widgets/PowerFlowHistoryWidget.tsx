import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
  ChartLegend, ChartTooltip, EmbeddedChart, type ChartDataRow,
} from '@/components/charts';
import { useTeslaEnergyLiveStatusHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface ChartDatum extends ChartDataRow {
  time: string;
  solar: number;
  battery: number;
  grid: number;
  home: number;
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function PowerFlowHistoryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const {
    data: sites,
    isLoading: sitesLoading,
    error: sitesError,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;

  const since = useMemo(() => {
    const d = new Date();
    d.setHours(d.getHours() - 24);
    return d.toISOString();
  }, []);

  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
    isFetching: historyFetching,
    isStale: historyStale,
    isError: historyIsError,
    dataUpdatedAt: historyUpdatedAt,
    refetch: refetchHistory,
  } = useTeslaEnergyLiveStatusHistory(siteId, since);

  const isLoading = sitesLoading || (!!siteId && historyLoading);
  const error = sitesError ?? historyError;
  const isFetching = sitesFetching || historyFetching;
  const isStale = sitesStale || historyStale;
  const isError = sitesIsError || historyIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, historyUpdatedAt ?? 0);

  const hasSites = (sites ?? []).length > 0;

  const chartData = useMemo<ChartDatum[]>(() => {
    const items = history ?? [];
    return items.map((entry) => ({
      time: shortTime(entry.timestamp ?? ''),
      solar: (entry.solar_power ?? 0) / 1000,
      battery: (entry.battery_power ?? 0) / 1000,
      grid: (entry.grid_power ?? 0) / 1000,
      home: (entry.load_power ?? 0) / 1000,
    }));
  }, [history]);

  const avgSolarKw = useMemo(() => {
    if (chartData.length === 0) return 0;
    return chartData.reduce((s, d) => s + d.solar, 0) / chartData.length;
  }, [chartData]);

  const peakHomeKw = useMemo(
    () => chartData.reduce((mx, d) => Math.max(mx, d.home), 0),
    [chartData],
  );

  const netGridKwh = useMemo(
    () => chartData.reduce((s, d) => s + d.grid, 0),
    [chartData],
  );

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0 && chartData.some(
    (d) => d.solar !== 0 || d.battery !== 0 || d.grid !== 0 || d.home !== 0,
  );

  const handleRefresh = () => {
    refetchSites();
    if (siteId) refetchHistory();
  };

  // No energy sites linked. Only surface the "no site" empty state when the
  // sites query genuinely returned none — a sites *error* must fall through so
  // the shell can render it, rather than masking a fetch failure behind a
  // misleading "no site linked" message.
  if (!hasSites && !isLoading && !sitesError) {
    return (
      <WidgetShell
        loading={false}
        error={null}
        updatedAt={sitesUpdatedAt}
        isFetching={sitesFetching}
        isStale={sitesStale}
        isError={sitesIsError}
        onRefresh={() => refetchSites()}
      >
        <WidgetChartSummary
          compact={isCompact}
          isEmpty
          emptyMessage={t('widget.powerFlowHistory.noSite', 'No Tesla Energy site linked')}
          emptyIcon={<TrendingUp aria-hidden="true" className="h-5 w-5" />}
          stats={[]}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // Compact (1-col): summary stats only
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={updatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.powerFlowHistory.noData', 'No power flow data')}
          emptyIcon={<TrendingUp aria-hidden="true" className="h-5 w-5" />}
          stats={hasData ? [
            {
              label: t('widget.powerFlowHistory.avgSolar', 'Avg Solar'),
              value: fmtNumber(avgSolarKw, 1),
              unit: 'kW',
            },
            {
              label: t('widget.powerFlowHistory.peakHome', 'Peak Home'),
              value: fmtNumber(peakHomeKw, 1),
              unit: 'kW',
            },
          ] : []}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // Standard (2×4+): stat header + stacked area chart
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.powerFlowHistory.avgSolar', 'Avg Solar'),
          value: fmtNumber(avgSolarKw, 1),
          unit: 'kW',
        },
        {
          label: t('widget.powerFlowHistory.peakHome', 'Peak Home'),
          value: fmtNumber(peakHomeKw, 1),
          unit: 'kW',
        },
        {
          label: t('widget.powerFlowHistory.netGrid', 'Net Grid'),
          value: fmtNumber(netGridKwh, 1),
          unit: 'kW',
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;
  const widgetId = 'pfh';

  return (
    <WidgetShell
      title={t('widget.powerFlowHistory.title', 'Power Flow History')}
      icon={<TrendingUp aria-hidden="true" className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.powerFlowHistory.noData', 'No power flow data')}
        emptyIcon={<TrendingUp aria-hidden="true" className="h-5 w-5" />}
        stats={stats}
        chart={
          <EmbeddedChart
            title={t('widget.powerFlowHistory.title', 'Power Flow History')}
            ariaLabel={t(
              'widget.powerFlowHistory.chartAria',
              'Solar, battery, grid, and home power over the last 24 hours',
            )}
            data={chartData}
            dataColumns={[
              { key: 'time', label: t('widget.powerFlowHistory.time', 'Time') },
              { key: 'solar', label: t('widget.powerFlowHistory.solar', 'Solar (kW)') },
              { key: 'battery', label: t('widget.powerFlowHistory.battery', 'Battery (kW)') },
              { key: 'grid', label: t('widget.powerFlowHistory.grid', 'Grid (kW)') },
              { key: 'home', label: t('widget.powerFlowHistory.home', 'Home (kW)') },
            ]}
            chartKey="dashboard-power-flow-history"
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="time"
                tick={tick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => fmt(v, 1)}
              />
              <Tooltip
                content={<ChartTooltip />}
                formatter={(value: number, name: string) => [
                  `${fmtNumber(value, 2)} kW`,
                  name,
                ]}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <ChartLegend />
              <defs>
                <linearGradient id={`${widgetId}-solarGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#facc15" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${widgetId}-batteryGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${widgetId}-gridGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${widgetId}-homeGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#9ca3af" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#9ca3af" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="solar"
                stackId="1"
                stroke="#facc15"
                strokeWidth={2}
                fill={`url(#${widgetId}-solarGrad)`}
                name={t('widget.powerFlowHistory.solar', 'Solar')}
                hide={hiddenSeries?.isHidden('solar')}
              />
              <Area
                type="monotone"
                dataKey="battery"
                stackId="1"
                stroke="#22c55e"
                strokeWidth={2}
                fill={`url(#${widgetId}-batteryGrad)`}
                name={t('widget.powerFlowHistory.battery', 'Battery')}
                hide={hiddenSeries?.isHidden('battery')}
              />
              <Area
                type="monotone"
                dataKey="grid"
                stackId="1"
                stroke="#3b82f6"
                strokeWidth={2}
                fill={`url(#${widgetId}-gridGrad)`}
                name={t('widget.powerFlowHistory.grid', 'Grid')}
                hide={hiddenSeries?.isHidden('grid')}
              />
              <Area
                type="monotone"
                dataKey="home"
                stackId="1"
                stroke="#9ca3af"
                strokeWidth={2}
                fill={`url(#${widgetId}-homeGrad)`}
                name={t('widget.powerFlowHistory.home', 'Home')}
                hide={hiddenSeries?.isHidden('home')}
              />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
