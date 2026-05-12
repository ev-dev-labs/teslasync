/**
 * Pure aggregation helpers for the Charging Sessions page.
 *
 * Mirrors the surface area of `lib/drivesAggregation.ts` so the two
 * pages share the same vocabulary (period stats, prior period, anomaly
 * detection, daily trend, date grouping). Where the Drives lib already
 * has a function that doesn't depend on driving-specific types
 * (`priorPeriod`, `localDayKey`, `parseLocalDay`), we re-export it
 * verbatim — no need to duplicate logic.
 *
 * Inputs are kept SI-canonical (Wh, W, seconds, decimal currency)
 * so callers can convert at the edge.
 */

import type { ChargingSession } from '@/api/types';
import {
  priorPeriod,
  localDayKey,
  parseLocalDay,
  groupByDate,
  type DateGroup,
} from '@/lib/drivesAggregation';
import { numericToGrade, type ScoreGradeInfo } from '@/lib/scoreScale';

export { priorPeriod, localDayKey, parseLocalDay, groupByDate };
export type { DateGroup };

/* ------------------------------------------------------------------ */
/*  Charger category                                                  */
/* ------------------------------------------------------------------ */

export type ChargerCategory = 'home' | 'supercharger' | 'dc' | 'unknown';

/**
 * Map a raw `charger_type` string from the API into a coarse category
 * we can use everywhere (filter pills, breakdown chart, anomaly rules).
 *
 * Mirrors the legacy `getChargerCategory()` from
 * `features/charging/components/ChargingSessionCard.tsx` — kept here
 * so the lib has no React dependency.
 */
