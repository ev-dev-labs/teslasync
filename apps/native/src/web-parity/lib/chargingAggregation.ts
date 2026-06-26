/**
 * Native parity port of web/src/lib/chargingAggregation.ts.
 *
 * Pure, non-visual aggregation helpers for the Charging Sessions page. There
 * is no DOM, JSX, Recharts, Leaflet, or browser-only behavior here — every
 * type and computation is ported verbatim and behaves identically under React
 * Native (the only platform primitives used — `Date`, `Intl.NumberFormat`,
 * `Intl.DateTimeFormat`/`formatToParts`, `Math`, `Map`, `Set` — are available
 * on Hermes and in the Jest/Node gate environment; `formatToParts` already has
 * native-parity precedent in components/forms/CurrencyInput.tsx).
 *
 * Inputs stay SI-canonical (Wh, W, seconds, decimal currency) so callers
 * convert at the display edge — identical to web.
 *
 * Native adaptation (contract rule 6 — faithful logic/type port): the four web
 * imports (source L15-L24) point at web `@/*` modules that have no native
 * parity port yet, so — following the established native convention used by
 * features/charging/components/charging-list/helpers.ts — the small pure lib
 * dependencies are inlined below as native-safe local ports of their web
 * sources, keeping this single-file conversion self-contained and
 * dependency-correct:
 *   - L15 `ChargingSession` (`@/api/types`)            -> imported from the
 *     existing native parity api/types barrel (one level up, ../api/types).
 *   - L16-22 `priorPeriod` / `localDayKey` / `parseLocalDay` / `groupByDate`
 *     + `DateGroup` (`@/lib/drivesAggregation`)        -> inlined verbatim and
 *     re-exported (the web file re-exports them verbatim on L26-27, so the
 *     public surface is preserved). Their private helpers `ymdToUtcMillis`,
 *     `utcMillisToYmd` (drivesAggregation) and `ymdInTz` (web `@/lib/dateFormat`,
 *     which `localDayKey` builds on) are inlined as local non-exported helpers.
 *   - L23 `numericToGrade` + `ScoreGradeInfo` (`@/lib/scoreScale`) -> inlined
 *     verbatim (palette + default 0-100 thresholds + mapper) as local symbols.
 *   - L24 `fmtNumber` (`@/lib/numberFormat`)           -> inlined as the proven
 *     native-safe `Intl.NumberFormat` port (every call site here passes an
 *     explicit precision, and the web global locale default is 'en-US', so the
 *     output is byte-identical to web).
 */

import type { ChargingSession } from '../api/types';

/* ------------------------------------------------------------------ */
/*  Inlined native-safe ports of the web lib dependencies             */
/* ------------------------------------------------------------------ */

// web L24: `fmtNumber` from `@/lib/numberFormat`. Locale-aware fixed-precision
// formatting via Intl — identical result to the web
// `Number.prototype.toLocaleString(locale, opts)` call — defaulting to the web
// globals' initial precision (2) and locale ('en-US'). Every call site in this
// file passes an explicit precision, so the default is never exercised here.
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

// web L23: `numericToGrade` + `ScoreGradeInfo` from `@/lib/scoreScale`. Ported
// verbatim (shared A-F palette, default 0-100 thresholds, highest-first mapper).
type ScoreGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | '—';

interface ScoreGradeInfo {
  /** Display label. `—` when input is null / NaN. */
  label: ScoreGrade;
  /** Hex colour for the badge text. */
  color: string;
  /** Numeric weight for averaging. `null` for the "no data" sentinel. */
  numeric: number | null;
}

const GRADE_PALETTE: Record<
  ScoreGrade,
  { color: string; numeric: number | null }
> = {
  'A+': { color: '#10b981', numeric: 4.5 },
  A: { color: '#10b981', numeric: 4.0 },
  B: { color: '#00f0ff', numeric: 3.0 },
  C: { color: '#f59e0b', numeric: 2.0 },
  D: { color: '#ef4444', numeric: 1.0 },
  F: { color: '#b91c1c', numeric: 0.5 },
  '—': { color: '#6b7280', numeric: null },
};

const DEFAULT_SCORE_THRESHOLDS: ReadonlyArray<{
  min: number;
  label: ScoreGrade;
}> = [
  { min: 90, label: 'A+' },
  { min: 80, label: 'A' },
  { min: 65, label: 'B' },
  { min: 50, label: 'C' },
  { min: 35, label: 'D' },
  { min: 0, label: 'F' },
];

function numericToGrade(
  score: number | null | undefined,
  thresholds: ReadonlyArray<{
    min: number;
    label: ScoreGrade;
  }> = DEFAULT_SCORE_THRESHOLDS,
): ScoreGradeInfo {
  if (score == null || !Number.isFinite(score)) {
    return { label: '—', ...GRADE_PALETTE['—'] };
  }
  // Thresholds are evaluated highest-first so the first match wins.
  const sorted = [...thresholds].sort((a, b) => b.min - a.min);
  for (const th of sorted) {
    if (score >= th.min) {
      return { label: th.label, ...GRADE_PALETTE[th.label] };
    }
  }
  return { label: 'F', ...GRADE_PALETTE.F };
}

