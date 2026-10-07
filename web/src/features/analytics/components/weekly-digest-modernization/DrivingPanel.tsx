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
import type { DigestMetrics, DailyDistanceEntry } from '../weekly-digest/types';
import { formatEfficiencyFromSI } from '../weekly-digest/display';
import { pctChange } from '../weekly-digest/helpers';
import { presentedMetric } from './presentation';

interface DrivingPanelProps {
  metrics: DigestMetrics;
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
    metrics.topDrive && (metrics.topDrive.distanceM ?? 0) > 0
      ? (metrics.topDrive.energyUsedWh ?? 0) / metrics.topDrive.distanceM
      : 0;
  const stats = [
    presentedMetric(
      'avg-efficiency',
      t('analytics.weeklyDigest.avgEfficiency', 'Avg efficiency'),
      formatEfficiencyFromSI(metrics.avgEfficiencyWhPerM ?? 0, unitPrefs),
      <BarChart3 className="h-4 w-4" aria-hidden="true" />,
    ),
    presentedMetric(
      'driving-time',
      t('analytics.weeklyDigest.totalDrivingTime', 'Total driving time'),
      formatDuration(metrics.totalDurationS ?? 0),
      <Clock className="h-4 w-4" aria-hidden="true" />,
    ),
    presentedMetric(
      'efficiency-change',
      t('analytics.weeklyDigest.efficiencyChange', 'Efficiency change'),
      (metrics.prevAvgEfficiencyWhPerM ?? 0) > 0
        ? `${fmtNumber(pctChange(
            metrics.avgEfficiencyWhPerM ?? 0,
            metrics.prevAvgEfficiencyWhPerM ?? 0,
          ))}%`
        : '—',
      (metrics.avgEfficiencyWhPerM ?? 0) <= (metrics.prevAvgEfficiencyWhPerM ?? 0)
        ? <TrendingDown className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        : <TrendingUp className="h-4 w-4 text-rose-300" aria-hidden="true" />,
    ),
    presentedMetric(
      'drives-count',
      t('analytics.weeklyDigest.drivesCount', 'Drives'),
      fmtInt(metrics.totalDrives ?? 0),
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
                presentedMetric(
                  'top-distance',
                  t('analytics.weeklyDigest.distance', 'Distance'),
                  formatDistance(metrics.topDrive.distanceM ?? 0),
                ),
                presentedMetric(
                  'top-duration',
                  t('analytics.weeklyDigest.duration', 'Duration'),
                  formatDuration(metrics.topDrive.durationS ?? 0),
                ),
                presentedMetric(
                  'top-efficiency',
                  t('analytics.weeklyDigest.efficiency', 'Efficiency'),
                  formatEfficiencyFromSI(topDriveEfficiencyWhPerM, unitPrefs),
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
