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
import type { DigestMetrics, DailyEnergyEntry } from '../weekly-digest/types';
import { pctChange } from '../weekly-digest/helpers';
import { presentedMetric } from './presentation';

interface ChargingPanelProps {
  metrics: DigestMetrics;
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
          presentedMetric(
            'sessions',
            t('analytics.weeklyDigest.sessions', 'Sessions'),
            fmtInt(metrics.chargingSessionCount ?? 0),
            <Zap className="h-4 w-4" aria-hidden="true" />,
          ),
          presentedMetric(
            'energy-added',
            t('analytics.weeklyDigest.totalEnergyAdded', 'Total energy added'),
            formatEnergy(metrics.chargeEnergyAddedWh ?? 0),
            <Zap className="h-4 w-4" aria-hidden="true" />,
          ),
          presentedMetric(
            'avg-charge-rate',
            t('analytics.weeklyDigest.avgChargeRate', 'Avg charge rate'),
            formatPower(metrics.avgChargePowerW ?? 0),
            <Activity className="h-4 w-4" aria-hidden="true" />,
          ),
          presentedMetric(
            'total-cost',
            t('analytics.weeklyDigest.totalCost', 'Total cost'),
            formatCurrency(metrics.chargingCost ?? 0),
            <Fuel className="h-4 w-4" aria-hidden="true" />,
          ),
        ]}
      />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-lg bg-[var(--surface-2)] px-4 py-3">
        <Caption>{t('analytics.weeklyDigest.energyVsLastWeek', 'Energy vs. last week')}</Caption>
        <Badge
          variant={(metrics.chargeEnergyAddedWh ?? 0) >= (metrics.prevChargeEnergyWh ?? 0)
            ? 'success' : 'warning'}
          size="sm"
        >
          {(metrics.prevChargeEnergyWh ?? 0) > 0
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
