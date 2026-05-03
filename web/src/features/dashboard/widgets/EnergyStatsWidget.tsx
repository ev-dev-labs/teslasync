import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, BatteryCharging, Leaf, DollarSign, Route, TrendingUp } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  chartGrid, chartMargin, axisTick, axisTickSm, chartAnimation, fmt,
} from '@/components/charts';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useEnergyStats } from '@/api/hooks/useEnergy';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

const GRADIENT_ID = 'energy-stats-area-grad';

export default function EnergyStatsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data, isLoading, error,
    isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useEnergyStats(id > 0 ? String(id) : null);

  const { convertEfficiency, efficiencyUnit } = useSettings();

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const dailyBreakdown = data?.daily_breakdown ?? [];

  const chartData = useMemo(
    () => dailyBreakdown.map((d) => ({
      date: d.date,
      energy: d.energy_kwh ?? 0,
    })),
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
        value: fmtNumber(data.total_energy_used_kwh ?? 0, 1),
        unit: 'kWh',
        icon: <Zap className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.energyStats.totalCharged', 'Total Charged'),
        value: fmtNumber(data.total_energy_charged_kwh ?? 0, 1),
        unit: 'kWh',
        icon: <BatteryCharging className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.energyStats.avgEfficiency', 'Avg Efficiency'),
        value: fmtNumber(convertEfficiency(data.avg_efficiency_wh_per_mi ?? 0), 1),
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
          value: fmtNumber((data.total_energy_charged_kwh ?? 0) - (data.total_energy_used_kwh ?? 0), 1),
          unit: 'kWh',
          icon: <Route className="h-3.5 w-3.5" />,
        },
      );
    }

    return items;
  }, [data, isWide, convertEfficiency, efficiencyUnit, t]);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact (1×2): large number only ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
        {hasData ? (
          <div className="h-full flex flex-col items-center justify-center gap-0.5 min-h-[44px]">
            <AnimatedNumber
              value={data.total_kwh ?? 0}
              className="text-2xl font-bold text-[var(--text-primary)]"
            />
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              kWh
            </span>
          </div>
        ) : (
          <EmptyState
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
            <div className="min-h-0 flex-1">
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
                    contentStyle={{
                      background: 'rgba(0,0,0,0.85)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
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
            </div>
          )}

          {/* Stat cards grid */}
          <WidgetStatGrid stats={stats} cols={isWide ? 3 : 2} />
        </div>
      ) : (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.energyStats.noData', 'No energy data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
