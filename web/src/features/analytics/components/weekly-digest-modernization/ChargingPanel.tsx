import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Activity, Fuel } from 'lucide-react';
import { ChartCard } from '@/components/layout/layout-reference';
import { StatGroup } from '@/components/data-display/stat-reference';
import { Badge, Caption } from '@/components/ui';
import {
  ChartTooltip, CHART_COLORS,
  chartGrid, axisTickSm, chartMarginLabeled, chartAnimation,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import type { StatPeriod } from '@/lib/metric-reference';
import type { DailyEnergyEntry } from '../weekly-digest/types';
import type { WeeklyDigestMetrics } from '../weekly-digest/useWeeklyDigest';
import { pctChange } from '../weekly-digest/helpers';
import { numericPresentedMetric } from './presentation';

interface ChargingPanelProps {
  metrics: WeeklyDigestMetrics;
  period: StatPeriod;
  dailyEnergyData: DailyEnergyEntry[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function ChargingPanel({
  metrics,
  period,
  dailyEnergyData,
  isLoading,
  isError,
  error,
  onRetry,
}: ChargingPanelProps) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { formatCurrency } = useFormatting();
  const { formatEnergy, formatPower, unitPrefs } = useUnits();
  const energyData = dailyEnergyData ?? [];
  const available = metrics.detailMetrics?.chargingAvailable ?? true;
  const hasChart = energyData.some((entry) => (entry?.energyWh ?? 0) > 0);
  // Exactly the original display-boundary conversion; never alter raw Wh.
  const energyChartData = useMemo(
    () => energyData.map((entry) => ({
      day: entry?.day ?? '',
      energy: convertEnergyFromSI(entry?.energyWh ?? 0, unitPrefs.energy),
    })),
    [energyData, unitPrefs.energy],
  );

  const details = (
    <div className="flex min-w-0 flex-col gap-3">
      <StatGroup
        period={period}
        metrics={[
          numericPresentedMetric(
            'sessions',
            'count',
            t('analytics.weeklyDigest.sessions', 'Sessions'),
            metrics.chargingSessionCount,
            fmtInt,
            available,
            <Zap className="h-4 w-4" aria-hidden="true" />,
          ),
          numericPresentedMetric(
            'energy-added',
            'energy',
            t('analytics.weeklyDigest.totalEnergyAdded', 'Total energy added'),
            metrics.chargeEnergyAddedWh,
            formatEnergy,
            available,
            <Zap className="h-4 w-4" aria-hidden="true" />,
          ),
          numericPresentedMetric(
            'avg-charge-rate',
            'power',
            t('analytics.weeklyDigest.avgChargeRate', 'Avg charge rate'),
            metrics.detailMetrics ? metrics.detailMetrics.avgChargePowerW : metrics.avgChargePowerW,
            formatPower,
            available,
            <Activity className="h-4 w-4" aria-hidden="true" />,
          ),
          numericPresentedMetric(
            'total-cost',
            'currency',
            t('analytics.weeklyDigest.totalCost', 'Total cost'),
            metrics.detailMetrics ? metrics.detailMetrics.chargingCost : metrics.chargingCost,
            formatCurrency,
            available,
            <Fuel className="h-4 w-4" aria-hidden="true" />,
          ),
        ]}
      />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-lg bg-[var(--surface-2)] px-4 py-3">
        <Caption>{t('analytics.weeklyDigest.energyVsLastWeek', 'Energy vs. last week')}</Caption>
        <Badge
          variant={metrics.chargeEnergyAddedWh == null || metrics.prevChargeEnergyWh == null
            ? 'neutral' : metrics.chargeEnergyAddedWh >= metrics.prevChargeEnergyWh ? 'success' : 'warning'}
          size="sm"
        >
          {metrics.chargeEnergyAddedWh != null && metrics.prevChargeEnergyWh != null && metrics.prevChargeEnergyWh > 0
            ? `${fmtNumber(pctChange(
                metrics.chargeEnergyAddedWh ?? 0,
                metrics.prevChargeEnergyWh ?? 0,
              ))}%`
            : '—'}
        </Badge>
      </div>
    </div>
  );

  return (
    <ChartCard
      title={t('analytics.weeklyDigest.dailyEnergyAdded', 'Daily energy added')}
      subtitle={`${t('analytics.weeklyDigest.chargingSection', 'Charging')} · ${t('analytics.weeklyDigest.dailyEnergyAdded', 'Daily energy added ({{unit}})', {
        unit: unitPrefs.energy,
      })}`}
      footer={details}
      ariaLabel={t(
        'analytics.weeklyDigest.dailyEnergyChartLabel',
        'Bar chart of daily charging energy in {{unit}}',
        { unit: unitPrefs.energy },
      )}
      data={energyChartData}
      dataColumns={[
        { key: 'day', label: t('analytics.weeklyDigest.day', 'Day') },
        {
          key: 'energy',
          label: t('analytics.weeklyDigest.dailyEnergyAdded', 'Daily energy added ({{unit}})', {
            unit: unitPrefs.energy,
          }),
        },
      ]}
      loading={isLoading}
      error={isError ? error : undefined}
      onRetry={onRetry}
      empty={!hasChart}
      emptyMessage={t(
        'analytics.weeklyDigest.noDailyEnergy',
        'No charging energy data is available for this week.',
      )}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={energyChartData} margin={chartMarginLabeled}>
          {chartGrid}
          <XAxis dataKey="day" {...axisTickSm} />
          <YAxis {...axisTickSm} tickFormatter={(v: number) => fmtNumber(v)} />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            dataKey="energy"
            name={t('analytics.weeklyDigest.energyAdded', 'Energy added')}
            fill={CHART_COLORS[1]}
            radius={[4, 4, 0, 0]}
            {...chartAnimation}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
