import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Zap, Activity, Fuel } from 'lucide-react';
import { GlassPanel, Badge } from '@/components/ui';
import { FadeIn } from '@/components/motion';
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
}

export function ChargingSection({ metrics, dailyEnergyData }: ChargingSectionProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  return (
    <FadeIn delay={0.15}>
      <GlassPanel className="space-y-6 p-6">
        <span className="flex items-center gap-2 text-lg font-bold text-white">
          <Zap className="h-5 w-5 text-neon-green" />
          {t('analytics.weeklyDigest.chargingSection', 'Charging')}
        </span>

        {/* Daily Energy Added BarChart */}
        <GlassPanel className="p-4">
          <span className="mb-3 block text-sm font-medium text-[var(--text-secondary)]">
            {t('analytics.weeklyDigest.dailyEnergyAdded', 'Daily Energy Added (kWh)')}
          </span>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dailyEnergyData} margin={chartMarginLabeled}>
              {chartGrid}
              <XAxis dataKey="day" {...axisTickSm} />
              <YAxis
                {...axisTickSm}
                tickFormatter={(v: number) => fmtNumber(v, 1)}
              />
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
        </GlassPanel>

        {/* Charging stats row */}
        <span className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat
            label={t('analytics.weeklyDigest.sessions', 'Sessions')}
            value={fmtInt(metrics.chargingSessionCount)}
            icon={<Zap className="h-4 w-4" />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.totalEnergyAdded', 'Total Energy Added')}
            value={`${fmtNumber(metrics.chargeEnergyAdded, 1)} kWh`}
            icon={<Zap className="h-4 w-4" />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.avgChargeRate', 'Avg Charge Rate')}
            value={`${fmtNumber(metrics.avgChargeRate, 1)} kW`}
            icon={<Activity className="h-4 w-4" />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.totalCost', 'Total Cost')}
            value={formatCurrency(metrics.chargingCost, 2)}
            icon={<Fuel className="h-4 w-4" />}
          />
        </span>

        {/* Charge energy week-over-week */}
        <GlassPanel className="flex items-center gap-4 px-4 py-3">
          <span className="text-xs text-[var(--text-secondary)]">
            {t('analytics.weeklyDigest.energyVsLastWeek', 'Energy vs. Last Week')}
          </span>
          <Badge
            variant={
              metrics.chargeEnergyAdded >= metrics.prevChargeEnergy ? 'success' : 'warning'
            }
            size="sm"
          >
            {metrics.prevChargeEnergy > 0
              ? `${fmtNumber(pctChange(metrics.chargeEnergyAdded, metrics.prevChargeEnergy), 1)}%`
              : '—'}
          </Badge>
        </GlassPanel>
      </GlassPanel>
    </FadeIn>
  );
}
