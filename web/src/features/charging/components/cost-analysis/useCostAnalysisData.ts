import { useMemo } from 'react';
import type { ChargingSession } from '@/api/types';
import { distanceAddedM, durationMinutes } from '../charging-curve/helpers';
import { formatDateShort } from '@/lib/dateFormat';
import { CHART_COLORS, CHARGER_COLORS } from '@/lib/colors';
import { KWH_PER_GALLON, CO2_PER_GAL_KG, KG_CO2_PER_TREE_YEAR } from './constants';
import { categorizeCharger, gasEquivalentCost } from './helpers';
import type {
  CoreStats, MonthlyBucket, ChargerTypeData, HourBucket,
  TouInsights, GasComparison, LifetimeMetrics,
} from './types';

interface UseCostAnalysisDataParams {
  sessions: ChargingSession[] | undefined;
  gasPrice: number;
  mpg: number;
  electricityRate: number;
  toDistanceDisplay: (km: number) => number;
  isMiles: boolean;
}

interface UseCostAnalysisDataResult {
  coreStats: CoreStats | null;
  monthlyData: MonthlyBucket[];
  costPerKwhTrend: { date: string; costPerKwh: number }[];
  chargerTypeData: ChargerTypeData[];
  hourlyData: HourBucket[];
  touInsights: TouInsights | null;
  gasComparison: GasComparison | null;
  lifetimeMetrics: LifetimeMetrics | null;
}

