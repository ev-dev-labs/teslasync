import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
} from '@/components/charts';
import { useTeslaWCChargingHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface ChartDatum {
  date: string;
  energy_kwh: number;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isSameMonth(iso: string): boolean {
  const now = new Date();
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default function WallConnectorWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  // Discover energy sites
  const {
    data: sites,
    isLoading: sitesLoading,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = useTeslaEnergySites();

  const siteId = (sites ?? [])[0]?.energy_site_id;

  // Last 14 days
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
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
  } = useTeslaWCChargingHistory(siteId, since);

  const isLoading = sitesLoading || (!!siteId && historyLoading);
  const error = historyError;
  const isFetching = sitesFetching || historyFetching;
  const isStale = sitesStale || historyStale;
  const isError = sitesIsError || historyIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, historyUpdatedAt ?? 0);

  const hasSites = (sites ?? []).length > 0;

  // Aggregate daily energy (kWh) from individual entries
  const chartData = useMemo<ChartDatum[]>(() => {
    const entries = history ?? [];
    const byDay = new Map<string, number>();
    for (const entry of entries) {
      const day = (entry.timestamp ?? '').slice(0, 10);
      if (!day) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + (entry.energy_wh ?? 0) / 1000);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, kwh]) => ({ date: shortDate(day), energy_kwh: kwh }));
  }, [history]);

  // Stats for current month
  const { monthTotalKwh, monthSessions, avgKwhPerSession } = useMemo(() => {
    const entries = history ?? [];
    const monthEntries = entries.filter((e) => isSameMonth(e.timestamp ?? ''));
    const total = monthEntries.reduce((sum, e) => sum + (e.energy_wh ?? 0) / 1000, 0);
    const count = monthEntries.length;
    return {
      monthTotalKwh: total,
      monthSessions: count,
      avgKwhPerSession: count > 0 ? total / count : 0,
    };
  }, [history]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0 && chartData.some((d) => d.energy_kwh > 0);

  const handleRefresh = () => {
    refetchSites();
    if (siteId) refetchHistory();
  };

  // No energy sites linked
  if (!hasSites && !isLoading) {
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
          emptyMessage={t('widget.wallConnector.noSite', 'No Tesla Energy site linked')}
          emptyIcon={<Plug className="h-5 w-5" />}
          stats={[]}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // Compact (1-col): month total kWh as large number
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
          emptyMessage={t('widget.wallConnector.noData', 'No Wall Connector data')}
          emptyIcon={<Plug className="h-5 w-5" />}
          stats={hasData ? [
            {
              label: t('widget.wallConnector.monthTotal', 'This Month'),
              value: fmtNumber(monthTotalKwh, 1),
              unit: 'kWh',
            },
            {
              label: t('widget.wallConnector.sessions', 'Sessions'),
              value: fmtInt(monthSessions),
            },
          ] : []}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // Standard (2×4+): bar chart + stats
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.wallConnector.monthTotal', 'This Month'),
          value: fmtNumber(monthTotalKwh, 1),
          unit: 'kWh',
        },
        {
          label: t('widget.wallConnector.sessions', 'Sessions'),
          value: fmtInt(monthSessions),
        },
        {
          label: t('widget.wallConnector.avgPerSession', 'Avg / Session'),
          value: fmtNumber(avgKwhPerSession, 1),
          unit: 'kWh',
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.wallConnector.title', 'Wall Connector')}
      icon={<Plug className="h-3.5 w-3.5 text-neon-green" />}
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
        emptyMessage={t('widget.wallConnector.noData', 'No Wall Connector data')}
        emptyIcon={<Plug className="h-5 w-5" />}
        stats={stats}
        chart={
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={chartMargin} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="date"
                tick={tick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => fmt(v, 0)}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(0,0,0,0.85)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number) => [
                  `${fmtNumber(value, 1)} kWh`,
                  t('widget.wallConnector.energy', 'Energy'),
                ]}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar
                dataKey="energy_kwh"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
                name={t('widget.wallConnector.energy', 'Energy')}
              />
            </BarChart>
          </ResponsiveContainer>
        }
      />
    </WidgetShell>
  );
}
