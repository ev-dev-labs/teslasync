import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart as PieIcon, DollarSign, TrendingDown, Fuel } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, useThemeChartPalette,
  EmbeddedChart,
  type ChartDataRow,
} from '@/components/charts';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useCostBreakdown } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { WidgetRankedList, type RankedItem } from './shared';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const MI_TO_KM = 1.60934;

interface DonutSegment extends ChartDataRow {
  name: string;
  value: number;
  color: string;
}

export function CostTooltip({
  active,
  payload,
  formatCurrency,
}: {
  active?: boolean;
  payload?: Array<{ payload: DonutSegment }>;
  formatCurrency: (amount: number, decimals?: number) => string;
}) {
  if (!active || !payload?.[0]) return null;
  const seg = payload[0].payload;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-xl px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: seg.color }}
        />
        <span className="text-[var(--text-primary)]">{seg.name}</span>
      </div>
      <div className="mt-1 text-[var(--text-secondary)]">
        {formatCurrency(seg.value, 2)}
      </div>
    </div>
  );
}

export default function CostBreakdownWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { formatCurrency } = useFormatting();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const { currencySymbol } = useFormatting();

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useCostBreakdown(String(id));

  const isCompact = size.cols <= 1;

  // series colours from active theme.
  const palette = useThemeChartPalette();

  const monthlyEntries = useMemo(() => data?.monthly_breakdown ?? [], [data]);

  // Cost per distance unit in user's preference
  const costPerDist = useMemo(() => {
    const cpk = data?.cost_per_km_ev ?? 0;
    if (cpk === 0) return 0;
    return distanceUnit === 'mi' ? cpk * MI_TO_KM : cpk;
  }, [data, distanceUnit]);

  // Current month cost (last entry in breakdown)
  const currentMonthCost = useMemo(() => {
    if (monthlyEntries.length === 0) return 0;
    return monthlyEntries[monthlyEntries.length - 1]?.ev_cost ?? 0;
  }, [monthlyEntries]);

  // Donut segments from monthly breakdown (last 6 months)
  const donutData = useMemo((): DonutSegment[] => {
    const recent = monthlyEntries.slice(-6);
    return recent.map((entry, i) => ({
      name: entry.month ?? '—',
      value: entry.ev_cost ?? 0,
      color: palette.series[i % palette.series.length],
    }));
  }, [monthlyEntries, palette]);

  // Ranked list items from monthly breakdown
  const rankedItems = useMemo((): RankedItem[] => {
    return monthlyEntries.map((entry, i) => ({
      id: entry.month ?? i,
      label: entry.month ?? '—',
      value: entry.ev_cost ?? 0,
      formattedValue: formatCurrency(entry.ev_cost ?? 0),
      barColor: palette.series[i % palette.series.length],
    }));
  }, [monthlyEntries, formatCurrency, palette]);

  const hasData = monthlyEntries.length > 0;
  const totalSavings = data?.total_savings ?? 0;
  const monthlySavings = data?.monthly_savings ?? 0;

  // Compact layout: big number + savings subtitle
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        {hasData ? (
          <WidgetBigNumber
            value={currentMonthCost}
            unit={currencySymbol}
            label={t('widget.costBreakdown.monthlyTotal', 'This Month')}
            subtitle={
              monthlySavings > 0
                ? t('widget.costBreakdown.savedVsGas', 'Saved {{amount}} vs gas', {
                    amount: formatCurrency(monthlySavings),
                  })
                : undefined
            }
            badge={
              totalSavings > 0
                ? { text: t('widget.costBreakdown.saving', 'Saving'), variant: 'success' as const }
                : undefined
            }
            valueColor="text-emerald-400"
            animated
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

  // Standard layout: donut + ranked list + stat cards
  return (
    <WidgetShell
      title={t('widget.costBreakdown.title', 'Cost Breakdown')}
      icon={<PieIcon className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        <div className="flex flex-col gap-3">
          {/* Donut chart */}
          <EmbeddedChart
            title={t('widget.costBreakdown.title', 'Cost Breakdown')}
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
                format: (value) => formatCurrency(Number(value ?? 0)),
              },
            ]}
            fluid={false}
            height={140}
            mobileHeight={140}
          >
            <ResponsiveContainer width="100%" height="100%">
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
                  content={<CostTooltip formatCurrency={formatCurrency} />}
                />
              </PieChart>
            </ResponsiveContainer>
          </EmbeddedChart>

          {/* Monthly ranked list */}
          <WidgetRankedList
            items={rankedItems}
            compact={false}
            maxItems={5}
            emptyMessage={t('widget.costBreakdown.noData', 'No cost data')}
            emptyIcon={<PieIcon className="h-5 w-5" />}
          />

          {/* Stat cards */}
          <div className="grid grid-cols-1 @xs:grid-cols-3 gap-2">
            <StatCard
              label={t('widget.costBreakdown.totalCost', 'Total Cost')}
              value={formatCurrency(data?.total_charging_cost ?? 0)}
              icon={<DollarSign className="h-3.5 w-3.5" />}
            />
            <StatCard
              label={t('widget.costBreakdown.costPerDist', 'Cost / {{unit}}', {
                unit: distanceUnit,
              })}
              value={costPerDist > 0
                ? formatCurrency(costPerDist, 3)
                : '—'
              }
              icon={<Fuel className="h-3.5 w-3.5" />}
            />
            <StatCard
              label={t('widget.costBreakdown.gasSavings', 'Gas Savings')}
              value={totalSavings > 0 ? formatCurrency(totalSavings) : '—'}
              icon={<TrendingDown className="h-3.5 w-3.5" />}
              sublabel={
                totalSavings > 0
                  ? t('widget.costBreakdown.lifetime', 'Lifetime')
                  : undefined
              }
            />
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<PieIcon className="h-5 w-5" />}
          message={t('widget.costBreakdown.noData', 'No cost data')}
          className="py-8"
        />
      )}
    </WidgetShell>
  );
}
