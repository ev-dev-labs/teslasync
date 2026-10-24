import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun } from 'lucide-react';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, chartGrid, chartMargin, chartAnimation, axisTick, axisTickSm, ChartTooltip, EmbeddedChart, useMeasuredAxisWidth, type ChartDataRow } from '@/components/charts';
import { useTeslaEnergyHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';
import { averageKnown, knownNumber } from '@/api/dataState';
import { Skeleton } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { convertEnergyFromSI } from '@/lib/unitConversion';

import { chartTokens } from '@/lib/tokens';
import { WidgetChartSummary, WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { civilDateInTimeZone } from '@/lib/dateRange';

interface ChartDatum extends ChartDataRow {
  date: string;
  solar_kwh: number | null;
  date_key: string;
}

export default function SolarProductionWidget({ size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const dateFormat = useDateFormat();
  const { tz } = dateFormat;
  const formatDayKey = dateFormat.formatDayKey ?? ((value: string | null | undefined) => String(value ?? ''));

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
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(entry.timestamp)
        ? entry.timestamp
        : civilDateInTimeZone(new Date(entry.timestamp), tz);
      return {
        date: formatDayKey(dateKey, { style: 'short' }),
        solar_kwh: energy == null ? null : convertEnergyFromSI(energy, unitPrefs.energy),
        date_key: dateKey,
      };
    });
  }, [history, unitPrefs.energy, tz]);

  const todayKwh = useMemo(() => {
    const key = civilDateInTimeZone(new Date(), tz);
    const items = Array.isArray(history) ? history : [];
    const todayEntry = items.find(
      (e) => {
        const timestamp = e?.timestamp ?? '';
        if (!timestamp) return false;
        const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(timestamp)
          ? timestamp
          : civilDateInTimeZone(new Date(timestamp), tz);
        return dateKey === key;
      },
    );
    const energy = knownNumber(todayEntry?.solar_energy_wh);
    return energy == null ? null : convertEnergyFromSI(energy, unitPrefs.energy);
  }, [history, unitPrefs.energy, tz]);

  const avgKwh = averageKnown(chartData.map((d) => d.solar_kwh));

  const isCompact = size.cols <= 1;
  const hasData = chartData.length > 0;
  const isWide = size.cols >= 3;
  const axisLabels = useMemo(
    () => [0, ...chartData.map((entry) => entry.solar_kwh)]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => fmtNumber(value)),
    [chartData, fmtNumber],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels,
    fontSize: isWide ? 11 : 10,
    minWidth: 40,
    padding: 20,
    enabled: !isCompact,
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
  }, { provenance: 'historical', partial: chartData.some((d) => d.solar_kwh == null) });
  const shellProps = {
    title: t('widget.solarProduction.title', 'Solar production'),
    icon: <Sun className="h-3.5 w-3.5 text-yellow-400" />,
  };

  // ── No energy sites linked ──
  // Guard on `!sitesError` so a *failed* sites fetch surfaces the shared error
  // panel (in the branches below) rather than the misleading "no site linked"
  // empty state — a fetch failure must be distinguishable from an unlinked site.
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
        {hasData ? (
          <WidgetBigNumber
            value={todayKwh == null ? null : fmtNumber(todayKwh, 1)}
            unit={unitPrefs.energy}
            label={t('widget.solarProduction.today', 'Today')}
            subtitle={avgKwh == null ? undefined : `${t('widget.solarProduction.avg', 'Daily avg')} ${fmtNumber(avgKwh, 1)} ${unitPrefs.energy}`}
            animated={false}
          />
        ) : (
          <WidgetChartSummary
            compact
            isEmpty
            emptyMessage={t('widget.solarProduction.noData', 'No solar data')}
            emptyIcon={<Sun className="h-5 w-5" />}
            stats={[]}
            chart={null}
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      {...shellProps}
      loading={isLoading}
      dataState={dataState}
      loadingContent={<Skeleton className="h-full min-h-24 rounded-shape-sm" />}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        <div className="flex h-full min-h-0 flex-col">
          <WidgetBigNumber
            value={todayKwh == null ? null : fmtNumber(todayKwh, 1)}
            unit={unitPrefs.energy}
            label={t('widget.solarProduction.today', 'Today')}
            subtitle={avgKwh == null ? undefined : `${t('widget.solarProduction.avg', 'Daily avg')} ${fmtNumber(avgKwh, 1)} ${unitPrefs.energy}`}
            animated={false}
          />
          <div className="mt-2 min-h-0 flex-1">
            <EmbeddedChart
              title={t('widget.solarProduction.title', 'Solar production')}
              ariaLabel={t('widget.solarProduction.chartLabel', 'Daily solar production over the last 30 days')}
              data={chartData}
              dataColumns={[
                { key: 'date', label: t('widget.solarProduction.date', 'Date') },
                { key: 'solar_kwh', label: `${t('widget.solarProduction.solar', 'Solar')} (${unitPrefs.energy})` },
              ]}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                  {chartGrid}
                  <XAxis dataKey="date" tick={isWide ? axisTick : axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={isWide ? axisTick : axisTickSm}
                    tickLine={false}
                    axisLine={false}
                    width={axisWidth}
                    tickFormatter={(value: number) => fmtNumber(value)}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    formatter={(value: number) => [
                      `${fmtNumber(value, 1)} ${unitPrefs.energy}`,
                      t('widget.solarProduction.solar', 'Solar'),
                    ]}
                    cursor={{ fill: chartTokens.gridStroke }}
                  />
                  <Bar dataKey="solar_kwh" name={t('widget.solarProduction.solar', 'Solar')} radius={[3, 3, 0, 0]} maxBarSize={32}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`${entry.date}-${index}`}
                        fill={entry.date_key === civilDateInTimeZone(new Date(), tz) ? chartTokens.series[3] : chartTokens.axisStroke}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </EmbeddedChart>
          </div>
        </div>
      ) : (
        <WidgetChartSummary
          isEmpty
          emptyMessage={t('widget.solarProduction.noData', 'No solar data')}
          emptyIcon={<Sun className="h-5 w-5" />}
          stats={[]}
          chart={null}
        />
      )}
    </WidgetShell>
  );
}
