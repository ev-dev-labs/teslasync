/**
 * Drive Compare model — a metric-by-metric duel between two drives.
 *
 * Produces a typed row per comparable metric with both SI values and a
 * direction-aware winner, leaving all formatting to the page. Pure.
 */

import type { Drive } from '@/types/driving';

export type CompareMetricKey =
  | 'distanceM'
  | 'durationS'
  | 'avgSpeedMps'
  | 'maxSpeedMps'
  | 'energyUsedWh'
  | 'whPerKm'
  | 'regenShare'
  | 'socUsed'
  | 'outsideTempAvgC';

/** Which direction is "better" for the winner tag; null = neutral fact. */
export type BetterDirection = 'lower' | 'higher' | null;

export interface CompareRow {
  key: CompareMetricKey;
  a: number | null;
  b: number | null;
  better: BetterDirection;
  /** 'a' | 'b' when both sides exist, differ, and the metric has a direction. */
  winner: 'a' | 'b' | null;
}

export const COMPARE_METRICS: { key: CompareMetricKey; better: BetterDirection }[] = [
  { key: 'distanceM', better: null },
  { key: 'durationS', better: null },
  { key: 'avgSpeedMps', better: null },
  { key: 'maxSpeedMps', better: null },
  { key: 'energyUsedWh', better: 'lower' },
  { key: 'whPerKm', better: 'lower' },
  { key: 'regenShare', better: 'higher' },
  { key: 'socUsed', better: 'lower' },
  { key: 'outsideTempAvgC', better: null },
];

function num(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/** Derived metric extraction shared by both sides. */
export function metricOf(drive: Drive, key: CompareMetricKey): number | null {
  switch (key) {
    case 'distanceM': return num(drive.distanceM);
    case 'durationS': return num(drive.durationS);
    case 'avgSpeedMps': return num(drive.avgSpeedMps);
    case 'maxSpeedMps': return num(drive.maxSpeedMps);
    case 'energyUsedWh': return num(drive.energyUsedWh);
    case 'whPerKm': {
      const e = num(drive.energyUsedWh);
      const m = num(drive.distanceM);
      return e != null && m != null && m >= 1000 ? Math.round((e / (m / 1000)) * 10) / 10 : null;
    }
    case 'regenShare': {
      const r = num(drive.regenEnergyWh);
      const e = num(drive.energyUsedWh);
      return r != null && e != null && e > 0 && r >= 0 ? Math.round((r / e) * 1000) / 1000 : null;
    }
    case 'socUsed': {
      const s = num(drive.startBatteryPct);
      const e = num(drive.endBatteryPct);
      return s != null && e != null && s >= e ? s - e : null;
    }
    case 'outsideTempAvgC': return num(drive.outsideTempAvgC);
  }
}

export function compareDrives(a: Drive, b: Drive): CompareRow[] {
  return COMPARE_METRICS.map(({ key, better }) => {
    const va = metricOf(a, key);
    const vb = metricOf(b, key);
    let winner: 'a' | 'b' | null = null;
    if (better != null && va != null && vb != null && va !== vb) {
      const aWins = better === 'lower' ? va < vb : va > vb;
      winner = aWins ? 'a' : 'b';
    }
    return { key, a: va, b: vb, better, winner };
  });
}
