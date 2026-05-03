import { useTranslation } from 'react-i18next';
import { Car, BarChart3, Clock, TrendingDown, TrendingUp, Activity } from 'lucide-react';
import { GlassPanel, Badge } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
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
}

export function DrivingSection({ metrics, dailyDistanceData }: DrivingSectionProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="space-y-6 p-6">
        <span className="flex items-center gap-2 text-lg font-bold text-white">
          <Car className="h-5 w-5 text-neon-cyan" />
          {t('analytics.weeklyDigest.drivingSection', 'Driving')}
        </span>

        {/* Daily Distance BarChart */}
        <GlassPanel className="p-4">
          <span className="mb-3 block text-sm font-medium text-[var(--text-secondary)]">
            {t('analytics.weeklyDigest.dailyDistance', 'Daily Distance (km)')}
          </span>
          {dailyDistanceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailyDistanceData} margin={chartMarginLabeled}>
                {chartGrid}
                <XAxis dataKey="day" {...axisTickSm} />
                <YAxis
                  {...axisTickSm}
                  tickFormatter={(v: number) => fmtInt(v)}
                />
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
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              message={t('analytics.weeklyDigest.noDailyDistance', 'No driving distance data is available for this week.')}
              className="py-8"
            />
          )}
        </GlassPanel>

        {/* Driving efficiency stats */}
        <span className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat
            label={t('analytics.weeklyDigest.avgEfficiency', 'Avg Efficiency')}
            value={`${fmtNumber(metrics.avgEfficiency, 1)} Wh/km`}
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.totalDrivingTime', 'Total Driving Time')}
            value={`${fmtInt(Math.floor(metrics.totalDuration / 60))}h ${fmtInt(metrics.totalDuration % 60)}m`}
            icon={<Clock className="h-4 w-4" />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.efficiencyChange', 'Efficiency Change')}
            value={
              metrics.prevAvgEfficiency > 0
                ? `${fmtNumber(pctChange(metrics.avgEfficiency, metrics.prevAvgEfficiency), 1)}%`
                : '—'
            }
            icon={
              metrics.avgEfficiency <= metrics.prevAvgEfficiency ? (
                <TrendingDown className="h-4 w-4 text-emerald-400" />
              ) : (
                <TrendingUp className="h-4 w-4 text-red-400" />
              )
            }
          />
          <MiniStat
            label={t('analytics.weeklyDigest.drivesCount', 'Drives')}
            value={fmtInt(metrics.totalDrives)}
            icon={<Activity className="h-4 w-4" />}
          />
        </span>

        {/* Top drive card */}
        <GlassPanel className="p-4">
          {metrics.topDrive ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
              <Badge variant="success" size="sm">
                {t('analytics.weeklyDigest.topDrive', 'Top Drive')}
              </Badge>
              <span className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <span className="flex flex-col">
                  <span className="text-xs text-[var(--text-secondary)]">
                    {t('analytics.weeklyDigest.date', 'Date')}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {formatDate(metrics.topDrive.start_date)}
                  </span>
                </span>
                <span className="flex flex-col">
                  <span className="text-xs text-[var(--text-secondary)]">
                    {t('analytics.weeklyDigest.distance', 'Distance')}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {fmtNumber(metrics.topDrive.distance, 1)} km
                  </span>
                </span>
                <span className="flex flex-col">
                  <span className="text-xs text-[var(--text-secondary)]">
                    {t('analytics.weeklyDigest.duration', 'Duration')}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {fmtInt(metrics.topDrive.duration_min)} min
                  </span>
                </span>
                <span className="flex flex-col">
                  <span className="text-xs text-[var(--text-secondary)]">
                    {t('analytics.weeklyDigest.efficiency', 'Efficiency')}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {fmtNumber(metrics.topDrive.efficiency_wh_km, 1)} Wh/km
                  </span>
                </span>
              </span>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              message={t('analytics.weeklyDigest.noTopDrive', 'No top drive is available for this week yet.')}
              className="py-6"
            />
          )}
        </GlassPanel>
      </GlassPanel>
    </FadeIn>
  );
}
