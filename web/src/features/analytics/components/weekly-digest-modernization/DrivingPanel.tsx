import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Clock, TrendingDown, TrendingUp, Activity } from 'lucide-react';
import { ChartCard } from '@/components/layout/layout-reference';
import { StatGroup } from '@/components/data-display/stat-reference';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import {
  ChartTooltip, CHART_COLORS,
  chartGrid, axisTickSm, chartMarginLabeled, chartAnimation,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDate } from '@/lib/dateFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { StatPeriod } from '@/lib/metric-reference';
import type { DailyDistanceEntry } from '../weekly-digest/types';
import type { WeeklyDigestMetrics } from '../weekly-digest/useWeeklyDigest';
import { formatEfficiencyFromSI } from '../weekly-digest/display';
import { pctChange } from '../weekly-digest/helpers';
import { numericPresentedMetric, presentedMetric } from './presentation';

interface DrivingPanelProps {
  metrics: WeeklyDigestMetrics;
  period: StatPeriod;
  dailyDistanceData: DailyDistanceEntry[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function DrivingPanel({
  metrics,
  period,
  dailyDistanceData,
  isLoading,
  isError,
  error,
  onRetry,
}: DrivingPanelProps) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { unitPrefs, formatDistance, formatDuration } = useUnits();
  const distanceData = dailyDistanceData ?? [];
  const hasChart = distanceData.some((entry) => (entry.distanceM ?? 0) > 0);
  const distanceChartData = useMemo(
    () => distanceData.map((entry) => ({
      day: entry.day,
      distance: convertDistanceFromSI(entry.distanceM ?? 0, unitPrefs.distance),
    })),
    [distanceData, unitPrefs.distance],
  );
  const topDriveEfficiencyWhPerM =
    metrics.topDrive && Number.isFinite(metrics.topDrive.distanceM) && metrics.topDrive.distanceM > 0
      && typeof metrics.topDrive.energyUsedWh === 'number' && Number.isFinite(metrics.topDrive.energyUsedWh)
      ? metrics.topDrive.energyUsedWh / metrics.topDrive.distanceM
      : null;
  const available = metrics.detailMetrics?.driveAvailable ?? true;
  const efficiency = metrics.detailMetrics ? metrics.detailMetrics.avgEfficiencyWhPerM : metrics.avgEfficiencyWhPerM;
  const duration = metrics.detailMetrics ? metrics.detailMetrics.totalDurationS : metrics.totalDurationS;
  const stats = [
    numericPresentedMetric(
      'avg-efficiency',
      'efficiency',
      t('analytics.weeklyDigest.avgEfficiency', 'Avg efficiency'),
      efficiency,
      raw => formatEfficiencyFromSI(raw, unitPrefs),
      available,
      <BarChart3 className="h-4 w-4" aria-hidden="true" />,
    ),
    numericPresentedMetric(
      'driving-time',
      'duration',
      t('analytics.weeklyDigest.totalDrivingTime', 'Total driving time'),
      duration,
      formatDuration,
      available,
      <Clock className="h-4 w-4" aria-hidden="true" />,
    ),
    numericPresentedMetric(
      'efficiency-change',
      'percent',
      t('analytics.weeklyDigest.efficiencyChange', 'Efficiency change'),
      efficiency != null && Number.isFinite(efficiency)
        && Number.isFinite(metrics.prevAvgEfficiencyWhPerM) && metrics.prevAvgEfficiencyWhPerM > 0
        ? pctChange(efficiency, metrics.prevAvgEfficiencyWhPerM) : null,
      raw => `${fmtNumber(raw)}%`,
      available,
      (metrics.avgEfficiencyWhPerM ?? 0) <= (metrics.prevAvgEfficiencyWhPerM ?? 0)
        ? <TrendingDown className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        : <TrendingUp className="h-4 w-4 text-rose-300" aria-hidden="true" />,
    ),
    numericPresentedMetric(
      'drives-count',
      'count',
      t('analytics.weeklyDigest.drivesCount', 'Drives'),
      metrics.totalDrives,
      fmtInt,
      available,
      <Activity className="h-4 w-4" aria-hidden="true" />,
    ),
  ];

  const details = (
    <div className="flex min-w-0 flex-col gap-3">
      {/* As before, chart loading/error does not gate independent details. */}
      <StatGroup metrics={stats} period={period} />
      <div className="min-w-0 rounded-lg bg-[var(--surface-2)] p-3">
        {metrics.topDrive ? (
          <>
            <Badge variant="success" size="sm">
              {t('analytics.weeklyDigest.topDrive', 'Top drive')}
            </Badge>
            <StatGroup
              period={period}
              metrics={[
                presentedMetric(
                  'top-date',
                  t('analytics.weeklyDigest.date', 'Date'),
                  formatDate(metrics.topDrive.startTs),
                ),
                numericPresentedMetric(
                  'top-distance',
                  'distance',
                  t('analytics.weeklyDigest.distance', 'Distance'),
                  metrics.topDrive.distanceM,
                  formatDistance,
                ),
                numericPresentedMetric(
                  'top-duration',
                  'duration',
                  t('analytics.weeklyDigest.duration', 'Duration'),
                  metrics.topDrive.durationS,
                  formatDuration,
                ),
                numericPresentedMetric(
                  'top-efficiency',
                  'efficiency',
                  t('analytics.weeklyDigest.efficiency', 'Efficiency'),
                  topDriveEfficiencyWhPerM,
                  raw => formatEfficiencyFromSI(raw, unitPrefs),
                ),
              ]}
            />
          </>
        ) : (
          <EmptyState
            message={t('analytics.weeklyDigest.noTopDrive', 'No top drive is available for this week yet.')}
            actionTo={{ label: t('statistics.viewDrives', 'View drives'), to: '/drives' }}
            className="py-6"
          />
        )}
      </div>
    </div>
  );

  return (
    <ChartCard
        title={t('analytics.weeklyDigest.dailyDistance', 'Daily distance')}
        subtitle={`${t('analytics.weeklyDigest.drivingSection', 'Driving')} · ${t('analytics.weeklyDigest.dailyDistance', 'Daily distance ({{unit}})', {
          unit: unitPrefs.distance,
        })}`}
        footer={details}
        ariaLabel={t(
          'analytics.weeklyDigest.dailyDistanceChartLabel',
          'Bar chart of daily driving distance in {{unit}}',
          { unit: unitPrefs.distance },
        )}
        data={distanceChartData}
        dataColumns={[
          { key: 'day', label: t('analytics.weeklyDigest.day', 'Day') },
          {
            key: 'distance',
            label: t('analytics.weeklyDigest.dailyDistance', 'Daily distance ({{unit}})', {
              unit: unitPrefs.distance,
            }),
          },
        ]}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={onRetry}
        empty={!hasChart}
        emptyMessage={t(
          'analytics.weeklyDigest.noDailyDistance',
          'No driving distance data is available for this week.',
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={distanceChartData} margin={chartMarginLabeled}>
            {chartGrid}
            <XAxis dataKey="day" {...axisTickSm} />
            <YAxis {...axisTickSm} tickFormatter={(v: number) => fmtInt(v)} />
            <Tooltip content={<ChartTooltip />} />
            <Bar
              dataKey="distance"
              name={t('analytics.weeklyDigest.distance', 'Distance')}
              fill={CHART_COLORS[0]}
              radius={[4, 4, 0, 0]}
              {...chartAnimation}
            />
          </BarChart>
        </ResponsiveContainer>
    </ChartCard>
  );
}