export function useCostAnalysisData({
  sessions,
  gasPrice,
  mpg,
  electricityRate,
  toDistanceDisplay,
  isMiles,
}: UseCostAnalysisDataParams): UseCostAnalysisDataResult {
  const coreStats = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    const totalCost = sessions.reduce((s, c) => s + (c.cost_decimal ?? 0), 0);
    const totalEnergy = sessions.reduce((s, c) => s + c.total_energy_added_wh, 0);
    const avgCostPerKwh = totalEnergy > 0 ? totalCost / (totalEnergy / 1000) : 0;
    const totalDuration = sessions.reduce((s, c) => s + durationMinutes(c.started_at, c.ended_at), 0);

    let totalDistanceM = 0;
    sessions.forEach((s) => {
      totalDistanceM += (distanceAddedM(s) ?? 0);
    });

    const distVal = toDistanceDisplay(totalDistanceM / 1609.344);
    const costPerDist = distVal > 0 ? totalCost / distVal : 0;

    const gallonsEquiv = totalEnergy / KWH_PER_GALLON;
    const gasCost = gallonsEquiv * gasPrice;
    const savings = gasCost - totalCost;
    const savingsPercent = gasCost > 0 ? (savings / gasCost) * 100 : 0;

    const co2SavedKg = gallonsEquiv * CO2_PER_GAL_KG;
    const treeEquiv = co2SavedKg / KG_CO2_PER_TREE_YEAR;

    return {
      totalCost, totalEnergy, avgCostPerKwh, totalDuration,
      totalDistanceM, costPerDist, gasCost, savings, savingsPercent,
      co2SavedKg, treeEquiv, gallonsEquiv, count: sessions.length,
    };
  }, [sessions, gasPrice, toDistanceDisplay]);

  const monthlyData = useMemo<MonthlyBucket[]>(() => {
    if (!sessions || sessions.length === 0) return [];
    const buckets: Record<string, { cost: number; energy: number; sessions: number }> = {};
    sessions.forEach((s) => {
      const d = new Date(s.started_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets[key]) buckets[key] = { cost: 0, energy: 0, sessions: 0 };
      buckets[key].cost += s.cost_decimal ?? 0;
      buckets[key].energy += s.total_energy_added_wh;
      buckets[key].sessions++;
    });
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => {
        const ge = gasEquivalentCost(v.energy, mpg, gasPrice);
        return {
          month,
          cost: v.cost,
          energy: v.energy,
          sessions: v.sessions,
          avgCostPerKwh: v.energy > 0 ? v.cost / (v.energy / 1000) : 0,
          gasEquiv: ge,
          savings: ge - v.cost,
        };
      });
  }, [sessions, gasPrice, mpg]);

  const costPerKwhTrend = useMemo(() => {
    if (!sessions || sessions.length === 0) return [];
    return sessions
      .filter((s) => s.cost_decimal != null && s.total_energy_added_wh > 0)
      .sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      )
      .map((s) => ({
        date: formatDateShort(s.started_at),
        costPerKwh: (s.cost_decimal ?? 0) / (s.total_energy_added_wh / 1000),
      }));
  }, [sessions]);

  const chargerTypeData = useMemo<ChargerTypeData[]>(() => {
    if (!sessions || sessions.length === 0) return [];
    const groups: Record<string, { cost: number; energy: number; sessions: number }> = {};
    sessions.forEach((s) => {
      const cat = categorizeCharger(s);
      if (!groups[cat]) groups[cat] = { cost: 0, energy: 0, sessions: 0 };
      groups[cat].cost += s.cost_decimal ?? 0;
      groups[cat].energy += s.total_energy_added_wh;
      groups[cat].sessions++;
    });
    return Object.entries(groups)
      .map(([name, v]) => ({
        name,
        cost: v.cost,
        energy: v.energy,
        sessions: v.sessions,
        color: CHARGER_COLORS[name] ?? CHART_COLORS[4],
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [sessions]);

  const hourlyData = useMemo<HourBucket[]>(() => {
    if (!sessions || sessions.length === 0) return [];
    const buckets: Record<number, { sessions: number; totalCost: number; totalEnergy: number }> = {};
    for (let h = 0; h < 24; h++) {
      buckets[h] = { sessions: 0, totalCost: 0, totalEnergy: 0 };
    }
    sessions.forEach((s) => {
      const hour = new Date(s.started_at).getHours();
      buckets[hour].sessions++;
      buckets[hour].totalCost += s.cost_decimal ?? 0;
      buckets[hour].totalEnergy += s.total_energy_added_wh;
    });
    return Object.entries(buckets)
      .map(([h, v]) => ({
        hour: Number(h),
        label: `${String(h).padStart(2, '0')}:00`,
        sessions: v.sessions,
        avgCost: v.sessions > 0 ? v.totalCost / v.sessions : 0,
        totalEnergy: v.totalEnergy,
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [sessions]);

  const touInsights = useMemo<TouInsights | null>(() => {
    if (hourlyData.length === 0) return null;
    const withSessions = hourlyData.filter((h) => h.sessions > 0);
    if (withSessions.length === 0) return null;
    const cheapest = [...withSessions].sort((a, b) => a.avgCost - b.avgCost)[0];
    const priciest = [...withSessions].sort((a, b) => b.avgCost - a.avgCost)[0];
    const busiest = [...withSessions].sort((a, b) => b.sessions - a.sessions)[0];
    const offPeakCount = sessions?.filter((s) => {
      const h = new Date(s.started_at).getHours();
      return h >= 22 || h < 6;
    }).length ?? 0;
    const offPeakPct = sessions && sessions.length > 0
      ? (offPeakCount / sessions.length) * 100
      : 0;
    return { cheapest, priciest, busiest, offPeakPct };
  }, [hourlyData, sessions]);

  const gasComparison = useMemo<GasComparison | null>(() => {
    if (!coreStats) return null;
    const { totalEnergy, totalCost, totalDistanceM } = coreStats;
    const distMiles = toDistanceDisplay(totalDistanceM / 1609.344);
    const gallonsNeeded = isMiles
      ? distMiles / mpg
      : toDistanceDisplay(totalDistanceM / 1609.344) / mpg;
    const gasCostCalc = gallonsNeeded * gasPrice;
    const evCostCalc = totalEnergy * electricityRate;
    const monthlySavings =
      monthlyData.length > 0
        ? (gasCostCalc - evCostCalc) / Math.max(monthlyData.length, 1)
        : 0;
    const yearlySavings = monthlySavings * 12;

    return {
      gasCost: gasCostCalc,
      evCost: evCostCalc,
      actualCost: totalCost,
      savings: gasCostCalc - totalCost,
      monthlySavings,
      yearlySavings,
      costPerMileGas: distMiles > 0 ? gasCostCalc / distMiles : 0,
      costPerMileEV: distMiles > 0 ? totalCost / distMiles : 0,
    };
  }, [coreStats, gasPrice, mpg, electricityRate, isMiles, toDistanceDisplay, monthlyData.length]);

  const lifetimeMetrics = useMemo<LifetimeMetrics | null>(() => {
    if (!sessions || sessions.length === 0 || !coreStats) return null;
    const avgSessionCost =
      coreStats.count > 0 ? coreStats.totalCost / coreStats.count : 0;
    const avgSessionEnergy =
      coreStats.count > 0 ? coreStats.totalEnergy / coreStats.count : 0;
    const avgDuration =
      coreStats.count > 0 ? coreStats.totalDuration / coreStats.count : 0;
    const freeCount = sessions.filter(
      (s) => !s.cost_decimal || s.cost_decimal === 0,
    ).length;
    const freeEnergy = sessions
      .filter((s) => !s.cost_decimal || s.cost_decimal === 0)
      .reduce((sum, s) => sum + s.total_energy_added_wh, 0);
    const maxSessionCost = Math.max(...sessions.map((s) => s.cost_decimal ?? 0));
    const minSessionCost = Math.min(
      ...sessions.filter((s) => (s.cost_decimal ?? 0) > 0).map((s) => s.cost_decimal!),
      0,
    );

    return {
      avgSessionCost, avgSessionEnergy, avgDuration,
      freeCount, freeEnergy, maxSessionCost, minSessionCost,
    };
  }, [sessions, coreStats]);

  return {
    coreStats, monthlyData, costPerKwhTrend, chargerTypeData,
    hourlyData, touInsights, gasComparison, lifetimeMetrics,
  };
}
