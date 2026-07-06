import { useCallback, useMemo } from 'react';
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
  // Daily buckets arrive as a bare calendar date ("2024-03-05") or a full
  // datetime. Read the leading Y-M-D straight off the string so the axis label
  // is timezone-stable: `new Date('2024-03-05')` is UTC midnight and shifts a
  // day earlier when read back with local getters in negative-offset zones.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isSameMonth(iso: string): boolean {
  const now = new Date();
  // Compare the calendar year+month parsed off the ISO string prefix so a
  // UTC-labelled timestamp isn't mis-bucketed a month early/late by local-time
  // getters near a month boundary.
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (m) return Number(m[1]) === now.getFullYear() && Number(m[2]) === now.getMonth() + 1;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default function WallConnectorWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  // Discover energy sites
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
  // Surface a sites-fetch failure too — otherwise a failed discovery falls
  // through to the misleading "no site linked" empty state below.
  const error = sitesError ?? historyError;
  const isFetching = sitesFetching || historyFetching;
  const isStale = sitesStale || historyStale;
  const isError = sitesIsError || historyIsError;
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, historyUpdatedAt ?? 0);

  const hasSites = (sites ?? []).length > 0;

  // Aggregate daily energy (kWh) from individual entries
  const chartData = useMemo<ChartDatum[]>(() => {
    // The backend contract promises an array, but a malformed payload (or a
    // stray null row) must degrade cleanly instead of throwing at `.slice`.
    const entries = Array.isArray(history) ? history : [];
    const byDay = new Map<string, number>();
    for (const entry of entries) {
      const day = (entry?.timestamp ?? '').slice(0, 10);
      if (!day) continue;
      byDay.set(day, (byDay.get(day) ?? 0) + (entry?.energy_wh ?? 0) / 1000);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, kwh]) => ({ date: shortDate(day), energy_kwh: kwh }));
  }, [history]);

  // Stats for current month
  const { monthTotalKwh, monthSessions, avgKwhPerSession } = useMemo(() => {
    // Same defensive coercion as `chartData`: a non-array payload here would
    // otherwise throw at `.filter`, blanking the whole widget.
    const entries = Array.isArray(history) ? history : [];
    const monthEntries = entries.filter((e) => isSameMonth(e?.timestamp ?? ''));
    const total = monthEntries.reduce((sum, e) => sum + (e?.energy_wh ?? 0) / 1000, 0);
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

  const handleRefresh = useCallback(() => {
    refetchSites();
    if (siteId) refetchHistory();
  }, [refetchSites, refetchHistory, siteId]);

  // No energy sites linked. Guard on `!sitesError` so a *failed* sites fetch
  // surfaces the shared error panel (below) rather than this misleading empty
  // state — a fetch failure must be distinguishable from an unlinked site.
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
      icon={<Plug className="h-3.5 w-3.5 text-emerald-400" />}
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
          <div
            role="img"
            aria-label={t(
              'widget.wallConnector.chartLabel',
              'Daily Wall Connector charging energy over the last 14 days',
            )}
            className="h-full w-full"
          >
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
          </div>
        }
      />
    </WidgetShell>
  );
}
