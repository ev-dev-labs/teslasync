import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { Car, BarChart3, Clock, TrendingDown, TrendingUp, Activity } from 'lucide-react';
import { GlassPanel, Badge, PanelTitle, Text, Caption } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import {
  ChartTooltip, CHART_COLORS,
  chartGrid, axisTickSm, chartMarginLabeled, chartAnimation,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { formatDate } from '@/lib/dateFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { MiniStat } from './MiniStat';
import { formatEfficiencyFromSI } from './display';
import { pctChange } from './helpers';
import type { DigestMetrics, DailyDistanceEntry } from './types';

interface DrivingSectionProps {
  metrics: DigestMetrics;
  dailyDistanceData: DailyDistanceEntry[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function DrivingSection({
  metrics,
  dailyDistanceData,
  isLoading,
  isError,
  error,
  onRetry,
}: DrivingSectionProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatDistance, formatDuration } = useUnits();
  const distanceData = dailyDistanceData ?? [];
  const hasChart = distanceData.some((entry) => (entry.distanceM ?? 0) > 0);
  const distanceChartData = useMemo(
    () =>
      distanceData.map((entry) => ({
        day: entry.day,
        distance: convertDistanceFromSI(entry.distanceM ?? 0, unitPrefs.distance),
      })),
    [distanceData, unitPrefs.distance],
  );
  const topDriveEfficiencyWhPerM =
    metrics.topDrive && (metrics.topDrive.distanceM ?? 0) > 0
      ? (metrics.topDrive.energyUsedWh ?? 0) / metrics.topDrive.distanceM
      : 0;

  return (
    <GlassPanel className="flex h-full flex-col gap-5 p-4 sm:p-5">
      <PanelTitle className="flex items-center gap-2">
        <Car className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('analytics.weeklyDigest.drivingSection', 'Driving')}
      </PanelTitle>

      {/* Daily Distance bar chart */}
      <div>
        <Caption className="mb-2 block">
          {t('analytics.weeklyDigest.dailyDistance', 'Daily Distance ({{unit}})', {
            unit: unitPrefs.distance,
          })}
        </Caption>
        {isLoading ? (
          <Skeleton height={220} />
        ) : isError ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : hasChart ? (
          <div
            className="h-56 sm:h-64 xl:h-72"
            role="img"
            aria-label={t(
              'analytics.weeklyDigest.dailyDistanceChartLabel',
              'Bar chart of daily driving distance in {{unit}}',
              { unit: unitPrefs.distance },
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
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t('analytics.weeklyDigest.noDailyDistance', 'No driving distance data is available for this week.')}
            className="py-8"
          />
        )}
      </div>

      {/* Driving efficiency stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MiniStat
          label={t('analytics.weeklyDigest.avgEfficiency', 'Avg Efficiency')}
          value={formatEfficiencyFromSI(metrics.avgEfficiencyWhPerM ?? 0, unitPrefs)}
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.totalDrivingTime', 'Total Driving Time')}
          value={formatDuration(metrics.totalDurationS ?? 0, { precision: 1 })}
          icon={<Clock className="h-4 w-4" />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.efficiencyChange', 'Efficiency Change')}
          value={
            (metrics.prevAvgEfficiencyWhPerM ?? 0) > 0
              ? `${fmtNumber(
                  pctChange(
                    metrics.avgEfficiencyWhPerM ?? 0,
                    metrics.prevAvgEfficiencyWhPerM ?? 0,
                  ),
                  1,
                )}%`
              : '—'
          }
          icon={
            (metrics.avgEfficiencyWhPerM ?? 0) <=
            (metrics.prevAvgEfficiencyWhPerM ?? 0) ? (
              <TrendingDown className="h-4 w-4 text-emerald-300" />
            ) : (
              <TrendingUp className="h-4 w-4 text-rose-300" />
            )
          }
        />
        <MiniStat
          label={t('analytics.weeklyDigest.drivesCount', 'Drives')}
          value={fmtInt(metrics.totalDrives ?? 0)}
          icon={<Activity className="h-4 w-4" />}
        />
      </div>

      {/* Top drive card */}
      <GlassPanel className="mt-auto p-4">
        {metrics.topDrive ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <Badge variant="success" size="sm">
              {t('analytics.weeklyDigest.topDrive', 'Top Drive')}
            </Badge>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="flex min-w-0 flex-col">
                <Caption>{t('analytics.weeklyDigest.date', 'Date')}</Caption>
                <Text size="sm" weight="semibold" color="primary" className="truncate">
                {formatDate(metrics.topDrive.startTs)}
                </Text>
              </div>
              <div className="flex min-w-0 flex-col">
                <Caption>{t('analytics.weeklyDigest.distance', 'Distance')}</Caption>
                <Text size="sm" weight="semibold" color="primary" className="truncate">
                  {formatDistance(metrics.topDrive.distanceM ?? 0, { precision: 1 })}
                </Text>
              </div>
              <div className="flex min-w-0 flex-col">
                <Caption>{t('analytics.weeklyDigest.duration', 'Duration')}</Caption>
                <Text size="sm" weight="semibold" color="primary" className="truncate">
                  {formatDuration(metrics.topDrive.durationS ?? 0, { precision: 1 })}
                </Text>
              </div>
              <div className="flex min-w-0 flex-col">
                <Caption>{t('analytics.weeklyDigest.efficiency', 'Efficiency')}</Caption>
                <Text size="sm" weight="semibold" color="primary" className="truncate">
                  {formatEfficiencyFromSI(topDriveEfficiencyWhPerM, unitPrefs)}
                </Text>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t('analytics.weeklyDigest.noTopDrive', 'No top drive is available for this week yet.')}
            className="py-6"
          />
        )}
      </GlassPanel>
    </GlassPanel>
  );
}
