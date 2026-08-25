import { formatDateShort } from '@/lib/dateFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { getChargerCategory } from '../ChargingSessionCard';
import type { ChargingSession } from '@/api/types';
import { durationMinutes } from '../charging-curve/helpers';
import { convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';
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

export interface ChargeRateStats {
  averagePowerW: number;
  best: { id: number; date: string; powerW: number };
  worst: { id: number; date: string; powerW: number };
  totalEnergyWh: number;
  totalDurationS: number;
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

/**
 * Round to a fixed number of decimals without locale side effects.
 *
 * Chart series need real `number`s, not locale strings. The previous
 * `parseFloat(fmtNumber(x, n))` idiom silently corrupted any value ≥ 1000
 * because `fmtNumber` inserts a thousands separator ("1,234.5") that
 * `parseFloat` then truncates to `1`. This helper is separator- and
 * NaN-safe.
 */
function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function computeStats(sessions: ChargingSession[]): ChargingStats | null {
  if (sessions.length === 0) return null;
  const totalEnergy = convertEnergyFromSI(sessions.reduce((sum, s) => sum + (s.total_energy_added_wh ?? 0), 0), 'kWh');
  const totalCost = sessions.reduce((sum, s) => sum + (s.cost_decimal ?? 0), 0);
  const totalDuration = sessions.reduce((sum, s) => sum + durationMinutes(s.started_at, s.ended_at), 0);
  const withPower = sessions.filter((s) => s.peak_power_w);
  const avgPower = convertPowerFromSI(
    withPower.reduce((sum, s) => sum + (s.peak_power_w ?? 0), 0) / Math.max(withPower.length, 1),
    'kW',
  );
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
      date: formatDateShort(s.started_at),
      energy: round(convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh'), 1),
      cost: s.cost_decimal ?? 0,
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
    groups[cat].energy += s.total_energy_added_wh ?? 0;
    groups[cat].cost += s.cost_decimal ?? 0;
    groups[cat].count++;
  });
  return Object.entries(groups).map(([name, v]) => {
    const energyKwh = convertEnergyFromSI(v.energy, 'kWh');
    return {
      name,
      energy: round(energyKwh, 1),
      cost: round(v.cost, 2),
      perKwh: energyKwh > 0 ? round(v.cost / energyKwh, 3) : 0,
    };
  });
}

export function computeStartLevelDist(sessions: ChargingSession[]): StartLevelBucket[] {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${i * 10 + 10}%`,
    count: 0,
  }));
  sessions.forEach((s) => {
    const pct = Number.isFinite(s.start_soc_pct) ? s.start_soc_pct : 0;
    const idx = Math.min(Math.max(Math.floor(pct / 10), 0), 9);
    buckets[idx].count++;
  });
  return buckets;
}

export function computeAcDcBreakdown(sessions: ChargingSession[]): AcDcBreakdown {
  const ac: AcDcBucket = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 };
  const dc: AcDcBucket = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 };
  sessions.forEach((s) => {
    const isDC = !!(s.charger_type || (s.peak_power_w && s.peak_power_w > 22_000));
    const bucket = isDC ? dc : ac;
    const energyKwh = convertEnergyFromSI(s.total_energy_added_wh ?? 0, 'kWh');
    bucket.energy += energyKwh;
    bucket.energyUsed += energyKwh;
    bucket.cost += s.cost_decimal ?? 0;
    bucket.count++;
    bucket.totalDuration += durationMinutes(s.started_at, s.ended_at);
    if (!s.cost_decimal || s.cost_decimal === 0) {
      bucket.freeCount++;
      bucket.freeEnergy += energyKwh;
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

export function computeChargeRateStats(sessions: ChargingSession[]): ChargeRateStats | null {
  if (sessions.length === 0) return null;
  const withData = sessions.filter(
    (s) => s.total_energy_added_wh > 0 && durationMinutes(s.started_at, s.ended_at) > 0,
  );
  if (withData.length === 0) return null;
  const rates = withData.map((s) => {
    const durationS = durationMinutes(s.started_at, s.ended_at) * 60;
    return {
      id: s.id,
      date: s.started_at,
      powerW: s.total_energy_added_wh / (durationS / 3600),
      durationS,
    };
  });
  const totalEnergyWh = withData.reduce(
    (sum, session) => sum + (session.total_energy_added_wh ?? 0),
    0,
  );
  const totalDurationS = rates.reduce((sum, rate) => sum + rate.durationS, 0);
  const averagePowerW = totalDurationS > 0
    ? totalEnergyWh / (totalDurationS / 3600)
    : 0;
  const sorted = [...rates].sort((a, b) => b.powerW - a.powerW);
  return {
    averagePowerW,
    best: {
      id: sorted[0].id,
      date: sorted[0].date,
      powerW: sorted[0].powerW,
    },
    worst: {
      id: sorted[sorted.length - 1].id,
      date: sorted[sorted.length - 1].date,
      powerW: sorted[sorted.length - 1].powerW,
    },
    totalEnergyWh,
    totalDurationS,
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
    byType[typeKey].energy += s.total_energy_added_wh;
    byType[typeKey].power += s.peak_power_w ?? 0;
  });

  const byVoltage: Record<string, { count: number; energy: number; power: number }> = {};
  const byPhase: Record<string, { count: number; energy: number; power: number }> = {};

  // Group by cable type
  const byCable: Record<string, { count: number; energy: number; power: number }> = {};
  sessions.forEach((s) => {
    if (s.cable_type) {
      if (!byCable[s.cable_type]) byCable[s.cable_type] = { count: 0, energy: 0, power: 0 };
      byCable[s.cable_type].count++;
      byCable[s.cable_type].energy += s.total_energy_added_wh;
    }
  });

  const toArr = (obj: Record<string, { count: number; energy: number; power?: number }>) =>
    Object.entries(obj)
      .map(([name, v]) => ({
        name,
        ...v,
        energy: convertEnergyFromSI(v.energy, 'kWh'),
        avgPower: v.power ? convertPowerFromSI(v.power / v.count, 'kW') : undefined,
      }))
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
  searchQuery = '',
): ChargingSession[] {
  let filtered: ChargingSession[] = sessions;
  if (chargerFilter !== 'all') {
    filtered = filtered.filter((s) => getChargerCategory(s.charger_type) === chargerFilter);
  }
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((s) => {
      const loc = (s.start_place ?? '').toLowerCase();
      const type = (s.charger_type ?? '').toLowerCase();
      return loc.includes(q) || type.includes(q);
    });
  }
  return [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'date':
        cmp = new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
        break;
      case 'energy':
        cmp = b.total_energy_added_wh - a.total_energy_added_wh;
        break;
      case 'cost':
        cmp = (b.cost_decimal ?? 0) - (a.cost_decimal ?? 0);
        break;
      case 'duration':
        cmp = durationMinutes(b.started_at, b.ended_at) - durationMinutes(a.started_at, a.ended_at);
        break;
      case 'power':
        cmp = (b.peak_power_w ?? 0) - (a.peak_power_w ?? 0);
        break;
    }
    return sortDesc ? cmp : -cmp;
  });
}
