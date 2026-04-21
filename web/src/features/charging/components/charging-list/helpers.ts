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
  const totalEnergy = sessions.reduce((sum, s) => sum + s.charge_energy_added, 0);
  const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);
  const totalDuration = sessions.reduce((sum, s) => sum + s.duration_min, 0);
  const withPower = sessions.filter((s) => s.charger_power);
  const avgPower =
    withPower.reduce((sum, s) => sum + (s.charger_power ?? 0), 0) / Math.max(withPower.length, 1);
  const avgCostPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0;
  const homeCount = sessions.filter((s) => getChargerCategory(s.fast_charger_type) === 'home').length;
  const scCount = sessions.filter((s) => getChargerCategory(s.fast_charger_type) === 'supercharger').length;
  const dcCount = sessions.filter((s) => getChargerCategory(s.fast_charger_type) === 'dc').length;
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
      date: formatDateShort(s.start_date),
      energy: parseFloat(fmtNumber(s.charge_energy_added ?? 0, 1)),
      cost: s.cost ?? 0,
    }));
}

export function computeCostByType(
  sessions: ChargingSession[],
  chargerLabels: Record<string, string>,
): CostByTypeEntry[] {
  const groups: Record<string, { energy: number; cost: number; count: number }> = {};
  sessions.forEach((s) => {
    const cat = chargerLabels[getChargerCategory(s.fast_charger_type)];
    if (!groups[cat]) groups[cat] = { energy: 0, cost: 0, count: 0 };
    groups[cat].energy += s.charge_energy_added;
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
    const idx = Math.min(Math.floor(s.start_battery_level / 10), 9);
    buckets[idx].count++;
  });
  return buckets;
}

export function computeAcDcBreakdown(sessions: ChargingSession[]): AcDcBreakdown {
  const ac: AcDcBucket = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 };
  const dc: AcDcBucket = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 };
  sessions.forEach((s) => {
    const isDC = !!(s.fast_charger_type || (s.charger_power && s.charger_power > 22));
    const bucket = isDC ? dc : ac;
    bucket.energy += s.charge_energy_added;
    bucket.energyUsed += s.charge_energy_used ?? s.charge_energy_added;
    bucket.cost += s.cost ?? 0;
    bucket.count++;
    bucket.totalDuration += s.duration_min;
    if (!s.cost || s.cost === 0) {
      bucket.freeCount++;
      bucket.freeEnergy += s.charge_energy_added;
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
  const withEff = sessions.filter(
    (s) => s.charge_energy_used && s.charge_energy_used > 0 && s.charge_energy_added > 0,
  );
  if (withEff.length === 0) return null;
  const efficiencies = withEff.map((s) => ({
    id: s.id,
    date: s.start_date,
    efficiency: (s.charge_energy_added / s.charge_energy_used!) * 100,
    added: s.charge_energy_added,
    used: s.charge_energy_used!,
  }));
  const totalAdded = withEff.reduce((sum, s) => sum + s.charge_energy_added, 0);
  const totalUsed = withEff.reduce((sum, s) => sum + s.charge_energy_used!, 0);
  const avgEfficiency = totalUsed > 0 ? (totalAdded / totalUsed) * 100 : 0;
  const sorted = [...efficiencies].sort((a, b) => b.efficiency - a.efficiency);
  return {
    avgEfficiency,
    best: sorted[0],
    worst: sorted[sorted.length - 1],
    wallLoss: totalUsed - totalAdded,
    totalAdded,
    totalUsed,
    count: withEff.length,
  };
}

export function computeChargerSpecs(sessions: ChargingSession[]): ChargerSpecsData | null {
  if (sessions.length === 0) return null;
  const byVoltage: Record<string, { count: number; energy: number; power: number }> = {};
  const byPhase: Record<string, { count: number; energy: number }> = {};
  const byCable: Record<string, { count: number; energy: number }> = {};
  const byBrand: Record<string, { count: number; energy: number; power: number }> = {};
  sessions.forEach((s) => {
    if (s.charger_voltage != null) {
      const vKey = s.charger_voltage <= 130 ? '120V' : s.charger_voltage <= 260 ? '240V' : '480V+';
      if (!byVoltage[vKey]) byVoltage[vKey] = { count: 0, energy: 0, power: 0 };
      byVoltage[vKey].count++;
      byVoltage[vKey].energy += s.charge_energy_added;
      byVoltage[vKey].power += s.charger_power ?? 0;
    }
    if (s.charger_phases != null) {
      const pKey = `${s.charger_phases}-phase`;
      if (!byPhase[pKey]) byPhase[pKey] = { count: 0, energy: 0 };
      byPhase[pKey].count++;
      byPhase[pKey].energy += s.charge_energy_added;
    }
    if (s.conn_charge_cable) {
      if (!byCable[s.conn_charge_cable]) byCable[s.conn_charge_cable] = { count: 0, energy: 0 };
      byCable[s.conn_charge_cable].count++;
      byCable[s.conn_charge_cable].energy += s.charge_energy_added;
    }
    if (s.fast_charger_brand) {
      if (!byBrand[s.fast_charger_brand]) byBrand[s.fast_charger_brand] = { count: 0, energy: 0, power: 0 };
      byBrand[s.fast_charger_brand].count++;
      byBrand[s.fast_charger_brand].energy += s.charge_energy_added;
      byBrand[s.fast_charger_brand].power += s.charger_power ?? 0;
    }
  });
  const toArr = (obj: Record<string, { count: number; energy: number; power?: number }>) =>
    Object.entries(obj)
      .map(([name, v]) => ({ name, ...v, avgPower: v.power ? v.power / v.count : undefined }))
      .sort((a, b) => b.count - a.count);
  return { voltage: toArr(byVoltage), phase: toArr(byPhase), cable: toArr(byCable), brand: toArr(byBrand) };
}

export function computeEnhancedStats(
  sessions: ChargingSession[],
  stats: ChargingStats,
): EnhancedStats | null {
  if (sessions.length === 0) return null;
  const avgDuration = stats.count > 0 ? stats.totalDuration / stats.count : 0;
  const chargerTypes = sessions.reduce<Record<string, number>>((acc, s) => {
    const ct = s.fast_charger_type || 'AC/Home';
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
    filtered = filtered.filter((s) => getChargerCategory(s.fast_charger_type) === chargerFilter);
  }
  return [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'date':
        cmp = new Date(b.start_date).getTime() - new Date(a.start_date).getTime();
        break;
      case 'energy':
        cmp = b.charge_energy_added - a.charge_energy_added;
        break;
      case 'cost':
        cmp = (b.cost ?? 0) - (a.cost ?? 0);
        break;
      case 'duration':
        cmp = b.duration_min - a.duration_min;
        break;
      case 'power':
        cmp = (b.charger_power ?? 0) - (a.charger_power ?? 0);
        break;
    }
    return sortDesc ? cmp : -cmp;
  });
}
