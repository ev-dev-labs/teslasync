import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart as PieIcon } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, useThemeChartPalette,
  EmbeddedChart, ChartTooltip, BarChart, Bar, XAxis, YAxis,
  chartMargin, chartAnimation, axisTickSm, useMeasuredAxisWidth,
  type ChartDataRow,
} from '@/components/charts';
import { EmptyState, Skeleton } from '@/components/feedback';
import { DataProvenanceBadge } from '@/components/data-display';
import { Caption } from '@/components/ui';
import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { useDateLabels } from '@/hooks/useDateLabels';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface DonutSegment extends ChartDataRow {
  name: string;
  value: number | null;
  color: string;
}

export default function CostBreakdownWidget({ vehicleId, config, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const id = vehicleId ?? config?.vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const { formatCurrency } = useFormatting();
  const { formatMonthName, locale, tz } = useDateLabels('vehicle');

  const {
    data,
    isLoading: costLoading,
    error: costError,
    isFetching,
    isStale,
    isError: costIsError,
    dataUpdatedAt,
    refetch,
  } = useCostBreakdown(id == null ? '' : String(id));

  const isLoading = costLoading || (id == null && (vehiclesQuery.isLoading ?? false));
  const error = costError ?? (id == null ? vehiclesQuery.error : null);
  const isError = costIsError || (id == null && (vehiclesQuery.isError ?? false));
  const isCompact = size.cols <= 1;
  const palette = useThemeChartPalette();
  const formatAmount = useCallback((value: unknown, decimals?: number) => {
    const amount = knownNumber(value);
    return amount == null ? '—' : formatCurrency(amount, decimals);
  }, [formatCurrency]);

  const monthlyEntries = useMemo(() => (
    Array.isArray(data?.monthly_breakdown)
      ? data.monthly_breakdown.filter((entry) => entry != null && typeof entry === 'object')
      : []
  ), [data]);

  const donutData = useMemo((): DonutSegment[] => {
    const recent = monthlyEntries.slice(-6);
    return recent.map((entry, i) => ({
      name: entry.month == null
        ? '—'
        : formatMonthName(String(entry.month), { locale, tz }),
      value: knownNumber(entry.ev_cost),
      color: palette.series[i % palette.series.length],
    }));
  }, [monthlyEntries, palette, formatMonthName, locale, tz]);

  const canUseDonut = donutData.every((entry) => entry.value != null && entry.value >= 0)
    && donutData.some((entry) => entry.value != null && entry.value > 0);
  const axisLabels = useMemo(
    () => [0, ...donutData.map((entry) => entry.value)]
      .filter((value): value is number => value != null && Number.isFinite(value))
      .map((value) => formatAmount(value)),
    [donutData, formatAmount],
  );
  const axisWidth = useMeasuredAxisWidth({
    labels: axisLabels, fontSize: 10, minWidth: 45, padding: 20, enabled: !isCompact && !canUseDonut,
  });
  // The measured width covers data labels, but recharts' nice domain can
  // render a wider boundary tick (e.g. data peaks below $1,000 while the
  // axis crosses into $1,050). Grow the axis from the rendered ticks when
  // they overflow the SVG origin; a no-op when everything already fits, so
  // normal renders keep their exact width.
  const chartRef = useRef<HTMLDivElement>(null);
  const [axisOverflow, setAxisOverflow] = useState(0);
  const [axisRemeasure, setAxisRemeasure] = useState(0);
  useLayoutEffect(() => {
    if (isCompact || canUseDonut) return;
    let needed = 0;
    try {
      // Viewport coordinates (getBBox reports local SVG space, which ignores
      // the translated tick groups recharts renders). Each tick is measured
      // against its own SVG so sparklines elsewhere in the widget cannot skew
      // the comparison.
      const texts = chartRef.current?.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick text');
      texts?.forEach(node => {
        const svgLeft = (node as SVGTextElement).closest('svg')?.getBoundingClientRect().left;
        const left = (node as SVGTextElement).getBoundingClientRect?.().left;
        if (svgLeft != null && Number.isFinite(svgLeft) && left != null && Number.isFinite(left))
          needed = Math.max(needed, svgLeft - 1 - left);
      });
    } catch {
      needed = 0;
    }
    const grown = Math.max(0, Math.ceil(needed));
    // Monotonic within a mount: a fractional overflow must not oscillate the
    // axis width between renders (grow by ceil, re-measure inside tolerance,
    // shrink, repeat). A stale extra pixel is harmless; a loop is not.
    setAxisOverflow(previous => (grown > previous ? grown : previous));
  }, [axisWidth, axisOverflow, axisRemeasure, donutData, isCompact, canUseDonut]);
  useLayoutEffect(() => {
    if (isCompact || canUseDonut) return;
    // ResponsiveContainer injects the SVG asynchronously after the chart node
    // mounts, so a mount-time measurement sees no ticks; webfonts landing
    // later widen the rendered glyphs without touching the DOM. Re-observe on
    // every data change because the chart node itself mounts late: the chart
    // frame renders a skeleton while donutData is empty, so the mount pass
    // has no node to observe. Mirrors useMeasuredAxisWidth's fonts.ready pass.
    const bump = () => setAxisRemeasure(value => value + 1);
    const node = chartRef.current;
    const observer = new MutationObserver(bump);
    if (node) observer.observe(node, { childList: true, subtree: true });
    void document.fonts?.ready.then(bump);
    return () => observer.disconnect();
  }, [donutData, isCompact, canUseDonut]);
  const yAxisWidth = axisWidth + axisOverflow;

  const totalCost = knownNumber(data?.total_charging_cost);
  const totalSavings = knownNumber(data?.total_savings);
  const handleRefresh = useCallback(() => {
    if (id == null) vehiclesQuery.refetch?.();
    else refetch();
  }, [id, vehiclesQuery.refetch, refetch]);
  const dataState = useDataState({
    data: data ?? (isLoading || isError || error ? undefined : null),
    error, isError, isLoading, isFetching, dataUpdatedAt, refetch: handleRefresh,
  }, {
    provenance: 'historical',
    partial: data != null && (
      !Array.isArray(data.monthly_breakdown)
      || monthlyEntries.length !== data.monthly_breakdown.length
      || [totalCost, totalSavings].some((value) => value == null)
    ),
  });
  const shellProps = {
    title: t('widget.costBreakdown.title', 'Cost breakdown'),
    icon: <PieIcon className="h-3.5 w-3.5 text-emerald-400" />,
  };
  const savingsDelta = totalSavings == null ? undefined : {
    text: totalSavings >= 0
      ? t('widget.costBreakdown.savedVsGas', 'Saved {{amount}} vs gas', { amount: formatCurrency(totalSavings) })
      : t('widget.costBreakdown.gasComparisonDelta', 'Gas comparison difference {{amount}}', { amount: formatCurrency(totalSavings) }),
    tone: totalSavings > 0 ? 'good' as const : 'neutral' as const,
  };

  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        loading={isLoading}
        dataState={dataState}
        loadingContent={<Skeleton className="h-full min-h-16 rounded-shape-sm" />}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {data != null ? (
          <WidgetBigNumber
            value={totalCost == null ? null : formatAmount(totalCost)}
            label={t('widget.costBreakdown.lifetimeCost', 'Lifetime charging cost')}
            delta={savingsDelta}
            animated={false}
            align="center"
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<PieIcon className="h-5 w-5" />}
            message={t('widget.costBreakdown.noData', 'No cost data')}
            className="py-4"
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
      status={<DataProvenanceBadge provenance={dataState.provenance} status={dataState.status} />}
      footer={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Caption>{t('widget.costBreakdown.lifetime', 'Lifetime')}</Caption>
          <DataProvenanceBadge provenance="inferred" />
          <Caption>{t('widget.costBreakdown.gasEstimate', 'Gas comparison is estimated.')}</Caption>
        </div>
      }
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
        <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
          <div className="shrink-0">
          <WidgetBigNumber
            value={totalCost == null ? null : formatAmount(totalCost)}
            label={t('widget.costBreakdown.lifetimeCost', 'Lifetime charging cost')}
            delta={savingsDelta}
            animated={false}
          />
          </div>
          <div className="min-h-0 flex-1 grid grid-cols-1">
          <EmbeddedChart
            title={t('widget.costBreakdown.title', 'Cost breakdown')}
            ariaLabel={t(
              'widget.costBreakdown.chartLabel',
              'Monthly EV charging cost breakdown',
            )}
            data={donutData}
            dataColumns={[
              { key: 'name', label: t('widget.costBreakdown.month', 'Month') },
              {
                key: 'value',
                label: t('widget.costBreakdown.cost', 'Cost'),
                format: (value) => formatAmount(value),
              },
            ]}
            empty={donutData.length === 0}
            emptyMessage={t('widget.costBreakdown.noData', 'No cost data')}
            className="h-full min-w-0"
          >
            <div ref={chartRef} className="h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
              {canUseDonut ? (
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {donutData.map((seg, i) => (
                    <Cell key={`${seg.name}-${i}`} fill={seg.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={<ChartTooltip valueFormatter={(value) => formatAmount(value)} />}
                />
              </PieChart>
              ) : (
                <BarChart data={donutData} margin={{ ...chartMargin, left: 4 }} {...chartAnimation}>
                  <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                  <YAxis tick={axisTickSm} width={yAxisWidth} tickLine={false} axisLine={false} tickFormatter={(value: number) => formatAmount(value)} />
                  <Tooltip content={<ChartTooltip valueFormatter={(value) => formatAmount(value)} />} />
                  <Bar dataKey="value" name={t('widget.costBreakdown.cost', 'Cost')} fill={palette.primary} maxBarSize={32} radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
            </div>
          </EmbeddedChart>
          </div>
        </div>
    </WidgetShell>
  );
}
