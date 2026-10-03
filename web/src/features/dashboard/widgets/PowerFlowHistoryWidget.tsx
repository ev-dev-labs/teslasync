import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartLegend, ChartTooltip, EmbeddedChart, type ChartDataRow } from '@/components/charts';
import { useTeslaEnergyLiveStatusHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { averageKnown, knownNumber } from '@/api/dataState';
import { DataProvenanceBadge } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { convertPowerFromSI } from '@/lib/unitConversion';

import { chartTokens } from '@/lib/tokens';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ChartDatum extends ChartDataRow {
  time: string;
  solar: number | null;
  battery: number | null;
  grid: number | null;
  home: number | null;
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export default function PowerFlowHistoryWidget({ size }: WidgetProps) {
  const { fmtNumber: fmt } = useNumberFormatting();
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const widgetId = useId();

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
  const updatedAt = siteId ? historyUpdatedAt : sitesUpdatedAt;

  const hasSites = (sites ?? []).length > 0;

  const chartData = useMemo<ChartDatum[]>(() => {
    const items = Array.isArray(history) ? history.filter((entry) => entry != null) : [];
    return items.map((entry) => {
      const solar = knownNumber(entry.solar_power);
      const battery = knownNumber(entry.battery_power);
      const grid = knownNumber(entry.grid_power);
      const home = knownNumber(entry.load_power);
      return {
        time: shortTime(entry.timestamp ?? ''),
        solar: solar == null ? null : convertPowerFromSI(solar, unitPrefs.power),
        battery: battery == null ? null : convertPowerFromSI(battery, unitPrefs.power),
        grid: grid == null ? null : convertPowerFromSI(grid, unitPrefs.power),
        home: home == null ? null : convertPowerFromSI(home, unitPrefs.power),
      };
    });
  }, [history, unitPrefs.power]);

  const avgSolarKw = useMemo(() => averageKnown(chartData.map((d) => d.solar)), [chartData]);

  const peakHomeKw = useMemo(
    () => chartData.reduce<number | null>((mx, d) => d.home == null ? mx : mx == null ? d.home : Math.max(mx, d.home), null),
    [chartData],
  );

  // A sum of sampled power is neither net power nor energy. Report the
  // observed sample mean without inventing a sampling interval.
  const avgGridPower = useMemo(
    () => averageKnown(chartData.map((d) => d.grid)),
    [chartData],
  );

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0;

  const handleRefresh = () => {
    refetchSites();
    if (siteId) refetchHistory();
  };
  const dataState = useDataState({
    data: siteId ? history ?? (isLoading || isError || error ? undefined : null)
      : isLoading || isError || error ? undefined : sites ?? null,
    error,
    isError,
    isFetching,
    dataUpdatedAt: siteId ? historyUpdatedAt : sitesUpdatedAt,
    refetch: handleRefresh,
  }, { provenance: 'historical', partial: chartData.some((d) => [d.solar, d.battery, d.grid, d.home].some((value) => value == null)) });
  const shellProps = {
    title: t('widget.powerFlowHistory.title', 'Power flow history'),
    icon: <TrendingUp aria-hidden="true" className="h-3.5 w-3.5 text-cyan-400" />,
  };

  // No energy sites linked. Only surface the "no site" empty state when the
  // sites query genuinely returned none — a sites *error* must fall through so
  // the shell can render it, rather than masking a fetch failure behind a
  // misleading "no site linked" message.
  if (!hasSites && !isLoading && !sitesError) {
    return (
      <WidgetShell
        {...(isCompact ? shellProps : {})}
        loading={false}
        dataState={dataState}
        updatedAt={sitesUpdatedAt}
        isFetching={sitesFetching}
        isStale={sitesStale}
        isError={sitesIsError}
        onRefresh={() => refetchSites()}
      >
        <WidgetChartSummary
          compact={isCompact}
          isEmpty
          emptyMessage={t('widget.powerFlowHistory.noSite', 'No Tesla energy site linked')}
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
        {...shellProps}
        loading={isLoading}
        dataState={dataState}
        loadingContent={<Skeleton className="h-full min-h-16 rounded-shape-sm" />}
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
              label: t('widget.powerFlowHistory.avgSolar', 'Avg solar'),
              value: avgSolarKw == null ? null : fmtNumber(avgSolarKw),
              unit: unitPrefs.power,
            },
            {
              label: t('widget.powerFlowHistory.peakHome', 'Peak home'),
              value: peakHomeKw == null ? null : fmtNumber(peakHomeKw),
              unit: unitPrefs.power,
            },
          ] : []}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // Standard (2×4+): stat header + independent signed power series.
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.powerFlowHistory.avgSolar', 'Avg solar'),
          value: avgSolarKw == null ? null : fmtNumber(avgSolarKw),
          unit: unitPrefs.power,
        },
        {
          label: t('widget.powerFlowHistory.peakHome', 'Peak home'),
          value: peakHomeKw == null ? null : fmtNumber(peakHomeKw),
          unit: unitPrefs.power,
        },
        {
          label: t('widget.powerFlowHistory.avgNetGrid', 'Avg net grid'),
          value: avgGridPower == null ? null : fmtNumber(avgGridPower),
          unit: unitPrefs.power,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      {...shellProps}
      loading={isLoading}
      dataState={dataState}
      loadingContent={<Skeleton className="h-full min-h-24 rounded-shape-sm" />}
      status={<DataProvenanceBadge provenance={dataState.provenance} status={dataState.status} />}
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
            title={t('widget.powerFlowHistory.title', 'Power flow history')}
            ariaLabel={t(
              'widget.powerFlowHistory.chartAria',
              'Solar, battery, grid, and home power over the last 24 hours',
            )}
            data={chartData}
            dataColumns={[
              { key: 'time', label: t('widget.powerFlowHistory.time', 'Time') },
              { key: 'solar', label: `${t('widget.powerFlowHistory.solar', 'Solar')} (${unitPrefs.power})` },
              { key: 'battery', label: `${t('widget.powerFlowHistory.battery', 'Battery')} (${unitPrefs.power})` },
              { key: 'grid', label: `${t('widget.powerFlowHistory.grid', 'Grid')} (${unitPrefs.power})` },
              { key: 'home', label: `${t('widget.powerFlowHistory.home', 'Home')} (${unitPrefs.power})` },
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
                tickFormatter={(v: number) => fmt(v)}
              />
              <Tooltip
                content={<ChartTooltip />}
                formatter={(value: number, name: string) => [
                  `${fmtNumber(value)} ${unitPrefs.power}`,
                  name,
                ]}
                cursor={{ fill: chartTokens.gridStroke }}
              />
              <ChartLegend />
              <defs>
                <linearGradient id={`${widgetId}-solarGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartTokens.series[2]} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={chartTokens.series[2]} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${widgetId}-batteryGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartTokens.series[1]} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={chartTokens.series[1]} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${widgetId}-gridGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartTokens.series[0]} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={chartTokens.series[0]} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${widgetId}-homeGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartTokens.tooltipMutedText} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={chartTokens.tooltipMutedText} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="solar"
                stroke={chartTokens.series[2]}
                strokeWidth={2}
                fill={`url(#${widgetId}-solarGrad)`}
                name={t('widget.powerFlowHistory.solar', 'Solar')}
                hide={hiddenSeries?.isHidden('solar')}
              />
              <Area
                type="monotone"
                dataKey="battery"
                stroke={chartTokens.series[1]}
                strokeWidth={2}
                fill={`url(#${widgetId}-batteryGrad)`}
                name={t('widget.powerFlowHistory.battery', 'Battery')}
                hide={hiddenSeries?.isHidden('battery')}
              />
              <Area
                type="monotone"
                dataKey="grid"
                stroke={chartTokens.series[0]}
                strokeWidth={2}
                fill={`url(#${widgetId}-gridGrad)`}
                name={t('widget.powerFlowHistory.grid', 'Grid')}
                hide={hiddenSeries?.isHidden('grid')}
              />
              <Area
                type="monotone"
                dataKey="home"
                stroke={chartTokens.tooltipMutedText}
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