export function getChargerCategory(
  type: string | null | undefined,
): ChargerCategory {
  if (!type) return 'home'; // null type historically means home AC
  const t = type.toLowerCase();
  if (t.includes('super') || t.includes('tpc')) return 'supercharger';
  if (
    t.includes('dc') ||
    t.includes('ccs') ||
    t.includes('chademo') ||
    t.includes('fast')
  ) return 'dc';
  if (t.includes('home') || t.includes('ac') || t.includes('wall')) return 'home';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/*  Session helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Duration in minutes between `started_at` and `ended_at`. Returns 0
 * for in-progress sessions or malformed timestamps so callers can sum
 * without `NaN` propagation.
 */
export function durationMinutes(s: ChargingSession): number {
  if (!s.started_at || !s.ended_at) return 0;
  const start = Date.parse(s.started_at);
  const end = Date.parse(s.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 60_000;
}

/**
 * Average power in watts: total energy added (Wh) divided by elapsed
 * hours. Falls back to the API-provided `avg_power_w` when timestamps
 * aren't usable. Returns 0 when neither path is computable.
 */
export function avgPowerW(s: ChargingSession): number {
  const minutes = durationMinutes(s);
  if (minutes > 0 && s.total_energy_added_wh > 0) {
    return s.total_energy_added_wh / (minutes / 60);
  }
  return s.avg_power_w ?? 0;
}

/**
 * Cost per kWh for a single session. Returns `null` when free /
 * unknown / zero-energy.
 */
export function costPerKwh(s: ChargingSession): number | null {
  if (s.total_energy_added_wh <= 0) return null;
  if (s.cost_decimal == null || s.cost_decimal <= 0) return null;
  return s.cost_decimal / (s.total_energy_added_wh / 1000);
}

/* ------------------------------------------------------------------ */
/*  Period stats (analogue of computePeriodStats for drives)          */
/* ------------------------------------------------------------------ */

export interface ChargingPeriodStats {
  count: number;
  /** Sum of `total_energy_added_wh` (canonical). */
  totalEnergyWh: number;
  /** Sum of `cost_decimal` (caller-supplied currency). */
  totalCost: number;
  /** Sum of `durationMinutes(s)`. */
  totalDurationMin: number;
  /** Average kWh/hr across sessions with usable duration. */
  avgRateKw: number | null;
  /** Average minutes per session. */
  avgDurationMin: number | null;
  /** Average power in W (uses {@link avgPowerW}). */
  avgPowerW: number | null;
  /** Most common starting hour-of-day (0–23) in the requested tz. */
  mostCommonStartHour: number | null;
  /** Counts by charger category. */
  byCategory: Record<ChargerCategory, number>;
  /** Number of sessions where `cost_decimal` is null/zero. */
  freeCount: number;
  /** "Battery-friendly" score 0–100 → see {@link batteryFriendlyScore}. */
  batteryFriendlyScore: number | null;
  /** Convenience: graded score using the default scale. */
  batteryFriendlyGrade: ScoreGradeInfo;
}

/** Filter `[startDate, endDate]` inclusive on `started_at`'s `tz` day. */
function inDateRange(
  s: ChargingSession,
  startDate?: string,
  endDate?: string,
  tz?: string,
): boolean {
  const day = localDayKey(s.started_at, tz);
  if (!day) return true;
  if (startDate && day < startDate) return false;
  if (endDate && day > endDate) return false;
  return true;
}

/**
 * "Battery-friendly" 0–100 score for a window of sessions.
 *
 * Heuristic: the more often the user starts charging at a *low* SoC
 * (below 30 %) and stops at a *moderate* SoC (≤ 80 %) — i.e. uses the
 * sweet spot — the higher the score. Sessions that go to 100 % SoC or
 * start above 60 % are penalised because both shorten battery life.
 * Returns `null` when no scorable sessions are in the window.
 *
 * Stable across renders: pure function over the input list.
 */
export function batteryFriendlyScore(
  sessions: readonly ChargingSession[],
): number | null {
  let total = 0;
  let n = 0;
  for (const s of sessions) {
    const start = s.start_soc_pct;
    const end = s.end_soc_pct;
    if (start == null || end == null) continue;
    n += 1;
    let score = 50;
    // Reward starting low (≤ 30%): up to +30
    if (start <= 30) score += 30;
    else if (start <= 50) score += 15;
    else if (start <= 70) score += 0;
    else score -= 10;
    // Reward stopping at sweet spot (≤ 80%): up to +20
    if (end <= 80) score += 20;
    else if (end <= 90) score += 0;
    else if (end < 100) score -= 10;
    else score -= 25; // 100% charge is the worst for li-ion
    total += Math.max(0, Math.min(100, score));
  }
  return n > 0 ? total / n : null;
}

export function computeChargingPeriodStats(
  sessions: readonly ChargingSession[],
  startDate?: string,
  endDate?: string,
  tz?: string,
): ChargingPeriodStats {
  let count = 0;
  let totalEnergyWh = 0;
  let totalCost = 0;
  let totalDurationMin = 0;
  let powerSum = 0;
  let powerN = 0;
  let freeCount = 0;
  const byCategory: Record<ChargerCategory, number> = {
    home: 0,
    supercharger: 0,
    dc: 0,
    unknown: 0,
  };
  const hourCounts: number[] = new Array(24).fill(0);
  const inWindow: ChargingSession[] = [];

  for (const s of sessions) {
    if (!inDateRange(s, startDate, endDate, tz)) continue;
    count += 1;
    inWindow.push(s);
    totalEnergyWh += s.total_energy_added_wh;
    totalCost += s.cost_decimal ?? 0;
    totalDurationMin += durationMinutes(s);
    const p = avgPowerW(s);
    if (p > 0) {
      powerSum += p;
      powerN += 1;
    }
    byCategory[getChargerCategory(s.charger_type)] += 1;
    if (!s.cost_decimal || s.cost_decimal === 0) freeCount += 1;
    const hour = parseStartHour(s.started_at, tz);
    if (hour != null) hourCounts[hour] += 1;
  }

  const score = batteryFriendlyScore(inWindow);

  return {
    count,
    totalEnergyWh,
    totalCost,
    totalDurationMin,
    avgRateKw: totalDurationMin > 0
      ? totalEnergyWh / 1000 / (totalDurationMin / 60)
      : null,
    avgDurationMin: count > 0 ? totalDurationMin / count : null,
    avgPowerW: powerN > 0 ? powerSum / powerN : null,
    mostCommonStartHour: hourCounts.some((c) => c > 0)
      ? hourCounts.indexOf(Math.max(...hourCounts))
      : null,
    byCategory,
    freeCount,
    batteryFriendlyScore: score,
    batteryFriendlyGrade: numericToGrade(score),
  };
}

function parseStartHour(iso: string | null | undefined, tz?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (!tz) return d.getHours();
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const h = parts.find((p) => p.type === 'hour')?.value;
    if (!h) return null;
    const n = Number(h);
    return Number.isFinite(n) ? n % 24 : null;
  } catch {
    return d.getHours();
  }
}

/* ------------------------------------------------------------------ */
/*  Anomalies                                                         */
/* ------------------------------------------------------------------ */

export type ChargingAnomalyKind =
  | 'telemetry_gap'   // 0 kWh added but >5 min duration
  | 'cost_zero'       // Energy added but no cost recorded (data gap, not free)
  | 'bad_power'       // peak_power_w sustained <3kW for >30m on supposed DC
  | 'expensive'       // costPerKwh > 0.50 (configurable)
  | 'trickle';        // duration > 6h AND avgPower < 5 kW

export interface ChargingAnomaly {
  session: ChargingSession;
  kind: ChargingAnomalyKind;
  /** Short, user-facing message ("Low efficiency", "0 kWh in 1h 16m", …). */
  message: string;
  /** Suggested action label ("Investigate →", "View charger curve →"). */
  actionLabel: string;
}

export interface AnomalyThresholds {
  /** Cost/kWh above which an anomaly is flagged. Default 0.50. */
  expensiveCostPerKwh?: number;
  /** Trickle threshold in kW. Default 5. */
  tricklePowerKw?: number;
  /** Trickle threshold in minutes. Default 360 (6 h). */
  trickleMinDurationMin?: number;
}

const DEFAULT_THRESHOLDS: Required<AnomalyThresholds> = {
  expensiveCostPerKwh: 0.5,
  tricklePowerKw: 5,
  trickleMinDurationMin: 360,
};

/**
 * Detect anomalies in a window of sessions. Each session may produce
 * at most ONE anomaly — the first matching rule wins (in priority
 * order: telemetry_gap → cost_zero → bad_power → expensive → trickle)
 * so the inline badge stays unambiguous.
 *
 * Returns the anomalies in original session order so the caller can
 * intersperse them in the date-grouped list without sorting.
 */
export function detectChargingAnomalies(
  sessions: readonly ChargingSession[],
  thresholds: AnomalyThresholds = {},
): ChargingAnomaly[] {
  const cfg = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const out: ChargingAnomaly[] = [];
  for (const s of sessions) {
    const dur = durationMinutes(s);
    const energyKwh = s.total_energy_added_wh / 1000;
    const power = avgPowerW(s) / 1000;
    const cpk = costPerKwh(s);

    if (energyKwh < 0.1 && dur > 5) {
      out.push({
        session: s,
        kind: 'telemetry_gap',
        message: `0 kWh added in ${formatDurationShort(dur)} — telemetry gap?`,
        actionLabel: 'Investigate',
      });
      continue;
    }
    if (energyKwh > 1 && (s.cost_decimal == null || s.cost_decimal === 0) &&
        getChargerCategory(s.charger_type) !== 'home') {
      out.push({
        session: s,
        kind: 'cost_zero',
        message: 'Energy added but no cost recorded',
        actionLabel: 'Add cost',
      });
      continue;
    }
    if (
      getChargerCategory(s.charger_type) === 'dc' &&
      dur > 30 &&
      power < 3
    ) {
      out.push({
        session: s,
        kind: 'bad_power',
        message: `Low power for DC (${power.toFixed(1)} kW)`,
        actionLabel: 'View curve',
      });
      continue;
    }
    if (cpk != null && cpk > cfg.expensiveCostPerKwh) {
      out.push({
        session: s,
        kind: 'expensive',
        message: `Expensive charge ($${cpk.toFixed(2)}/kWh)`,
        actionLabel: 'Compare',
      });
      continue;
    }
    if (dur > cfg.trickleMinDurationMin && power < cfg.tricklePowerKw) {
      out.push({
        session: s,
        kind: 'trickle',
        message: `Trickle charge (${power.toFixed(1)} kW for ${formatDurationShort(dur)})`,
        actionLabel: 'View curve',
      });
      continue;
    }
  }
  return out;
}

function formatDurationShort(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* ------------------------------------------------------------------ */
/*  Notable sessions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Notable sessions: top-decile by energy added OR sustained ≥150 kW
 * peak power (a fast supercharger session). Capped at 50 entries to
 * keep the panel scannable on very large datasets.
 */
export function detectNotableSessions(
  sessions: readonly ChargingSession[],
): ChargingSession[] {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort(
    (a, b) => b.total_energy_added_wh - a.total_energy_added_wh,
  );
  const cutoffIdx = Math.min(50, Math.max(1, Math.ceil(sessions.length * 0.1)));
  const topEnergy = new Set(sorted.slice(0, cutoffIdx).map((s) => s.id));

  const result: ChargingSession[] = [];
  const seen = new Set<number>();
  for (const s of sessions) {
    const isFast = (s.peak_power_w ?? 0) >= 150_000;
    if ((topEnergy.has(s.id) || isFast) && !seen.has(s.id)) {
      result.push(s);
      seen.add(s.id);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Trend                                                             */
/* ------------------------------------------------------------------ */

export type ChargingTrendMetric =
  | 'sessions'
  | 'energy'      // kWh
  | 'cost'
  | 'power';      // avg kW

export interface ChargingTrendPoint {
  /** `YYYY-MM-DD` */
  date: string;
  value: number;
}

/**
 * Daily (or longer-bucket) aggregation of a charging metric over the
 * supplied sessions. Days are bucketed by `localDayKey` in the
 * requested tz so the chart's x-axis matches the row groupings the
 * user sees below it.
 */
export function dailyChargingTrend(
  sessions: readonly ChargingSession[],
  metric: ChargingTrendMetric,
  tz?: string,
): ChargingTrendPoint[] {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const s of sessions) {
    const day = localDayKey(s.started_at, tz);
    if (!day) continue;
    const b = buckets.get(day) ?? { sum: 0, count: 0 };
    switch (metric) {
      case 'sessions':
        b.sum += 1;
        break;
      case 'energy':
        b.sum += s.total_energy_added_wh / 1000;
        break;
      case 'cost':
        b.sum += s.cost_decimal ?? 0;
        break;
      case 'power': {
        const p = avgPowerW(s) / 1000;
        if (p > 0) {
          b.sum += p;
          b.count += 1;
        }
        break;
      }
    }
    buckets.set(day, b);
  }
  const points: ChargingTrendPoint[] = Array.from(buckets.entries()).map(
    ([date, b]) => ({
      date,
      value: metric === 'power' ? (b.count > 0 ? b.sum / b.count : 0) : b.sum,
    }),
  );
  return points.sort((a, b) => (a.date < b.date ? -1 : 1));
}
