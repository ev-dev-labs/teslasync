import { useCallback, useMemo } from 'react';
import type { MetricSwitcherMetric } from '@/components/charts';
import type { DriveGridStats } from '@/api/hooks/useDriveGrid';
import { formatDayKey } from '@/lib/dateFormat';
import { detectAnomalies, gradeFromEfficiency, gradeFromNumeric, type TrendMetric, type TrendPoint } from '@/lib/drivesAggregation';
import { COLOR, DATA_VISUAL_COLORS } from '@/lib/colors';
import type { useDrivesListPageData } from './useDrivesListPageData';
import type { Drive } from '@/types/driving';

function stats(data?: DriveGridStats) {
  return {
    count: data?.count ?? 0,
    totalDistanceM: data?.total_distance_m ?? 0,
    totalDurationS: data?.total_duration_s ?? 0,
    totalEnergyWh: data?.total_energy_wh ?? 0,
    energyMeasuredCount: data?.energy_measured_count ?? 0,
    efficiencyMeasuredCount: data?.efficiency_measured_count ?? 0,
    avgEfficiencyWhKm: data?.efficiency_wh_per_m == null ? null : data.efficiency_wh_per_m * 1000,
    topSpeedMps: data?.top_speed_mps ?? null,
    longestDistanceM: data?.longest_distance_m ?? null,
  };
}

export function useDrivesListRange(data: ReturnType<typeof useDrivesListPageData>, paginatedDrives: Drive[]) {
  const {
    drivesState, t, fmtInt, fmtNumber, toDistanceDisplay, distanceUnit,
    toEfficiencyDisplay, efficiencyUnit, costPerKwh, formatCurrency,
  } = data;
  const overview = drivesState.data;
  const currentStats = stats(overview?.current);
  const priorStats = overview?.prior ? stats(overview.prior) : null;
  const anomalyDriveIds = useMemo(() => new Set(detectAnomalies(paginatedDrives).map(drive => drive.id)), [paginatedDrives]);
  const trendSeries = useMemo(() => {
    const series: Record<TrendMetric, TrendPoint[]> = { drives: [], distance: [], score: [], efficiency: [], cost: [] };
    for (const day of overview?.days ?? []) {
      const { date } = day;
      series.drives.push({ date, value: day.count });
      series.distance.push({ date, value: day.total_distance_m });
      if (day.energy_measured_count > 0) series.cost.push({ date, value: day.total_energy_wh });
      if (day.efficiency_wh_per_m != null) {
        const efficiency = day.efficiency_wh_per_m * 1000;
        const grade = gradeFromEfficiency(efficiency).numeric;
        series.efficiency.push({ date, value: efficiency });
        if (grade != null) series.score.push({ date, value: grade });
      }
    }
    return series;
  }, [overview]);
  const trendMetricsConfig: MetricSwitcherMetric<TrendPoint>[] = useMemo(() => [
    { key: 'drives', label: t('drives.metric.drives', 'Drives'), chart: 'bar', color: DATA_VISUAL_COLORS.info, accent: 'cyan',
      formatValue: fmtInt, formatTick: fmtInt },
    { key: 'distance', label: t('drives.metric.distance', 'Distance'), chart: 'bar', color: COLOR.GOOD, accent: 'green',
      getValue: p => toDistanceDisplay(p.value), formatValue: v => `${fmtNumber(v)} ${distanceUnit}`, formatTick: v => fmtNumber(v) },
    { key: 'score', label: t('drives.metric.grade', 'Efficiency grade'), chart: 'line', color: DATA_VISUAL_COLORS.purple, accent: 'purple',
      formatValue: v => gradeFromNumeric(v).label, formatTick: v => fmtNumber(v) },
    { key: 'efficiency', label: t('drives.metric.efficiency', 'Efficiency'), chart: 'line', color: COLOR.WARN, accent: 'amber',
      getValue: p => toEfficiencyDisplay(p.value), formatValue: v => `${fmtInt(v)} ${efficiencyUnit}`, formatTick: fmtInt },
    { key: 'cost', label: t('drives.metric.cost', 'Cost'), chart: 'bar', color: COLOR.BAD, accent: 'red',
      getValue: p => costPerKwh != null ? p.value / 1000 * costPerKwh : null, formatValue: v => formatCurrency(v), formatTick: v => formatCurrency(v) },
  ], [t, fmtInt, fmtNumber, toDistanceDisplay, distanceUnit, toEfficiencyDisplay, efficiencyUnit, costPerKwh, formatCurrency]);
  const formatChartXTick = useCallback((key: string) => formatDayKey(key, { style: 'short' }), []);
  return {
    currentStats, priorStats, anomalyDriveIds, trendSeries, trendMetricsConfig, formatChartXTick,
    anomalyCount: overview?.anomaly_count ?? 0, notableCount: overview?.notable_count ?? 0,
    commuteCount: overview?.commute_count ?? 0, routeContextCount: overview?.route_context_count ?? 0,
    narrativeEvidence: overview?.evidence ?? [],
  };
}
