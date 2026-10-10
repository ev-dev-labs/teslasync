import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, EmbeddedChart, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { useTeslaWCChargingHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { averageKnown, knownNumber, sumKnown } from '@/api/dataState';
import { DataProvenanceBadge } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { Caption } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { convertEnergyFromSI } from '@/lib/unitConversion';

import { chartTokens } from '@/lib/tokens';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ChartDatum extends ChartDataRow {
  date: string;
  energy_kwh: number | null;
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
  const { fmtNumber: fmt } = useNumberFormatting();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();

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
  const updatedAt = siteId ? historyUpdatedAt : sitesUpdatedAt;

  const hasSites = (sites ?? []).length > 0;

  // Aggregate daily energy (kWh) from individual entries
  const chartData = useMemo<ChartDatum[]>(() => {
    // The backend contract promises an array, but a malformed payload (or a
    // stray null row) must degrade cleanly instead of throwing at `.slice`.
    const entries = Array.isArray(history) ? history : [];
    const byDay = new Map<string, number | null>();
    for (const entry of entries) {
      const day = (entry?.timestamp ?? '').slice(0, 10);
      if (!day) continue;
      const energy = knownNumber(entry?.energy_wh);
      const previous = byDay.get(day);
      byDay.set(day, energy == null || previous === null ? null
        : (previous ?? 0) + convertEnergyFromSI(energy, unitPrefs.energy));
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, kwh]) => ({ date: shortDate(day), energy_kwh: kwh }));
  }, [history, unitPrefs.energy]);

  // Stats for current month
  const { monthTotalKwh, monthSessions, avgKwhPerSession } = useMemo(() => {
    // Same defensive coercion as `chartData`: a non-array payload here would
    // otherwise throw at `.filter`, blanking the whole widget.
    const entries = Array.isArray(history) ? history : [];
    const monthEntries = entries.filter((e) => e != null && isSameMonth(e.timestamp ?? ''));
    const measured = monthEntries.map((e) => {
      const energy = knownNumber(e.energy_wh);
      return energy == null ? null : convertEnergyFromSI(energy, unitPrefs.energy);
    });
    const total = measured.some((value) => value == null) ? null : sumKnown(measured);
    const count = monthEntries.length;
    return {
      monthTotalKwh: total,
      monthSessions: count,
      avgKwhPerSession: measured.some((value) => value == null) ? null : averageKnown(measured),
    };
  }, [history, unitPrefs.energy]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0;
  const axisLabels = useMemo(
    () => [0, ...chartData.map((entry) => entry.energy_kwh)]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => fmt(value)),
    [chartData, fmt],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels, fontSize: isWide ? 11 : 10, minWidth: 40, padding: 20, enabled: !isCompact,
  });

  const handleRefresh = useCallback(() => {
    refetchSites();
    if (siteId) refetchHistory();
  }, [refetchSites, refetchHistory, siteId]);
  const dataState = useDataState({
    data: siteId ? history ?? (isLoading || isError || error ? undefined : null)
      : isLoading || isError || error ? undefined : sites ?? null,
    error,
    isError,
    isFetching,
    dataUpdatedAt: siteId ? historyUpdatedAt : sitesUpdatedAt,
    refetch: handleRefresh,
  }, { provenance: 'historical', partial: chartData.some((d) => d.energy_kwh == null) });
  const shellProps = {
    title: t('widget.wallConnector.title', 'Wall connector'),
    icon: <Plug className="h-3.5 w-3.5 text-emerald-400" />,
  };

  // No energy sites linked. Guard on `!sitesError` so a *failed* sites fetch
  // surfaces the shared error panel (below) rather than this misleading empty
  // state — a fetch failure must be distinguishable from an unlinked site.
  if (!hasSites && !isLoading && !sitesError) {
    return (
      <WidgetShell
        {...shellProps}
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
          emptyMessage={t('widget.wallConnector.noSite', 'No Tesla energy site linked')}
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
          emptyMessage={t('widget.wallConnector.noData', 'No wall connector data')}
          emptyIcon={<Plug className="h-5 w-5" />}
          stats={hasData ? [
            {
              label: t('widget.wallConnector.monthLoaded', 'This month (loaded)'),
              value: monthTotalKwh == null ? null : fmtNumber(monthTotalKwh),
              unit: unitPrefs.energy,
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
          label: t('widget.wallConnector.monthLoaded', 'This month (loaded)'),
          value: monthTotalKwh == null ? null : fmtNumber(monthTotalKwh),
          unit: unitPrefs.energy,
        },
        {
          label: t('widget.wallConnector.sessions', 'Sessions'),
          value: fmtInt(monthSessions),
        },
        {
          label: t('widget.wallConnector.avgPerSession', 'Avg / session'),
          value: avgKwhPerSession == null ? null : fmtNumber(avgKwhPerSession),
          unit: unitPrefs.energy,
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
      footer={hasData ? <Caption>{t('widget.wallConnector.loadedWindow', 'Totals cover loaded records from the last 14 days.')}</Caption> : undefined}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.wallConnector.noData', 'No wall connector data')}
        emptyIcon={<Plug className="h-5 w-5" />}
        stats={stats}
        chart={
          <EmbeddedChart
            title={t('widget.wallConnector.title', 'Wall connector')}
            ariaLabel={t(
              'widget.wallConnector.chartLabel',
              'Daily wall connector charging energy over the last 14 days',
            )}
            data={chartData}
            dataColumns={[
              { key: 'date', label: t('widget.wallConnector.date', 'Date') },
              { key: 'energy_kwh', label: `${t('widget.wallConnector.energy', 'Energy')} (${unitPrefs.energy})` },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
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
                  width={axisWidth}
                  tickFormatter={(v: number) => fmt(v)}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  formatter={(value: number) => [
                    `${fmtNumber(value)} ${unitPrefs.energy}`,
                    t('widget.wallConnector.energy', 'Energy'),
                  ]}
                  cursor={{ fill: chartTokens.gridStroke }}
                />
                <Bar
                  dataKey="energy_kwh"
                  fill={chartTokens.series[1]}
                  radius={[4, 4, 0, 0]}
                  name={t('widget.wallConnector.energy', 'Energy')}
                />
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
