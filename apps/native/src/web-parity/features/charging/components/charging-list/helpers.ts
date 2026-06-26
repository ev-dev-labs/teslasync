// Native parity port of
// web/src/features/charging/components/charging-list/helpers.ts.
//
// This module is pure, non-visual computation/type code for the charging-list
// feature (stats, breakdowns, efficiency, charger specs, filter/sort). There is
// no DOM, JSX, Recharts, Leaflet, or browser-only behavior to adapt, so every
// type and computation function is ported verbatim and behavior is identical.
//
// Native adaptations (each documented in the .parity.json sidecar) only concern
// the eight web imports (source L1-L8), which point at web `@/lib/*`,
// `@/api/types`, a sibling component, and `i18next` — none of which have a
// native-parity port yet. The `ChargingSession` API type is imported from the
// existing native parity api/types barrel; the small pure lib helpers
// (formatDateShort, fmtNumber, CHARGER_COLORS, getChargerCategory,
// durationMinutes, convertEnergyFromSI, convertPowerFromSI) are inlined here as
// native-safe local ports of their web sources so this single-file conversion
// stays self-contained and dependency-correct. The `i18next` `TFunction` type
// (web L8), used only to type the `t` parameter of `computeChargerBreakdown`,
// becomes the established native `NativeTFunction = (key, fallback) => string`
// shim type (i18next is not a native dependency); the call shape
// `t(key, fallback)` is preserved exactly.

// web L5: `import type { ChargingSession } from '@/api/types'` ->
// the native parity api/types barrel (four levels up: charging-list ->
// components -> charging -> features -> web-parity, then /api/types).
import type {ChargingSession} from '../../../../api/types';

// ── Inlined native-safe ports of the web lib dependencies (web L1-L8) ──────

// web L8: `import type { TFunction } from 'i18next'`. i18next is not a native
// dependency; the established native convention models the `t(key, fallback)`
// call shape used by this module as a local function type.
type NativeTFunction = (key: string, fallback: string) => string;

// web L7: `convertEnergyFromSI` / `convertPowerFromSI` from
// `@/lib/unitConversion`. Ported verbatim (SI watt-hours/watts -> display unit).
type EnergyUnitPref = 'Wh' | 'kWh';
type PowerUnitPref = 'W' | 'kW';

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

function convertPowerFromSI(watts: number, to: PowerUnitPref): number {
  switch (to) {
    case 'W':
      return watts;
    case 'kW':
      return watts / 1000;
  }
}

// web L2: `fmtNumber` from `@/lib/numberFormat`. Ported to preserve the web
// output exactly: locale-aware fixed-precision formatting via Intl (identical
// result to the web `Number.prototype.toLocaleString(locale, opts)` call),
// defaulting to the web globals' initial precision (2) and locale ('en-US').
// Every call site in this file passes an explicit precision, so the default is
// never exercised here. `new Intl.NumberFormat(...).format(n)` is used (rather
// than `n.toLocaleString(...)`) to match the proven native lib/format.ts typing.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  const n = safeNumber(v);
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    // Bad locale tag — fall back to en-US so we still produce a string.
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  }
}

// web L1: `formatDateShort` from `@/lib/dateFormat`. Short date "Apr 4";
// returns the universal "—" placeholder for nullish/invalid input, identical to
// the web helper. Uses Intl.DateTimeFormat (same output as the web
// `Date.prototype.toLocaleDateString(undefined, opts)`), matching lib/format.ts.
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

// web L3: `CHARGER_COLORS` from `@/lib/colors`. Ported verbatim (both the
// internal keys used here and the display-name keys, for a faithful surface).
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

// web L4: `getChargerCategory` from `../ChargingSessionCard`, which re-exports
// it from `@/lib/chargingAggregation`. Ported verbatim, including the
// `ChargerCategory` union it returns.
type ChargerCategory = 'home' | 'supercharger' | 'dc' | 'unknown';

