import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, ChartTooltip, EmbeddedChart, useMeasuredAxisWidth } from '@/components/charts';
import { useMonthlyMileage } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { zonedDateParts } from '@/lib/dateFormat';
import { formatMonthName } from '@/lib/dateConvert';
import { EmptyState } from '@/components/feedback';

import { WidgetBigNumber, WidgetChartSummary } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens } from '@/lib/tokens';

interface BarDatum {
  month: string;
  distance: number | null;
  isCurrent: boolean;
}

/** Format "2026-04" → "Apr". Non-'YYYY-MM' or out-of-range input is returned unchanged. */
export function shortMonth(iso: string): string {
  const parts = iso.split('-');
  if (parts.length < 2) return iso;
  const idx = parseInt(parts[1], 10) - 1;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[idx] ?? iso;
}

/** Current calendar month as a YYYY-MM key, resolved in the shared display zone. */
export function currentMonthKey(timezone?: string): string {
  const now = new Date();
  if (timezone) {
    const parts = zonedDateParts(now, timezone);
    if (!parts) return '';
    return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export default function MonthlyMileageWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { tz, locale } = useDateFormat('vehicle');
  const distanceUnit = unitPrefs.distance;
  // convertDistanceFromSI expects SI meters and maps to the user's unit.
  // Memoised so the chartData derive only recomputes when the source data or
  // the distance preference actually changes.
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, distanceUnit),
    [distanceUnit],
  );

  const query = useMonthlyMileage(vid > 0 ? String(vid) : '', tz);
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const trust = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const curMonth = currentMonthKey(tz);

  const chartData = useMemo<BarDatum[]>(() => {
    const items = data ?? [];
    return items.slice(-12).map((m) => ({
      // Backend `/mileage/monthly` returns `year_month` ('YYYY-MM') and
      // `total_km`. SI-canonical convertDistanceFromSI expects meters.
      month: formatMonthName(m.year_month ?? '', { locale, tz }),
      distance: knownNumber(m.total_km) == null ? null : toDistanceDisplay(m.total_km * 1000),
      isCurrent: (m.year_month ?? '') === curMonth,
    }));
  }, [data, toDistanceDisplay, curMonth]);

  const totalDistance = useMemo(
    () => chartData.length > 0 && chartData.every(d => d.distance != null)
      ? chartData.reduce((sum, d) => sum + (d.distance ?? 0), 0)
      : null,
    [chartData],
  );
  const averageDistance = useMemo(
    () => totalDistance == null || chartData.length === 0
      ? null
      : totalDistance / chartData.length,
    [totalDistance, chartData.length],
  );

  const currentMonthDistance = useMemo(() => {
    const cur = chartData.find((d) => d.isCurrent);
    return cur?.distance ?? null;
  }, [chartData]);
  const chartTableData = useMemo(
    () => chartData.map(({ month, distance }) => ({ month, distance })),
    [chartData],
  );

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;
  const hasData = chartData.length > 0;
  const axisLabels = useMemo(
    () => [0, ...chartData.map((entry) => entry.distance)]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => fmtNumber(value)),
    [chartData, fmtNumber],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels, fontSize: isWide ? 11 : 10, minWidth: 40, padding: 20, enabled: !isCompact,
  });

  const currentMonthLabel = useMemo(() => {
    if (!curMonth) return null;
    const parts = curMonth.split('-');
    const month = Number(parts[1]);
    return Number.isInteger(month) && month >= 1 && month <= 12
      ? formatMonthName(month, { locale, tz })
      : null;
  }, [curMonth, locale, tz]);

  const dataState = data != null || isLoading || isError || error ? trust : undefined;

  // ── Compact (1-col): summary stats only ──
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.monthlyMileage.title', 'Monthly mileage')}
        loading={isLoading}
        dataState={dataState}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {hasData ? (
          <WidgetBigNumber
            value={currentMonthDistance == null ? null : fmtInt(currentMonthDistance)}
            unit={distanceUnit}
            subtitle={currentMonthLabel == null
              ? t('widget.monthlyMileage.thisMonth', 'This month')
              : t('widget.monthlyMileage.monthSoFar', '{{month}} so far', { month: currentMonthLabel })}
          />
        ) : (
          <EmptyState
            variant="informational"
            icon={<BarChart3 className="h-5 w-5" />}
            message={t('widget.monthlyMileage.noData', 'No mileage data')}
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×4+): stat header + bar chart ──
  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.monthlyMileage.title', 'Monthly mileage')}
      icon={<BarChart3 className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <WidgetChartSummary
        isEmpty={!hasData}
        emptyMessage={t('widget.monthlyMileage.noData', 'No mileage data')}
        emptyIcon={<BarChart3 className="h-5 w-5" />}
        stats={[]}
        chart={
          <div className="flex h-full min-w-0 flex-col">
            <div className="mb-2 flex min-w-0 items-end justify-between gap-3">
              <WidgetBigNumber
                size="primary"
                value={currentMonthDistance == null ? null : fmtInt(currentMonthDistance)}
                unit={distanceUnit}
                subtitle={currentMonthLabel == null
                  ? t('widget.monthlyMileage.thisMonth', 'This month')
                  : t('widget.monthlyMileage.monthSoFar', '{{month}} so far', { month: currentMonthLabel })}
                animated={false}
              />
              <span className="shrink-0 pb-1 text-sm text-[var(--text-muted)] tabular-nums">
                {averageDistance == null
                  ? '—'
                  : t('widget.monthlyMileage.average12m', '12-mo avg {{value}}', {
                      value: `${fmtInt(averageDistance)} ${distanceUnit}`,
                    })}
              </span>
            </div>
            <div className="min-h-0 flex-1">
          <EmbeddedChart
            title={t('widget.monthlyMileage.title', 'Monthly mileage')}
            ariaLabel={t(
              'widget.monthlyMileage.chartAria',
              'Distance driven by month',
            )}
            data={chartTableData}
            dataColumns={[
              { key: 'month', label: t('widget.monthlyMileage.month', 'Month') },
              {
                key: 'distance',
                label: `${t('widget.monthlyMileage.distance', 'Distance')} (${distanceUnit})`,
              },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
              {chartGrid}
              <XAxis
                dataKey="month"
                tick={tick}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={tick}
                tickLine={false}
                axisLine={false}
                width={axisWidth}
                tickFormatter={(v: number) => fmtNumber(v)}
              />
              <Tooltip
                content={<ChartTooltip />}
                formatter={(value: number) => [
                  `${fmtNumber(value)} ${distanceUnit}`,
                  t('widget.monthlyMileage.distance', 'Distance'),
                ]}
                cursor={{ fill: chartTokens.gridStroke }}
              />
              <Bar
                dataKey="distance"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
                name={t('widget.monthlyMileage.distance', 'Distance')}
              >
                {chartData.map((entry, idx) => (
                  <Cell
                    key={`bar-${idx}`}
                    fill={entry.isCurrent ? chartTokens.series[5] : chartTokens.axisStroke}
                  />
                ))}
              </Bar>
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
            </div>
          </div>
        }
      />
    </WidgetShell>
  );
}
