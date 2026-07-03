import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Zap, Activity, Fuel } from 'lucide-react';
import { GlassPanel, Badge, PanelTitle, Caption } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import {
  ChartTooltip, CHART_COLORS,
  chartGrid, axisTickSm, chartMarginLabeled, chartAnimation,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { MiniStat } from './MiniStat';
import { pctChange } from './helpers';
import type { DigestMetrics, DailyEnergyEntry } from './types';

interface ChargingSectionProps {
  metrics: DigestMetrics;
  dailyEnergyData: DailyEnergyEntry[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function ChargingSection({
  metrics,
  dailyEnergyData,
  isLoading,
  isError,
  error,
  onRetry,
}: ChargingSectionProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const energyData = dailyEnergyData ?? [];
  const hasChart = energyData.some((d) => (d.energy ?? 0) > 0);

  return (
    <GlassPanel className="flex h-full flex-col gap-5 p-4 sm:p-5">
      <PanelTitle className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('analytics.weeklyDigest.chargingSection', 'Charging')}
      </PanelTitle>

      {/* Daily Energy Added bar chart */}
      <div>
        <Caption className="mb-2 block">
          {t('analytics.weeklyDigest.dailyEnergyAdded', 'Daily Energy Added (kWh)')}
        </Caption>
        {isLoading ? (
          <Skeleton height={220} />
        ) : isError ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : hasChart ? (
          <div className="h-56 sm:h-64 xl:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={energyData} margin={chartMarginLabeled}>
                {chartGrid}
                <XAxis dataKey="day" {...axisTickSm} />
                <YAxis {...axisTickSm} tickFormatter={(v: number) => fmtNumber(v, 1)} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="energy"
                  name={t('analytics.weeklyDigest.energyAdded', 'Energy Added')}
                  fill={CHART_COLORS[1]}
                  radius={[4, 4, 0, 0]}
                  {...chartAnimation}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t('analytics.weeklyDigest.noDailyEnergy', 'No charging energy data is available for this week.')}
            className="py-8"
          />
        )}
      </div>

      {/* Charging stats row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MiniStat
          label={t('analytics.weeklyDigest.sessions', 'Sessions')}
          value={fmtInt(metrics.chargingSessionCount ?? 0)}
          icon={<Zap className="h-4 w-4" />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.totalEnergyAdded', 'Total Energy Added')}
          value={`${fmtNumber(metrics.chargeEnergyAdded ?? 0, 1)} kWh`}
          icon={<Zap className="h-4 w-4" />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.avgChargeRate', 'Avg Charge Rate')}
          value={`${fmtNumber(metrics.avgChargeRate ?? 0, 1)} kW`}
          icon={<Activity className="h-4 w-4" />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.totalCost', 'Total Cost')}
          value={formatCurrency(metrics.chargingCost ?? 0, 2)}
          icon={<Fuel className="h-4 w-4" />}
        />
      </div>

      {/* Charge energy week-over-week */}
      <GlassPanel className="mt-auto flex items-center justify-between gap-4 px-4 py-3">
        <Caption>{t('analytics.weeklyDigest.energyVsLastWeek', 'Energy vs. Last Week')}</Caption>
        <Badge
          variant={
            (metrics.chargeEnergyAdded ?? 0) >= (metrics.prevChargeEnergy ?? 0) ? 'success' : 'warning'
          }
          size="sm"
        >
          {(metrics.prevChargeEnergy ?? 0) > 0
            ? `${fmtNumber(pctChange(metrics.chargeEnergyAdded ?? 0, metrics.prevChargeEnergy ?? 0), 1)}%`
            : '—'}
        </Badge>
      </GlassPanel>
    </GlassPanel>
  );
}
