import type { TFunction } from 'i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { StatsPresentation } from './types';
import { finite } from './model';

/** Domain labels/derivations remain local; generic metric IDs are quantities, not new semantics. */
export function efficiencyMetrics(
  { stats, model, units }: StatsPresentation,
  t: TFunction,
  fmtNumber: (value: number) => string,
  fmtInt: (value: number) => string,
) {
  const { unitPrefs, formatEnergy } = units;
  const { toStatsDistanceDisplay } = model;
  const intensity = stats?.avgEfficiencyWhKm;
  const cost = finite(stats?.totalDistanceKm) && stats.totalDistanceKm > 0 && finite(intensity)
    ? (intensity / 1000) * 0.12 : null;
  const economyValue = finite(intensity) && intensity > 0
    ? toStatsDistanceDisplay(1000 / intensity) : null;
  const economy = finite(economyValue) ? fmtNumber(economyValue) : null;
  const co2 = finite(stats?.co2SavedKg) ? `${fmtInt(stats.co2SavedKg)} ${t('efficiency.kgUnit', 'kg')}` : null;
  const kpis: StatMetric[] = [
    { metricId: 'efficiency', occurrenceId: 'avgConsumption', label: t('efficiency.avgConsumption', 'Avg consumption'),
      rawValue: finite(intensity) ? intensity / 1000 : null, display: { units: { energy: 'Wh' } } },
    // Reciprocal economy is NOT energy intensity. Preserve the specialist formatter.
    { metricId: 'text', occurrenceId: 'distancePerKwh', label: t('efficiency.efficiencyLabel', 'Efficiency'),
      rawValue: economy, context: `${unitPrefs.distance}/kWh` },
    { metricId: 'speed', occurrenceId: 'avgSpeed', label: t('efficiency.avgSpeed', 'Avg speed'),
      rawValue: finite(stats?.avgSpeedKmh) ? stats.avgSpeedKmh * 1000 / 3600 : null },
    { metricId: 'speed', occurrenceId: 'topSpeed', label: t('efficiency.topSpeed', 'Top speed'),
      rawValue: finite(stats?.topSpeedKmh) ? stats.topSpeedKmh * 1000 / 3600 : null, display: { precision: 0 } },
    { metricId: 'text', occurrenceId: 'co2SavedKg', label: t('efficiency.co2Label', 'CO₂ saved'), rawValue: co2 },
    { metricId: 'distance', occurrenceId: 'totalDistanceKm', label: t('efficiency.totalDistLabel', 'Total distance'),
      rawValue: finite(stats?.totalDistanceKm) ? stats.totalDistanceKm * 1000 : null, display: { precision: 0 } },
    { metricId: 'currency', occurrenceId: 'costPerKm', label: t('efficiency.costPerKm', 'Est. cost/km'), rawValue: cost },
    { metricId: 'count', occurrenceId: 'totalDrives', label: t('efficiency.drivesAnalyzed', 'Drives analyzed'),
      rawValue: finite(stats?.totalDrives) ? stats.totalDrives : null },
  ];
  const insights: StatMetric[] = [
    { metricId: 'text', occurrenceId: 'regen', label: t('efficiency.totalRegen', 'Total regen'),
      rawValue: finite(stats?.regenEnergyWh) ? formatEnergy(stats.regenEnergyWh) : null },
    { metricId: 'percent', occurrenceId: 'ratio', label: t('efficiency.regenRatioLabel', 'Regen ratio'),
      rawValue: finite(stats?.regenRatio) ? stats.regenRatio * 100 : null },
    { ...kpis[4], occurrenceId: 'co2' },
    { ...kpis[5], occurrenceId: 'dist' },
    { ...kpis[3], occurrenceId: 'top' },
    { ...kpis[6], occurrenceId: 'cost', label: t('efficiency.costPerKmLabel', 'Est. cost/km') },
  ];
  return { kpis, insights, cost, economy };
}
