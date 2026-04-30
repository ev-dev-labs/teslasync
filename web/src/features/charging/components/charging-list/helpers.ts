import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { getChargerCategory } from '../ChargingSessionCard';
import type { ChargingSession } from '@/api/types';
import type { TFunction } from 'i18next';

// ── Types ──────────────────────────────────────────────────────────────

export type SortKey = 'date' | 'energy' | 'cost' | 'duration' | 'power';
export type ChargerFilter = 'all' | 'supercharger' | 'dc' | 'home';

export interface ChargingStats {
  totalEnergy: number;
  totalCost: number;
  totalDuration: number;
  avgPower: number;
  avgCostPerKwh: number;
  homeCount: number;
  scCount: number;
  dcCount: number;
  count: number;
}

export interface AcDcBucket {
  energy: number;
  energyUsed: number;
  cost: number;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

export interface AcDcBreakdown {
  ac: AcDcBucket;
  dc: AcDcBucket;
  total: { energy: number; cost: number; freeEnergy: number; freeCount: number };
}

export interface EfficiencyStats {
  avgEfficiency: number;
  best: { id: number; date: string; efficiency: number; added: number; used: number };
  worst: { id: number; date: string; efficiency: number; added: number; used: number };
  wallLoss: number;
  totalAdded: number;
  totalUsed: number;
  count: number;
}

export interface SpecEntry {
  name: string;
  count: number;
  energy: number;
  power?: number;
  avgPower?: number;
}

export interface ChargerSpecsData {
  voltage: SpecEntry[];
  phase: SpecEntry[];
  cable: SpecEntry[];
  brand: SpecEntry[];
}

export interface EnhancedStats {
  avgDuration: number;
  mostCommonType: [string, number];
}

export interface EnergyTrendPoint { date: string; energy: number; cost: number }
export interface ChargerBreakdownEntry { name: string; value: number; fill: string }
export interface CostByTypeEntry { name: string; energy: number; cost: number; perKwh: number }
export interface StartLevelBucket { range: string; count: number }

// ── Computation Functions ──────────────────────────────────────────────

export function computeStats(sessions: ChargingSession[]): ChargingStats | null {
  if (sessions.length === 0) return null;
  const totalEnergy = sessions.reduce((sum, s) => sum + s.energy_added_kwh, 0);
  const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);
  const totalDuration = sessions.reduce((sum, s) => sum + s.duration_min, 0);
  const withPower = sessions.filter((s) => s.charger_power_kw_max);
  const avgPower =
    withPower.reduce((sum, s) => sum + (s.charger_power_kw_max ?? 0), 0) / Math.max(withPower.length, 1);
  const avgCostPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0;
  const homeCount = sessions.filter((s) => getChargerCategory(s.charger_type) === 'home').length;
  const scCount = sessions.filter((s) => getChargerCategory(s.charger_type) === 'supercharger').length;
  const dcCount = sessions.filter((s) => getChargerCategory(s.charger_type) === 'dc').length;
  return { totalEnergy, totalCost, totalDuration, avgPower, avgCostPerKwh, homeCount, scCount, dcCount, count: sessions.length };
}

export function computeChargerBreakdown(stats: ChargingStats, t: TFunction): ChargerBreakdownEntry[] {
  return [
    { name: t('charging.chargerTypes.supercharger', 'Supercharger'), value: stats.scCount, fill: CHARGER_COLORS.supercharger },
    { name: t('charging.chargerTypes.dc', 'DC Fast'), value: stats.dcCount, fill: CHARGER_COLORS.dc },
    { name: t('charging.chargerTypes.home', 'Home / AC'), value: stats.homeCount, fill: CHARGER_COLORS.home },
  ].filter((d) => d.value > 0);
}

export function computeEnergyTrend(sessions: ChargingSession[]): EnergyTrendPoint[] {
  return sessions
    .slice(0, 20)
    .reverse()
    .map((s) => ({
      date: formatDateShort(s.start_ts),
      energy: parseFloat(fmtNumber(s.energy_added_kwh ?? 0, 1)),
      cost: s.cost ?? 0,
    }));
}

export function computeCostByType(
  sessions: ChargingSession[],
  chargerLabels: Record<string, string>,
): CostByTypeEntry[] {
  const groups: Record<string, { energy: number; cost: number; count: number }> = {};
  sessions.forEach((s) => {
    const cat = chargerLabels[getChargerCategory(s.charger_type)];
    if (!groups[cat]) groups[cat] = { energy: 0, cost: 0, count: 0 };
    groups[cat].energy += s.energy_added_kwh;
    groups[cat].cost += s.cost ?? 0;
    groups[cat].count++;
  });
  return Object.entries(groups).map(([name, v]) => ({
    name,
    energy: parseFloat(fmtNumber(v.energy, 1)),
    cost: parseFloat(fmtNumber(v.cost, 2)),
    perKwh: v.energy > 0 ? parseFloat(fmtNumber(v.cost / v.energy, 3)) : 0,
  }));
}

