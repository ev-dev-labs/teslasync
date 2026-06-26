// Native parity port of
// web/src/features/charging/components/cost-analysis/useCostAnalysisData.ts.
//
// This module is a pure, non-visual data hook for the Cost Analysis page: it
// memoizes eight derived datasets (coreStats, monthlyData, costPerKwhTrend,
// chargerTypeData, hourlyData, touInsights, gasComparison, lifetimeMetrics)
// from a list of ChargingSession rows plus user pricing/economy inputs. There
// is no DOM, JSX, Recharts, Leaflet, browser-only behavior, or old web UI
// component to adapt — `react`'s `useMemo` is the only runtime dependency and
// is identical under React Native — so every computation, state name, API field
// name, and unit-handling expression is ported verbatim and behaves identically.
//
// Native adaptations (each documented in the .parity.json sidecar) only concern
// the web imports (source L1-L12), none of whose sibling/`@/lib` modules have a
// native-parity port yet, except `./constants` which IS already ported in this
// same directory and is imported here exactly as web L6 does:
//   - web L1 `useMemo` from 'react'              -> identical native import.
//   - web L2 `ChargingSession` from '@/api/types' -> native parity api/types
//     barrel (four levels up: cost-analysis -> components -> charging ->
//     features -> web-parity, then /api/types).
//   - web L3 `distanceAddedM`, `durationMinutes` from '../charging-curve/helpers'
//     -> inlined native-safe verbatim ports (no native charging-curve port yet).
//   - web L4 `formatDateShort` from '@/lib/dateFormat' -> inlined native-safe
//     port (short "Apr 4" date; universal "—" for nullish/invalid input).
//   - web L5 `CHART_COLORS`, `CHARGER_COLORS` from '@/lib/colors' -> inlined
//     verbatim (CHART_COLORS resolves to the CB-safe Okabe-Ito palette default).
//   - web L6 `KWH_PER_GALLON`, `CO2_PER_GAL_KG`, `KG_CO2_PER_TREE_YEAR` from
//     './constants' -> imported from the already-ported native ./constants module.
//   - web L7 `categorizeCharger`, `gasEquivalentCost` from './helpers' ->
//     inlined native-safe verbatim ports (no native ./helpers port yet).
//   - web L8 `convertEnergyFromSI` from '@/lib/unitConversion' -> inlined
//     verbatim (SI watt-hours -> kWh display unit).
//   - web L9-12 the seven `./types` interfaces -> reproduced locally as
//     byte-for-byte interface ports so the result contract is identical.

import {useMemo} from 'react';

import type {ChargingSession} from '../../../../api/types';
import {
  KWH_PER_GALLON,
  CO2_PER_GAL_KG,
  KG_CO2_PER_TREE_YEAR,
} from './constants';

// ── Inlined native-safe ports of the web lib/sibling dependencies (web L3-L8) ─

// web L8: `convertEnergyFromSI` from `@/lib/unitConversion`. Ported verbatim
// (SI watt-hours -> display unit). Only the 'kWh' branch is exercised here.
type EnergyUnitPref = 'Wh' | 'kWh';

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

// web L4: `formatDateShort` from `@/lib/dateFormat`. Short date "Apr 4";
// returns the universal "—" placeholder for nullish/invalid input, identical to
// the web helper's no-options path (the hook never passes the optional opts).
function formatDateShort(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(d);
}

// web L5: `CHART_COLORS` from `@/lib/colors`. The bare `CHART_COLORS` export
// resolves to the color-blind-safe Okabe-Ito palette (`CHART_COLORS_CB_SAFE`);
// ported verbatim so `CHART_COLORS[4]` ('#56B4E9') matches the web fallback.
const CHART_COLORS: readonly string[] = [
  '#0072B2', // blue
  '#E69F00', // orange
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#56B4E9', // sky blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#4B4B4B', // neutral grey (replaces pure black for dark-theme legibility)
];

// web L5: `CHARGER_COLORS` from `@/lib/colors`. Ported verbatim (internal keys
// + the display-name keys this CostAnalysis hook looks up by category name).
const CHARGER_COLORS: Record<string, string> = {
  // Internal keys (Charging page)
  supercharger: '#ef4444',
  dc: '#f59e0b',
  home: '#10b981',
  // Display-name keys (CostAnalysis page)
  Home: '#10b981',
  Supercharger: '#ef4444',
  'Public DC': '#a855f7',
  'Work / L2': '#f59e0b',
  Other: '#6366f1',
};

