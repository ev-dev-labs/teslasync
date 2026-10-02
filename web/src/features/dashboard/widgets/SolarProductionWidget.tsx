import { useCallback, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
  ChartTooltip, EmbeddedChart, type ChartDataRow,
} from '@/components/charts';
import { useTeslaEnergyHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { averageKnown, knownNumber, sumKnown } from '@/api/dataState';
import { DataProvenanceBadge } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface ChartDatum extends ChartDataRow {
  date: string;
  solar_kwh: number | null;
}

function shortDate(iso: string): string {
  // Daily energy buckets arrive as ISO date ("2024-03-05") or datetime
  // strings. Parse the leading calendar date directly so the axis label is
  // timezone-stable: `new Date('2024-03-05')` is UTC midnight and shifts a
  // day earlier when read back with local getters in negative-offset zones.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SolarProductionWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const gradientId = useId();

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
    d.setDate(d.getDate() - 30);
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
  } = useTeslaEnergyHistory(siteId, 'day', since);

  const isLoading = sitesLoading || (!!siteId && historyLoading);
  const error = sitesError ?? historyError;
  const isFetching = sitesFetching || historyFetching;
  const isStale = sitesStale || historyStale;
  const isError = sitesIsError || historyIsError;
  const updatedAt = siteId ? historyUpdatedAt : sitesUpdatedAt;

  const hasSites = (sites ?? []).length > 0;

  const chartData = useMemo<ChartDatum[]>(() => {
    // The backend contract promises an array, but a malformed payload must
    // degrade cleanly instead of throwing at `.map` and blanking the widget.
    const items = Array.isArray(history) ? history : [];
    return items.filter((entry) => entry?.timestamp).map((entry) => {
      const energy = knownNumber(entry.solar_energy_wh);
      return {
        date: shortDate(entry.timestamp),
        solar_kwh: energy == null ? null : convertEnergyFromSI(energy, unitPrefs.energy),
      };
    });
  }, [history, unitPrefs.energy]);

  const todayKwh = useMemo(() => {
    const key = todayKey();
    const items = Array.isArray(history) ? history : [];
    const todayEntry = items.find(
      (e) => (e?.timestamp ?? '').slice(0, 10) === key,
    );
    const energy = knownNumber(todayEntry?.solar_energy_wh);
    return energy == null ? null : convertEnergyFromSI(energy, unitPrefs.energy);
  }, [history, unitPrefs.energy]);

  const totalKwh = useMemo(
    () => chartData.some((d) => d.solar_kwh == null) ? null : sumKnown(chartData.map((d) => d.solar_kwh)),
    [chartData],
  );

  const avgKwh = averageKnown(chartData.map((d) => d.solar_kwh));

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0;

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
  }, { provenance: 'historical', partial: chartData.some((d) => d.solar_kwh == null) });

  // ── No energy sites linked ──
  // Guard on `!sitesError` so a *failed* sites fetch surfaces the shared error
  // panel (in the branches below) rather than the misleading "no site linked"
  // empty state — a fetch failure must be distinguishable from an unlinked site.
  if (!hasSites && !isLoading && !sitesError) {
    return (
      <WidgetShell
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
          emptyMessage={t('widget.solarProduction.noSite', 'No Tesla energy site linked')}
          emptyIcon={<Sun className="h-5 w-5" />}
          stats={[]}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // ── Compact (1-col): Today's kWh as large number ──
  if (isCompact) {
    return (
      <WidgetShell
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
          emptyMessage={t('widget.solarProduction.noData', 'No solar data')}
          emptyIcon={<Sun className="h-5 w-5" />}
          stats={hasData ? [
            {
              label: t('widget.solarProduction.today', 'Today'),
              value: todayKwh == null ? null : fmtNumber(todayKwh, 1),
              unit: unitPrefs.energy,
            },
            {
              label: t('widget.solarProduction.avg', 'Daily avg'),
              value: avgKwh == null ? null : fmtNumber(avgKwh, 1),
              unit: unitPrefs.energy,
            },
          ] : []}
          chart={null}
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×4+): stat header + area chart ──
  const stats: ChartSummaryStat[] = hasData
    ? [
        {
          label: t('widget.solarProduction.today', 'Today'),
          value: todayKwh == null ? null : fmtNumber(todayKwh, 1),
          unit: unitPrefs.energy,
        },
        {
          label: t('widget.solarProduction.total30dSentence', '30-day total'),
          value: totalKwh == null ? null : fmtInt(totalKwh),
          unit: unitPrefs.energy,
        },
        {
          label: t('widget.solarProduction.avg', 'Daily avg'),
          value: avgKwh == null ? null : fmtNumber(avgKwh, 1),
          unit: unitPrefs.energy,
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.solarProduction.title', 'Solar production')}
      icon={<Sun className="h-3.5 w-3.5 text-yellow-400" />}
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
        emptyMessage={t('widget.solarProduction.noData', 'No solar data')}
        emptyIcon={<Sun className="h-5 w-5" />}
        stats={stats}
        chart={
          <EmbeddedChart
            title={t('widget.solarProduction.title', 'Solar production')}
            ariaLabel={t(
              'widget.solarProduction.chartLabel',
              'Daily solar production over the last 30 days',
            )}
            data={chartData}
            dataColumns={[
              { key: 'date', label: t('widget.solarProduction.date', 'Date') },
              { key: 'solar_kwh', label: `${t('widget.solarProduction.solar', 'Solar')} (${unitPrefs.energy})` },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={chartMargin} {...chartAnimation}>
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
                  content={<ChartTooltip />}
                  formatter={(value: number) => [
                    `${fmtNumber(value, 1)} ${unitPrefs.energy}`,
                    t('widget.solarProduction.solar', 'Solar'),
                  ]}
                  cursor={{ fill: chartTokens.gridStroke }}
                />
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartTokens.series[2]} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={chartTokens.series[2]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="solar_kwh"
                  stroke={chartTokens.series[2]}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  name={t('widget.solarProduction.solar', 'Solar')}
                />
              </AreaChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        }
      />
    </WidgetShell>
  );
}