export function computeStartLevelDist(sessions: ChargingSession[]): StartLevelBucket[] {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${i * 10 + 10}%`,
    count: 0,
  }));
  sessions.forEach((s) => {
    const idx = Math.min(Math.floor(s.start_battery_pct / 10), 9);
    buckets[idx].count++;
  });
  return buckets;
}

export function computeAcDcBreakdown(sessions: ChargingSession[]): AcDcBreakdown {
  const ac: AcDcBucket = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 };
  const dc: AcDcBucket = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 };
  sessions.forEach((s) => {
    const isDC = !!(s.charger_type || (s.charger_power_kw_max && s.charger_power_kw_max > 22));
    const bucket = isDC ? dc : ac;
    bucket.energy += s.energy_added_kwh;
    bucket.energyUsed += s.energy_added_kwh;
    bucket.cost += s.cost ?? 0;
    bucket.count++;
    bucket.totalDuration += s.duration_min;
    if (!s.cost || s.cost === 0) {
      bucket.freeCount++;
      bucket.freeEnergy += s.energy_added_kwh;
    }
  });
  return {
    ac,
    dc,
    total: {
      energy: ac.energy + dc.energy,
      cost: ac.cost + dc.cost,
      freeEnergy: ac.freeEnergy + dc.freeEnergy,
      freeCount: ac.freeCount + dc.freeCount,
    },
  };
}

export function computeEfficiencyStats(sessions: ChargingSession[]): EfficiencyStats | null {
  if (sessions.length === 0) return null;
  const withData = sessions.filter(
    (s) => s.energy_added_kwh > 0 && s.duration_min > 0,
  );
  if (withData.length === 0) return null;
  const efficiencies = withData.map((s) => ({
    id: s.id,
    date: s.start_ts,
    efficiency: (s.energy_added_kwh / s.duration_min) * 60,
    added: s.energy_added_kwh,
    used: s.energy_added_kwh,
  }));
  const totalAdded = withData.reduce((sum, s) => sum + s.energy_added_kwh, 0);
  const totalUsed = totalAdded;
  const avgEfficiency = withData.length > 0
    ? withData.reduce((sum, s) => sum + (s.energy_added_kwh / s.duration_min) * 60, 0) / withData.length
    : 0;
  const sorted = [...efficiencies].sort((a, b) => b.efficiency - a.efficiency);
  return {
    avgEfficiency,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
    wallLoss: 0,
    totalAdded,
    totalUsed,
    count: withData.length,
  };
}

export function computeChargerSpecs(sessions: ChargingSession[]): ChargerSpecsData | null {
  if (sessions.length === 0) return null;

  // Group by charger brand/type
  const byType: Record<string, { count: number; energy: number; power: number }> = {};
  sessions.forEach((s) => {
    const typeKey = s.charger_type ?? 'AC/Home';
    if (!byType[typeKey]) byType[typeKey] = { count: 0, energy: 0, power: 0 };
    byType[typeKey].count++;
    byType[typeKey].energy += s.energy_added_kwh;
    byType[typeKey].power += s.charger_power_kw_max ?? 0;
  });

  // Group by voltage range
  const byVoltage: Record<string, { count: number; energy: number; power: number }> = {};
  sessions.forEach((s) => {
    if (s.max_charger_voltage != null) {
      const range = s.max_charger_voltage > 300 ? 'DC (400V+)'
        : s.max_charger_voltage > 200 ? '240V' : '120V';
      if (!byVoltage[range]) byVoltage[range] = { count: 0, energy: 0, power: 0 };
      byVoltage[range].count++;
      byVoltage[range].energy += s.energy_added_kwh;
    }
  });

  // Group by phases
  const byPhase: Record<string, { count: number; energy: number; power: number }> = {};
  sessions.forEach((s) => {
    if (s.charger_phases != null) {
      const key = `${s.charger_phases}-phase`;
      if (!byPhase[key]) byPhase[key] = { count: 0, energy: 0, power: 0 };
      byPhase[key].count++;
      byPhase[key].energy += s.energy_added_kwh;
    }
  });

  // Group by cable type
  const byCable: Record<string, { count: number; energy: number; power: number }> = {};
  sessions.forEach((s) => {
    if (s.cable_type) {
      if (!byCable[s.cable_type]) byCable[s.cable_type] = { count: 0, energy: 0, power: 0 };
      byCable[s.cable_type].count++;
      byCable[s.cable_type].energy += s.energy_added_kwh;
    }
  });

  const toArr = (obj: Record<string, { count: number; energy: number; power?: number }>) =>
    Object.entries(obj)
      .map(([name, v]) => ({ name, ...v, avgPower: v.power ? v.power / v.count : undefined }))
      .sort((a, b) => b.count - a.count);

  return { voltage: toArr(byVoltage), phase: toArr(byPhase), cable: toArr(byCable), brand: toArr(byType) };
}

export function computeEnhancedStats(
  sessions: ChargingSession[],
  stats: ChargingStats,
): EnhancedStats | null {
  if (sessions.length === 0) return null;
  const avgDuration = stats.count > 0 ? stats.totalDuration / stats.count : 0;
  const chargerTypes = sessions.reduce<Record<string, number>>((acc, s) => {
    const ct = s.charger_type || 'AC/Home';
    acc[ct] = (acc[ct] || 0) + 1;
    return acc;
  }, {});
  const mostCommonType = Object.entries(chargerTypes).sort((a, b) => b[1] - a[1])[0] as [string, number];
  return { avgDuration, mostCommonType };
}

export function filterAndSortSessions(
  sessions: ChargingSession[],
  chargerFilter: ChargerFilter,
  sortBy: SortKey,
  sortDesc: boolean,
): ChargingSession[] {
  let filtered: ChargingSession[] = sessions;
  if (chargerFilter !== 'all') {
    filtered = filtered.filter((s) => getChargerCategory(s.charger_type) === chargerFilter);
  }
  return [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'date':
        cmp = new Date(b.start_ts).getTime() - new Date(a.start_ts).getTime();
        break;
      case 'energy':
        cmp = b.energy_added_kwh - a.energy_added_kwh;
        break;
      case 'cost':
        cmp = (b.cost ?? 0) - (a.cost ?? 0);
        break;
      case 'duration':
        cmp = b.duration_min - a.duration_min;
        break;
      case 'power':
        cmp = (b.charger_power_kw_max ?? 0) - (a.charger_power_kw_max ?? 0);
        break;
    }
    return sortDesc ? cmp : -cmp;
  });
}