// web L3: `durationMinutes` from `../charging-curve/helpers`. Ported verbatim
// (whole-minute duration between two ISO timestamps; 0 for missing/invalid).
function durationMinutes(startedAt: string, endedAt: string | null): number {
  if (!endedAt) {
    return 0;
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return Math.round((end - start) / 60000);
}

// web L3: `distanceAddedM` from `../charging-curve/helpers`. Ported verbatim
// (positive odometer delta in meters, or null when endpoints are missing/flat).
function distanceAddedM(s: ChargingSession): number | null {
  if (s.start_odometer_m == null || s.end_odometer_m == null) {
    return null;
  }
  const delta = s.end_odometer_m - s.start_odometer_m;
  return delta > 0 ? delta : null;
}

// web L7: `categorizeCharger` from `./helpers`. Ported verbatim (maps a session
// to one of the display-name categories used as CHARGER_COLORS keys above).
function categorizeCharger(session: ChargingSession): string {
  const ct = (session.charger_type ?? '').toLowerCase();
  if (ct.includes('tesla') || ct.includes('supercharger')) {
    return 'Supercharger';
  }
  if ((session.peak_power_w ?? 0) > 22_000) {
    return 'Public DC';
  }
  const loc = (session.start_place ?? '').toLowerCase();
  if (loc.includes('work') || loc.includes('office')) {
    return 'Work / L2';
  }
  return 'Home';
}

// web L7: `gasEquivalentCost` from `./helpers`. Ported verbatim (gallons of gas
// energy-equivalent to the kWh charged, priced at the user's gas price).
function gasEquivalentCost(
  energyKwh: number,
  mpg: number,
  gasPrice: number,
): number {
  const gallonsEquiv = energyKwh / KWH_PER_GALLON;
  const milesEquiv = gallonsEquiv * mpg;
  return (milesEquiv / mpg) * gasPrice;
}

// ── Inlined verbatim ports of the web `./types` interfaces (web L9-L12) ───────

export interface CoreStats {
  totalCost: number;
  totalEnergy: number;
  avgCostPerKwh: number;
  totalDuration: number;
  totalDistanceM: number;
  costPerDist: number;
  gasCost: number;
  savings: number;
  savingsPercent: number;
  co2SavedKg: number;
  treeEquiv: number;
  gallonsEquiv: number;
  count: number;
}

export interface MonthlyBucket {
  month: string;
  cost: number;
  energy: number;
  sessions: number;
  avgCostPerKwh: number;
  gasEquiv: number;
  savings: number;
}

export interface ChargerTypeData {
  name: string;
  cost: number;
  energy: number;
  sessions: number;
  color: string;
}

export interface HourBucket {
  hour: number;
  label: string;
  sessions: number;
  avgCost: number;
  totalEnergy: number;
}

export interface TouInsights {
  cheapest: HourBucket;
  priciest: HourBucket;
  busiest: HourBucket;
  offPeakPct: number;
}

export interface GasComparison {
  gasCost: number;
  evCost: number;
  actualCost: number;
  savings: number;
  monthlySavings: number;
  yearlySavings: number;
  costPerMileGas: number;
  costPerMileEV: number;
}

export interface LifetimeMetrics {
  avgSessionCost: number;
  avgSessionEnergy: number;
  avgDuration: number;
  freeCount: number;
  freeEnergy: number;
  maxSessionCost: number;
  minSessionCost: number;
}

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
  costPerKwhTrend: {date: string; costPerKwh: number}[];
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
    const totalEnergy = convertEnergyFromSI(sessions.reduce((s, c) => s + c.total_energy_added_wh, 0), 'kWh');
    const avgCostPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0;
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
    const buckets: Record<string, {cost: number; energy: number; sessions: number}> = {};
    sessions.forEach((s) => {
      const d = new Date(s.started_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets[key]) buckets[key] = {cost: 0, energy: 0, sessions: 0};
      buckets[key].cost += s.cost_decimal ?? 0;
      buckets[key].energy += s.total_energy_added_wh;
      buckets[key].sessions++;
    });
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => {
        const energyKwh = convertEnergyFromSI(v.energy, 'kWh');
        const ge = gasEquivalentCost(energyKwh, mpg, gasPrice);
        return {
          month,
          cost: v.cost,
          energy: energyKwh,
          sessions: v.sessions,
          avgCostPerKwh: energyKwh > 0 ? v.cost / energyKwh : 0,
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
    const groups: Record<string, {cost: number; energy: number; sessions: number}> = {};
    sessions.forEach((s) => {
      const cat = categorizeCharger(s);
      if (!groups[cat]) groups[cat] = {cost: 0, energy: 0, sessions: 0};
      groups[cat].cost += s.cost_decimal ?? 0;
      groups[cat].energy += s.total_energy_added_wh;
      groups[cat].sessions++;
    });
    return Object.entries(groups)
      .map(([name, v]) => ({
        name,
        cost: v.cost,
        energy: convertEnergyFromSI(v.energy, 'kWh'),
        sessions: v.sessions,
        color: CHARGER_COLORS[name] ?? CHART_COLORS[4],
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [sessions]);

  const hourlyData = useMemo<HourBucket[]>(() => {
    if (!sessions || sessions.length === 0) return [];
    const buckets: Record<number, {sessions: number; totalCost: number; totalEnergy: number}> = {};
    for (let h = 0; h < 24; h++) {
      buckets[h] = {sessions: 0, totalCost: 0, totalEnergy: 0};
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
        totalEnergy: convertEnergyFromSI(v.totalEnergy, 'kWh'),
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
    return {cheapest, priciest, busiest, offPeakPct};
  }, [hourlyData, sessions]);

  const gasComparison = useMemo<GasComparison | null>(() => {
    if (!coreStats) return null;
    const {totalEnergy, totalCost, totalDistanceM} = coreStats;
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