function getChargerCategory(type: string | null | undefined): ChargerCategory {
  if (!type) {
    return 'home';
  } // null type historically means home AC
  const t = type.toLowerCase();
  if (t.includes('super') || t.includes('tpc')) {
    return 'supercharger';
  }
  if (
    t.includes('dc') ||
    t.includes('ccs') ||
    t.includes('chademo') ||
    t.includes('fast')
  ) {
    return 'dc';
  }
  if (t.includes('home') || t.includes('ac') || t.includes('wall')) {
    return 'home';
  }
  return 'unknown';
}

// web L6: `durationMinutes` from `../charging-curve/helpers`. Ported verbatim
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
  total: {energy: number; cost: number; freeEnergy: number; freeCount: number};
}

export interface EfficiencyStats {
  avgEfficiency: number;
  best: {id: number; date: string; efficiency: number; added: number; used: number};
  worst: {id: number; date: string; efficiency: number; added: number; used: number};
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

export interface EnergyTrendPoint {
  date: string;
  energy: number;
  cost: number;
}
export interface ChargerBreakdownEntry {
  name: string;
  value: number;
  fill: string;
}
export interface CostByTypeEntry {
  name: string;
  energy: number;
  cost: number;
  perKwh: number;
}
export interface StartLevelBucket {
  range: string;
  count: number;
}

// ── Computation Functions ──────────────────────────────────────────────

export function computeStats(sessions: ChargingSession[]): ChargingStats | null {
  if (sessions.length === 0) return null;
  const totalEnergy = convertEnergyFromSI(sessions.reduce((sum, s) => sum + s.total_energy_added_wh, 0), 'kWh');
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

export function computeChargerBreakdown(stats: ChargingStats, t: NativeTFunction): ChargerBreakdownEntry[] {
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
      energy: parseFloat(fmtNumber(s.total_energy_added_wh ?? 0, 1)),
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
    groups[cat].energy += s.total_energy_added_wh;
    groups[cat].cost += s.cost_decimal ?? 0;
    groups[cat].count++;
  });
  return Object.entries(groups).map(([name, v]) => ({
    name,
    energy: parseFloat(fmtNumber(v.energy, 1)),
    cost: parseFloat(fmtNumber(v.cost, 2)),
    perKwh: v.energy > 0 ? parseFloat(fmtNumber(v.cost / (v.energy / 1000), 3)) : 0,
  }));
}

export function computeStartLevelDist(sessions: ChargingSession[]): StartLevelBucket[] {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${i * 10 + 10}%`,
    count: 0,
  }));
  sessions.forEach((s) => {
    const idx = Math.min(Math.floor(s.start_soc_pct / 10), 9);
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
    bucket.energy += s.total_energy_added_wh;
    bucket.energyUsed += s.total_energy_added_wh;
    bucket.cost += s.cost_decimal ?? 0;
    bucket.count++;
    bucket.totalDuration += durationMinutes(s.started_at, s.ended_at);
    if (!s.cost_decimal || s.cost_decimal === 0) {
      bucket.freeCount++;
      bucket.freeEnergy += s.total_energy_added_wh;
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
    (s) => s.total_energy_added_wh > 0 && durationMinutes(s.started_at, s.ended_at) > 0,
  );
  if (withData.length === 0) return null;
  const efficiencies = withData.map((s) => ({
    id: s.id,
    date: s.started_at,
    efficiency: (s.total_energy_added_wh / durationMinutes(s.started_at, s.ended_at)) * 60,
    added: s.total_energy_added_wh,
    used: s.total_energy_added_wh,
  }));
  const totalAdded = withData.reduce((sum, s) => sum + s.total_energy_added_wh, 0);
  const totalUsed = totalAdded;
  const avgEfficiency = withData.length > 0
    ? withData.reduce((sum, s) => sum + (s.total_energy_added_wh / durationMinutes(s.started_at, s.ended_at)) * 60, 0) / withData.length
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
