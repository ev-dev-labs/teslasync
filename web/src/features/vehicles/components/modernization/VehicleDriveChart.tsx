import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Route } from 'lucide-react';
import { ChartCard, LayoutCard } from '@/components/layout';
import {
  ChartTooltip, CHART_COLORS, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ChartLegend, AREA_DEFAULTS, areaGradient,
  type ChartDataColumn,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDate } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/api/types';

export function VehicleDriveChart({ drives }: { drives: Drive[] | undefined }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  // Exact source calculations/order and preference boundary, not new metrics.
  const driveChartData = useMemo(() =>
    (drives ?? []).map((d) => ({
      date: formatDate(d.start_ts),
      distance: Math.round(convertDistanceFromSI(d.distance_m ?? 0, unitPrefs.distance)),
      duration: Math.round((d.duration_s ?? 0) / 60),
    })).reverse(),
  [drives, unitPrefs.distance]);
  const driveColumns = useMemo<ChartDataColumn[]>(() => [
    { key: 'date', label: t('common.date', 'Date') },
    { key: 'distance', label: `${t('common.distance', 'Distance')} (${unitPrefs.distance})`, format: (v) => String(v ?? 0) },
    { key: 'duration', label: t('common.duration', 'Duration (min)'), format: (v) => String(v ?? 0) },
  ], [t, unitPrefs.distance]);
  const title = t('vehicles.detail.driveTrend', 'Drive distance trend');
  if (!driveChartData.length) {
    return (
      <LayoutCard title={title}>
        <EmptyState icon={<Route className="h-8 w-8" aria-hidden="true" />}
          message={t('vehicles.detail.noDriveData', 'No drive data for chart')}
          actionTo={{ label: t('common.viewAll', 'View all'), to: '/drives' }} />
      </LayoutCard>
    );
  }
  return (
    <ChartCard chartKey="battery-drive-trend" title={title}
      ariaLabel={t('vehicles.detail.driveTrendAria', 'Recent drive distance and duration area chart')}
      data={driveChartData} dataColumns={driveColumns}>
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={driveChartData}>
            {areaGradient('driveTrendDistGrad', CHART_COLORS[0])}
            {areaGradient('driveTrendDurGrad', CHART_COLORS[1])}
            <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
            <XAxis dataKey="date" stroke={chartTokens.axisStroke} fontSize={11} />
            <YAxis stroke={chartTokens.axisStroke} fontSize={11} />
            <Tooltip content={<ChartTooltip />} />
            <ChartLegend />
            <Area {...AREA_DEFAULTS} dataKey="distance"
              name={`${t('common.distance', 'Distance')} (${unitPrefs.distance})`}
              stroke={CHART_COLORS[0]} fill="url(#driveTrendDistGrad)"
              hide={hiddenSeries?.isHidden('distance') ?? false} />
            <Area {...AREA_DEFAULTS} dataKey="duration"
              name={t('common.duration', 'Duration')}
              stroke={CHART_COLORS[1]} fill="url(#driveTrendDurGrad)"
              hide={hiddenSeries?.isHidden('duration') ?? false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
