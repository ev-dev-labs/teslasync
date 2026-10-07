import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, BatteryCharging, Leaf, DollarSign, Route, TrendingUp } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
  ChartTooltip, EmbeddedChart, type ChartDataRow,
} from '@/components/charts';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';
import type { DailyEnergy } from '@/types/energy';

const GRADIENT_ID = 'energy-stats-area-grad';

/** A single point on the daily-energy area chart. */
export interface EnergyChartPoint extends ChartDataRow {
  date: string;
  /** Daily energy in kWh, converted from the SI watt-hour source. */
  energy: number;
}

/**
 * Map the SI watt-hour daily breakdown to chart points in kWh. The chart's
 * axis, tooltip, and series name are all labelled "kWh", so the series values
 * must be in kWh too — plotting raw watt-hours under a kWh label overstated
 * every point by 1000×. Null-safe for a missing breakdown or per-day energy.
 */
export function buildEnergyChartData(
  breakdown: DailyEnergy[] | null | undefined,
): EnergyChartPoint[] {
  return (breakdown ?? []).map((d) => ({
    date: d.date,
    energy: (d.energy_wh ?? 0) / 1000,
  }));
}

export default function EnergyStatsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = useEnergyStats(id > 0 ? String(id) : null);

  const { unitPrefs, formatEnergy } = useUnits();
  const toEfficiencyDisplay = useCallback(
    (whPerM: number) => (unitPrefs.distance === 'mi' ? whPerM * 1609.344 : whPerM * 1000),
    [unitPrefs.distance],
  );

  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const dailyBreakdown = data?.daily_breakdown;

  const chartData = useMemo(
    () => buildEnergyChartData(dailyBreakdown),
    [dailyBreakdown],
  );

  const hasData = !!data;
  const hasChartData = chartData.length > 0;

  // Build stat items for the grid
  const stats = useMemo((): StatGridItem[] => {
    if (!data) return [];

    const items: StatGridItem[] = [
      {
        label: t('widget.energyStats.totalUsed', 'Total Used'),
        value: formatEnergy(data.total_energy_used_wh ?? 0, { precision: 1 }),
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.energyStats.totalCharged', 'Total Charged'),
        value: formatEnergy(data.total_energy_charged_wh ?? 0, { precision: 1 }),
        icon: <BatteryCharging className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.energyStats.avgEfficiency', 'Avg Efficiency'),
        value: fmtNumber(toEfficiencyDisplay(data.avg_efficiency_wh_per_m ?? 0), 1),
        unit: efficiencyUnit,
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.energyStats.co2Saved', 'CO₂ Saved'),
        value: fmtNumber(data.co2_saved_kg ?? 0, 1),
        unit: 'kg',
        icon: <Leaf className="h-3.5 w-3.5" />,
      },
    ];

    if (isWide) {
      items.push(
        {
          label: t('widget.energyStats.totalCost', 'Total Cost'),
          value: fmtNumber(data.total_cost ?? 0, 2),
          unit: '$',
          icon: <DollarSign className="h-3.5 w-3.5" />,
        },
        {
          label: t('widget.energyStats.netBalance', 'Net Energy'),
          value: formatEnergy((data.total_energy_charged_wh ?? 0) - (data.total_energy_used_wh ?? 0), { precision: 1 }),
          icon: <Route className="h-3.5 w-3.5" />,
        },
      );
    }

    return items;
  }, [data, isWide, toEfficiencyDisplay, efficiencyUnit, formatEnergy, t]);

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: handleRefresh,
  };

  // ── Compact (1×2): large number only ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
            <AnimatedNumber
              value={(data.total_wh ?? 0) / 1000}
              className="text-2xl font-bold text-[var(--text-primary)]"
            />
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {unitPrefs.energy}
            </span>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Zap className="h-5 w-5" />}
            message={t('widget.energyStats.noData', 'No energy data available')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×4) / Wide (3×4+) ──
  const tick = isWide ? axisTick : axisTickSm;

  return (
    <WidgetShell
      title={t('widget.energyStats.title', 'Energy Stats')}
      icon={<Zap className="h-3.5 w-3.5 text-amber-400" />}
      {...shellProps}
    >
      {hasData ? (
        <div className="flex h-full flex-col gap-3">
          {/* Area chart: daily energy usage */}
          {hasChartData && (
            <EmbeddedChart
              title={t('widget.energyStats.title', 'Energy Stats')}
              ariaLabel={t(
                'widget.energyStats.chartAria',
                'Daily driving energy usage',
              )}
              data={chartData}
              dataColumns={[
                { key: 'date', label: t('widget.energyStats.date', 'Date') },
                { key: 'energy', label: t('widget.energyStats.energyKwh', 'Energy (kWh)') },
              ]}
              className="min-h-0 flex-1"
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
                    tickFormatter={(v: number) => fmt(v, 1)}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    formatter={(value: number) => [
                      `${fmtNumber(value, 2)} kWh`,
                      t('widget.energyStats.dailyUsage', 'Daily Usage'),
                    ]}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <defs>
                    <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="energy"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill={`url(#${GRADIENT_ID})`}
                    name={t('widget.energyStats.energyKwh', 'Energy (kWh)')}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </EmbeddedChart>
          )}

          {/* Stat cards grid */}
          <WidgetStatGrid stats={stats} cols={isWide ? 3 : 2} />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.energyStats.noData', 'No energy data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