// web `@/lib/dateFormat` `ymdInTz`: extract a `YYYY-MM-DD` string from a Date in
// the requested timezone (browser/device-local when `tz` is unset). Shared
// day-key primitive that `localDayKey` builds on. Uses `formatToParts` to get
// raw numeric components (a locale-formatted date string would inject
// separators we'd have to parse back out); invalid IANA tz falls back to
// device-local rather than throwing — identical to web.
function ymdInTz(d: Date, tz?: string): string | null {
  if (isNaN(d.getTime())) return null;
  if (!tz) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(d);
    const get = (type: string) => parts.find(p => p.type === type)?.value;
    const y = get('year');
    const m = get('month');
    const day = get('day');
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`;
  } catch {
    // Invalid IANA tz — fall back to device-local rather than throwing.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Re-exported drivesAggregation helpers (web L16-22, L26-27)         */
/* ------------------------------------------------------------------ */

/**
 * Convert an ISO timestamp to a `YYYY-MM-DD` key in the requested timezone
 * (defaults to the device's local zone). Returns `null` for empty/invalid
 * input. Pass the *vehicle's* IANA tz so a session at 11pm vehicle-local
 * doesn't get grouped under the next UTC day.
 */
export function localDayKey(
  iso: string | null | undefined,
  tz?: string,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ymdInTz(d, tz);
}

/**
 * Parse a `YYYY-MM-DD` key into a `Date` anchored at UTC noon on that day —
 * anchoring at noon avoids the `new Date('2026-04-24')` UTC-midnight pitfall
 * while making the returned Date safe to format in any timezone (a 12-hour
 * cushion absorbs the ±14h IANA range without crossing day boundaries).
 */
export function parseLocalDay(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return new Date(NaN);
  const [, ys, ms, ds] = m;
  return new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds), 12));
}

export interface DateGroup<T> {
  /** Sortable key, `YYYY-MM-DD`. */
  dateKey: string;
  /** Items belonging to this date, in original order. */
  items: T[];
}

/**
 * Bucket items by day key extracted from each item. Returns groups in
 * descending date order so the most recent day appears first.
 */
export function groupByDate<T>(
  items: readonly T[],
  getDateKey: (item: T) => string | null,
): DateGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = getDateKey(item);
    if (!key) continue;
    const day = key.split('T')[0];
    const list = buckets.get(day) ?? [];
    list.push(item);
    buckets.set(day, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([dateKey, list]) => ({ dateKey, items: list }));
}

/**
 * Given a current window `[startDate, endDate]`, return the equivalent prior
 * window of the same length immediately before it. Both inputs and outputs are
 * `YYYY-MM-DD` strings. Returns `null` for malformed input.
 *
 * The arithmetic is purely string-day-based (no Date objects for the window
 * math) so the result is identical regardless of the caller's device timezone.
 */
export function priorPeriod(
  startDate: string | undefined,
  endDate: string | undefined,
): { start: string; end: string } | null {
  if (!startDate || !endDate) return null;
  const startMs = ymdToUtcMillis(startDate);
  const endMs = ymdToUtcMillis(endDate);
  if (startMs == null || endMs == null) return null;
  const lengthDays = Math.max(
    1,
    Math.round((endMs - startMs) / 86_400_000) + 1,
  );
  const priorEndMs = startMs - 86_400_000;
  const priorStartMs = priorEndMs - (lengthDays - 1) * 86_400_000;
  return {
    start: utcMillisToYmd(priorStartMs),
    end: utcMillisToYmd(priorEndMs),
  };
}

function ymdToUtcMillis(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [, ys, ms, ds] = m;
  return Date.UTC(Number(ys), Number(ms) - 1, Number(ds));
}

function utcMillisToYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/*  Charger category                                                  */
/* ------------------------------------------------------------------ */

export type ChargerCategory = 'home' | 'supercharger' | 'dc' | 'unknown';

/**
 * Map a raw `charger_type` string from the API into a coarse category we can
 * use everywhere (filter pills, breakdown chart, anomaly rules).
 *
 * Mirrors the legacy `getChargerCategory()` from
 * `features/charging/components/ChargingSessionCard.tsx` — kept here so the lib
 * has no React dependency.
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
  )
    return 'dc';
  if (t.includes('home') || t.includes('ac') || t.includes('wall'))
    return 'home';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/*  Session helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Duration in minutes between `started_at` and `ended_at`. Returns 0 for
 * in-progress sessions or malformed timestamps so callers can sum without
 * `NaN` propagation.
 */
export function durationMinutes(s: ChargingSession): number {
  if (!s.started_at || !s.ended_at) return 0;
  const start = Date.parse(s.started_at);
  const end = Date.parse(s.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return 0;
  return (end - start) / 60_000;
}

/**
 * Average power in watts: total energy added (Wh) divided by elapsed hours.
 * Falls back to the API-provided `avg_power_w` when timestamps aren't usable.
 * Returns 0 when neither path is computable.
 */
export function avgPowerW(s: ChargingSession): number {
  const minutes = durationMinutes(s);
  if (minutes > 0 && s.total_energy_added_wh > 0) {
    return s.total_energy_added_wh / (minutes / 60);
  }
  return s.avg_power_w ?? 0;
}

/**
 * Cost per kWh for a single session. Returns `null` when free / unknown /
 * zero-energy.
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
 * Heuristic: the more often the user starts charging at a *low* SoC (below
 * 30 %) and stops at a *moderate* SoC (≤ 80 %) — i.e. uses the sweet spot — the
 * higher the score. Sessions that go to 100 % SoC or start above 60 % are
 * penalised because both shorten battery life. Returns `null` when no scorable
 * sessions are in the window.
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
    avgRateKw:
      totalDurationMin > 0
        ? totalEnergyWh / 1000 / (totalDurationMin / 60)
        : null,
    avgDurationMin: count > 0 ? totalDurationMin / count : null,
    avgPowerW: powerN > 0 ? powerSum / powerN : null,
    mostCommonStartHour: hourCounts.some(c => c > 0)
      ? hourCounts.indexOf(Math.max(...hourCounts))
      : null,
    byCategory,
    freeCount,
    batteryFriendlyScore: score,
    batteryFriendlyGrade: numericToGrade(score),
  };
}

function parseStartHour(
  iso: string | null | undefined,
  tz?: string,
): number | null {
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
    const h = parts.find(p => p.type === 'hour')?.value;
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
  | 'telemetry_gap' // 0 kWh added but >5 min duration
  | 'cost_zero' // Energy added but no cost recorded (data gap, not free)
  | 'bad_power' // peak_power_w sustained <3kW for >30m on supposed DC
  | 'expensive' // costPerKwh > 0.50 (configurable)
  | 'trickle'; // duration > 6h AND avgPower < 5 kW

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
 * Detect anomalies in a window of sessions. Each session may produce at most
 * ONE anomaly — the first matching rule wins (in priority order: telemetry_gap
 * → cost_zero → bad_power → expensive → trickle) so the inline badge stays
 * unambiguous.
 *
 * Returns the anomalies in original session order so the caller can intersperse
 * them in the date-grouped list without sorting.
 *
 * @param currencySymbol  Symbol used in the "Expensive charge" message;
 *                        defaults to '$' for backward-compat. Pass the value
 *                        from `useFormatting().currencySymbol` so non-USD users
 *                        see their preferred symbol.
 */
export function detectChargingAnomalies(
  sessions: readonly ChargingSession[],
  thresholds: AnomalyThresholds = {},
  currencySymbol: string = '$',
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
    if (
      energyKwh > 1 &&
      (s.cost_decimal == null || s.cost_decimal === 0) &&
      getChargerCategory(s.charger_type) !== 'home'
    ) {
      out.push({
        session: s,
        kind: 'cost_zero',
        message: 'Energy added but no cost recorded',
        actionLabel: 'Add cost',
      });
      continue;
    }
    if (getChargerCategory(s.charger_type) === 'dc' && dur > 30 && power < 3) {
      out.push({
        session: s,
        kind: 'bad_power',
        message: `Low power for DC (${fmtNumber(power, 1)} kW)`,
        actionLabel: 'View curve',
      });
      continue;
    }
    if (cpk != null && cpk > cfg.expensiveCostPerKwh) {
      out.push({
        session: s,
        kind: 'expensive',
        message: `Expensive charge (${currencySymbol}${fmtNumber(cpk, 2)}/kWh)`,
        actionLabel: 'Compare',
      });
      continue;
    }
    if (dur > cfg.trickleMinDurationMin && power < cfg.tricklePowerKw) {
      out.push({
        session: s,
        kind: 'trickle',
        message: `Trickle charge (${fmtNumber(
          power,
          1,
        )} kW for ${formatDurationShort(dur)})`,
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
 * Notable sessions: top-decile by energy added OR sustained ≥150 kW peak power
 * (a fast supercharger session). Capped at 50 entries to keep the panel
 * scannable on very large datasets.
 */
export function detectNotableSessions(
  sessions: readonly ChargingSession[],
): ChargingSession[] {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort(
    (a, b) => b.total_energy_added_wh - a.total_energy_added_wh,
  );
  const cutoffIdx = Math.min(50, Math.max(1, Math.ceil(sessions.length * 0.1)));
  const topEnergy = new Set(sorted.slice(0, cutoffIdx).map(s => s.id));

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
  | 'energy' // kWh
  | 'cost'
  | 'power'; // avg kW

export interface ChargingTrendPoint {
  /** `YYYY-MM-DD` */
  date: string;
  value: number;
}

/**
 * Daily (or longer-bucket) aggregation of a charging metric over the supplied
 * sessions. Days are bucketed by `localDayKey` in the requested tz so the
 * chart's x-axis matches the row groupings the user sees below it.
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
