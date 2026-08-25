import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ThermometerSun } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
  ChartLegend, ChartTooltip, EmbeddedChart,
  type ChartDataRow,
} from '@/components/charts';
import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';

interface ChartDatum extends ChartDataRow {
  time: string;
  inside: number | null;
  outside: number | null;
}

function buildChartData(
  data: ReturnType<typeof useClimateHistory>['data'],
  toTemperatureDisplay: (c: number) => number,
): ChartDatum[] {
  const items = data ?? [];
  return items
    .filter((d) => d.created_at || d.timestamp)
    .map((d) => {
      const ts = d.created_at ?? d.timestamp ?? '';
      const inside = d.insideTemp != null ? toTemperatureDisplay(d.insideTemp) : null;
      const outside = d.outsideTemp != null ? toTemperatureDisplay(d.outsideTemp) : null;
      return { time: ts, inside, outside };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

export default function ClimateHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime: formatTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  // Memoise on the primitive unit so the chartData memo below actually caches;
  // an inline arrow would be a new reference every render and defeat it.
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, tempUnit),
    [tempUnit],
  );

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useClimateHistory(vid > 0 ? String(vid) : '');

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const chartData = useMemo(
    () => buildChartData(data, toTemperatureDisplay),
    [data, toTemperatureDisplay],
  );

  const hasData = chartData.length > 0;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const latestInside = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].inside != null) return chartData[i].inside;
    }
    return null;
  }, [chartData]);

  const latestOutside = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].outside != null) return chartData[i].outside;
    }
    return null;
  }, [chartData]);

  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.climateHistory.cabin', 'Cabin'),
          value: latestInside != null ? fmtInt(latestInside) : '—',
          unit: tempUnit,
        },
        {
          label: t('widget.climateHistory.outside', 'Outside'),
          value: latestOutside != null ? fmtInt(latestOutside) : '—',
          unit: tempUnit,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        <WidgetChartSummary
          compact
          isEmpty={!hasData}
          emptyMessage={t('widget.climateHistory.noData', 'No climate history')}
          emptyIcon={<ThermometerSun className="h-5 w-5" />}
          stats={stats}
          chart={null}
        />
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.climateHistory.title', 'Climate History')}
      icon={<ThermometerSun className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.climateHistory.noData', 'No climate history')}
        emptyIcon={<ThermometerSun className="h-5 w-5" />}
        stats={stats}
        chart={
          <EmbeddedChart
            title={t('widget.climateHistory.title', 'Climate History')}
            ariaLabel={t(
              'widget.climateHistory.chartAria',
              'Cabin and outside temperature history',
            )}
            data={chartData}
            dataColumns={[
              { key: 'time', label: t('widget.climateHistory.time', 'Time') },
              { key: 'inside', label: `${t('widget.climateHistory.cabin', 'Cabin')} (${tempUnit})` },
              { key: 'outside', label: `${t('widget.climateHistory.outside', 'Outside')} (${tempUnit})` },
            ]}
            chartKey="dashboard-climate-history"
            className="h-full w-full"
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <defs>
                <linearGradient id="gradInside" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradOutside" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tick={tick}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => formatTime(v)}
              />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={35}
                tickFormatter={(v: number) => `${fmt(v, 0)}°`}
              />
              <Tooltip
                content={<ChartTooltip />}
                labelFormatter={(v: string) => formatTime(v)}
                formatter={(value: number, name: string) => {
                  const label =
                    name === 'inside'
                      ? t('widget.climateHistory.cabin', 'Cabin')
                      : t('widget.climateHistory.outside', 'Outside');
                  return [`${fmtInt(value)}${tempUnit}`, label];
                }}
              />
              <ChartLegend />
              <Area
                type="monotone"
                dataKey="inside"
                stroke="#f97316"
                strokeWidth={2}
                fill="url(#gradInside)"
                connectNulls
                name="inside"
                hide={hiddenSeries?.isHidden('inside')}
              />
              <Area
                type="monotone"
                dataKey="outside"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#gradOutside)"
                connectNulls
                name="outside"
                hide={hiddenSeries?.isHidden('outside')}
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
