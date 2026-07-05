import { useTranslation } from 'react-i18next';
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
import { MiniStat } from './MiniStat';
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
  const distanceData = dailyDistanceData ?? [];
  const hasChart = distanceData.some((d) => (d.distance ?? 0) > 0);

  return (
    <GlassPanel className="flex h-full flex-col gap-5 p-4 sm:p-5">
      <PanelTitle className="flex items-center gap-2">
        <Car className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('analytics.weeklyDigest.drivingSection', 'Driving')}
      </PanelTitle>

      {/* Daily Distance bar chart */}
      <div>
        <Caption className="mb-2 block">
          {t('analytics.weeklyDigest.dailyDistance', 'Daily Distance (km)')}
        </Caption>
        {isLoading ? (
          <Skeleton height={220} />
        ) : isError ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : hasChart ? (
          <div
            className="h-56 sm:h-64 xl:h-72"
            role="img"
            aria-label={t('analytics.weeklyDigest.dailyDistanceChartLabel', 'Bar chart of daily driving distance in kilometres')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distanceData} margin={chartMarginLabeled}>
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
          value={`${fmtNumber(metrics.avgEfficiency ?? 0, 1)} Wh/km`}
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.totalDrivingTime', 'Total Driving Time')}
          value={`${fmtInt(Math.floor((metrics.totalDuration ?? 0) / 60))}h ${fmtInt((metrics.totalDuration ?? 0) % 60)}m`}
          icon={<Clock className="h-4 w-4" />}
        />
        <MiniStat
          label={t('analytics.weeklyDigest.efficiencyChange', 'Efficiency Change')}
          value={
            (metrics.prevAvgEfficiency ?? 0) > 0
              ? `${fmtNumber(pctChange(metrics.avgEfficiency ?? 0, metrics.prevAvgEfficiency ?? 0), 1)}%`
              : '—'
          }
          icon={
            (metrics.avgEfficiency ?? 0) <= (metrics.prevAvgEfficiency ?? 0) ? (
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
                  {formatDate(metrics.topDrive.start_date)}
                </Text>
              </div>
              <div className="flex min-w-0 flex-col">
                <Caption>{t('analytics.weeklyDigest.distance', 'Distance')}</Caption>
                <Text size="sm" weight="semibold" color="primary" className="truncate">
                  {fmtNumber(metrics.topDrive.distance ?? 0, 1)} km
                </Text>
              </div>
              <div className="flex min-w-0 flex-col">
                <Caption>{t('analytics.weeklyDigest.duration', 'Duration')}</Caption>
                <Text size="sm" weight="semibold" color="primary" className="truncate">
                  {fmtInt(metrics.topDrive.duration_min ?? 0)} min
                </Text>
              </div>
              <div className="flex min-w-0 flex-col">
                <Caption>{t('analytics.weeklyDigest.efficiency', 'Efficiency')}</Caption>
                <Text size="sm" weight="semibold" color="primary" className="truncate">
                  {fmtNumber(metrics.topDrive.efficiency_wh_km ?? 0, 1)} Wh/km
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
