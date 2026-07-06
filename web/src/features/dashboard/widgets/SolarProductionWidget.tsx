import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
} from '@/components/charts';
import { useTeslaEnergyHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetChartSummary, type ChartSummaryStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface ChartDatum {
  date: string;
  solar_kwh: number;
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
  const updatedAt = Math.max(sitesUpdatedAt ?? 0, historyUpdatedAt ?? 0);

  const hasSites = (sites ?? []).length > 0;

  const chartData = useMemo<ChartDatum[]>(() => {
    // The backend contract promises an array, but a malformed payload must
    // degrade cleanly instead of throwing at `.map` and blanking the widget.
    const items = Array.isArray(history) ? history : [];
    return items.map((entry) => ({
      date: shortDate(entry?.timestamp ?? ''),
      solar_kwh: (entry?.solar_energy_wh ?? 0) / 1000,
    }));
  }, [history]);

  const todayKwh = useMemo(() => {
    const key = todayKey();
    const items = Array.isArray(history) ? history : [];
    const todayEntry = items.find(
      (e) => (e?.timestamp ?? '').slice(0, 10) === key,
    );
    return (todayEntry?.solar_energy_wh ?? 0) / 1000;
  }, [history]);

  const totalKwh = useMemo(
    () => chartData.reduce((sum, d) => sum + d.solar_kwh, 0),
    [chartData],
  );

  const avgKwh = chartData.length > 0 ? totalKwh / chartData.length : 0;

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0 && chartData.some((d) => d.solar_kwh > 0);

  const handleRefresh = useCallback(() => {
    refetchSites();
    if (siteId) refetchHistory();
  }, [refetchSites, refetchHistory, siteId]);

  // ── No energy sites linked ──
  // Guard on `!sitesError` so a *failed* sites fetch surfaces the shared error
  // panel (in the branches below) rather than the misleading "no site linked"
  // empty state — a fetch failure must be distinguishable from an unlinked site.
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
          emptyMessage={t('widget.solarProduction.noSite', 'No Tesla Energy site linked')}
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
          emptyMessage={t('widget.solarProduction.noData', 'No solar data')}
          emptyIcon={<Sun className="h-5 w-5" />}
          stats={hasData ? [
            {
              label: t('widget.solarProduction.today', 'Today'),
              value: fmtNumber(todayKwh, 1),
              unit: 'kWh',
            },
            {
              label: t('widget.solarProduction.avg', 'Daily Avg'),
              value: fmtNumber(avgKwh, 1),
              unit: 'kWh',
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
          value: fmtNumber(todayKwh, 1),
          unit: 'kWh',
        },
        {
          label: t('widget.solarProduction.total30d', '30-Day Total'),
          value: fmtInt(totalKwh),
          unit: 'kWh',
        },
        {
          label: t('widget.solarProduction.avg', 'Daily Avg'),
          value: fmtNumber(avgKwh, 1),
          unit: 'kWh',
        },
      ]
    : [];

  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.solarProduction.title', 'Solar Production')}
      icon={<Sun className="h-3.5 w-3.5 text-yellow-400" />}
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
        emptyMessage={t('widget.solarProduction.noData', 'No solar data')}
        emptyIcon={<Sun className="h-5 w-5" />}
        stats={stats}
        chart={
          <div
            role="img"
            aria-label={t(
              'widget.solarProduction.chartLabel',
              'Daily solar production over the last 30 days',
            )}
            className="h-full w-full"
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
                  contentStyle={{
                    background: 'rgba(0,0,0,0.85)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [
                    `${fmtNumber(value, 1)} kWh`,
                    t('widget.solarProduction.solar', 'Solar'),
                  ]}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                />
                <defs>
                  <linearGradient id="solarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#facc15" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="solar_kwh"
                  stroke="#facc15"
                  strokeWidth={2}
                  fill="url(#solarGrad)"
                  name={t('widget.solarProduction.solar', 'Solar')}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        }
      />
    </WidgetShell>
  );
}
