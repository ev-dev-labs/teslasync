import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer,
  Tooltip, CartesianGrid, ReferenceLine,
  chartGrid, axisTickSm, CHART_COLORS,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useBatteryDegradation } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function BatteryDegradationTrendWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useBatteryDegradation(idStr);

  const chartData = useMemo(() => {
    const trend = data?.monthly_trend ?? [];
    if (trend.length === 0) return [];
    const originalRange = trend[0].avg_range;
    return trend.map((entry) => ({
      month: entry.month,
      range: entry.avg_range,
      health: entry.avg_health,
      original: originalRange,
    }));
  }, [data]);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const currentHealth = data?.current_health_pct ?? data?.current_health ?? null;
  const degradationRate = data?.degradation_rate_pct_per_month ?? null;

  const healthColor = currentHealth != null
    ? currentHealth > 90 ? '#10b981' : currentHealth >= 80 ? '#f59e0b' : '#ef4444'
    : '#374151';

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryDegradation', 'Battery Degradation')}
      icon={isCompact ? undefined : <TrendingDown className="h-3.5 w-3.5 text-neon-amber" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {currentHealth != null || chartData.length > 0 ? (
        isCompact ? (
          <div className="h-full flex flex-col items-center justify-center">
            <p className="text-2xl font-bold" style={{ color: healthColor }}>
              {currentHealth != null ? `${fmtNumber(currentHealth, 1)}%` : '—'}
            </p>
            <p className="text-[10px] text-white/40">
              {t('widget.soh', 'SoH')}
            </p>
            {degradationRate != null && degradationRate > 0 && (
              <p className="text-[9px] text-white/30 mt-0.5">
                −{fmtNumber(degradationRate, 2)}%/{t('widget.mo', 'mo')}
              </p>
            )}
          </div>
        ) : (
          <div className="h-full flex flex-col min-h-0">
            {/* Summary stats row */}
            <div className="flex items-center gap-4 mb-2 flex-shrink-0">
              <div>
                <span className="text-lg font-bold" style={{ color: healthColor }}>
                  {currentHealth != null ? `${fmtNumber(currentHealth, 1)}%` : '—'}
                </span>
                <span className="text-[10px] text-white/40 ml-1">
                  {t('widget.soh', 'SoH')}
                </span>
              </div>
              {degradationRate != null && degradationRate > 0 && (
                <div className="text-[10px] text-white/30">
                  −{fmtNumber(degradationRate, 2)}%/{t('widget.mo', 'mo')}
                </div>
              )}
            </div>

            {/* Chart */}
            {chartData.length > 1 ? (
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    {areaGradient('degradation-grad', CHART_COLORS[1])}
                    <CartesianGrid {...chartGrid} />
                    <XAxis dataKey="month" {...axisTickSm} />
                    <YAxis
                      domain={['dataMin - 2', 100]}
                      tickFormatter={(v: number) => `${v}%`}
                      {...axisTickSm}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.4} />
                    <Area
                      {...AREA_DEFAULTS}
                      dataKey="health"
                      stroke={CHART_COLORS[1]}
                      fill="url(#degradation-grad)"
                      name={t('widget.healthPct', 'Health %')}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-white/30">
                  {t('widget.needMoreData', 'More data needed for trend')}
                </p>
              </div>
            )}
          </div>
        )
      ) : (
        <EmptyState
          icon={<TrendingDown className="h-5 w-5" />}
          message={t('widget.noDegradation', 'No degradation data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
