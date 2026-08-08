/**
 * Forecast adapters — turn real Tesla energy-site history into slot-level
 * solar generation / household load forecasts for the orchestrator.
 *
 * `TeslaEnergyHistoryEntry` (see `@/types/energy`) comes from Tesla's
 * `calendar_history` (`kind=energy`) endpoint via `useTeslaEnergyHistory`.
 * Each entry already carries an INTERVAL energy value (Wh delivered since
 * the previous sample), not a cumulative total — the backend parser maps
 * `solar_energy_exported` / `consumer_energy_imported_from_grid` straight
 * through (see `internal/api/teslaenergyhist/query.go`). Tesla's own
 * `period=day` resolution is nominally 5 minutes; this adapter does not
 * hard-code that assumption and instead derives each sample's duration from
 * the gap to the following sample (falling back to 5 minutes only when that
 * gap is missing or implausible).
 *
 * This module is a pure function of its inputs — it never reads the system
 * clock. Callers (the composition hook) supply `startTimeIso` explicitly
 * (typically `new Date().toISOString()`), which keeps every test
 * deterministic.
 *
 * Known, documented approximations (surfaced via `confidence` / `quality`,
 * never hidden):
 *  - Time-of-day bucketing uses UTC minute-of-day, not the site's local
 *    timezone/DST offset (`TeslaEnergySiteInfo.time_zone_offset` is not
 *    consulted). Forecasts built from history that spans a DST transition
 *    may be shifted by up to an hour.
 *  - Only a single generic "day shape" is modeled — weekday/weekend or
 *    seasonal variation is not distinguished.
 *  - `consumer_energy_wh` is the whole-home load measured at the Tesla
 *    Energy Gateway and may already include historical vehicle charging on
 *    a shared circuit; it cannot be decomposed into "base load" vs
 *    "vehicle load" from this data source alone.
 */

import type { TeslaEnergyHistoryEntry } from '@/types/energy';

export type ForecastQuality = 'none' | 'low' | 'medium' | 'high';

export interface ForecastResult {
  /** Forecast power, watts, one entry per requested horizon slot. */
  seriesW: number[];
  /** 0–1 confidence in the forecast; 0 when no usable history was supplied. */
  confidence: number;
  quality: ForecastQuality;
  /** Total number of raw history samples that contributed to the day-shape. */
  sourceSampleCount: number;
  /** Most recent history timestamp used, or `null` if none. */
  latestSampleIso: string | null;
}

const MINUTES_PER_DAY = 1440;
const FALLBACK_SAMPLE_HOURS = 5 / 60;

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function slotsPerDay(slotMinutes: number): number {
  const m = slotMinutes > 0 ? slotMinutes : 15;
  return Math.max(1, Math.round(MINUTES_PER_DAY / m));
}

/** UTC-based slot-of-day index — see the timezone caveat in the module doc comment. */
function utcSlotOfDay(iso: string, slotMinutes: number): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  const d = new Date(ms);
  const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  return Math.floor(minuteOfDay / (slotMinutes > 0 ? slotMinutes : 15)) % slotsPerDay(slotMinutes);
}

interface DayShape {
  avgPowerW: number[];
  sampleCount: number[];
  totalSamples: number;
  latestIso: string | null;
}

function buildDayShape(
  history: TeslaEnergyHistoryEntry[],
  extract: (entry: TeslaEnergyHistoryEntry) => number | null | undefined,
  slotMinutes: number,
): DayShape {
  const perDay = slotsPerDay(slotMinutes);
  const whSum = new Array<number>(perDay).fill(0);
  const hoursSum = new Array<number>(perDay).fill(0);
  const sampleCount = new Array<number>(perDay).fill(0);
  let latestIso: string | null = null;
  let totalSamples = 0;

  const safe = Array.isArray(history) ? history : [];
  const sorted = safe
    .filter((e) => e && typeof e.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp)))
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const whRaw = extract(entry);
    if (whRaw == null || !Number.isFinite(whRaw) || whRaw < 0) continue;

    const tMs = Date.parse(entry.timestamp);
    const nextMs = i + 1 < sorted.length ? Date.parse(sorted[i + 1].timestamp) : NaN;
    const gapHours = Number.isFinite(nextMs) ? (nextMs - tMs) / 3_600_000 : NaN;
    const durationHours = gapHours > 0 && gapHours <= 1 ? gapHours : FALLBACK_SAMPLE_HOURS;

    const slot = utcSlotOfDay(entry.timestamp, slotMinutes);
    whSum[slot] += whRaw;
    hoursSum[slot] += durationHours;
    sampleCount[slot] += 1;
    totalSamples += 1;
    if (latestIso == null || tMs > Date.parse(latestIso)) latestIso = entry.timestamp;
  }

  const avgPowerW = whSum.map((wh, i) => (hoursSum[i] > 0 ? wh / hoursSum[i] : 0));
  return { avgPowerW, sampleCount, totalSamples, latestIso };
}

/** Carries the nearest sampled slot's value into unsampled slots (circular distance) so gaps don't collapse to zero. */
function fillGaps(values: number[], sampleCount: number[]): number[] {
  const n = values.length;
  if (n === 0 || sampleCount.every((c) => c === 0)) return values.slice();
  const filled = values.slice();
  for (let i = 0; i < n; i++) {
    if (sampleCount[i] > 0) continue;
    let bestDist = Infinity;
    let bestVal = 0;
    for (let j = 0; j < n; j++) {
      if (sampleCount[j] === 0) continue;
      const dist = Math.min(Math.abs(i - j), n - Math.abs(i - j));
      if (dist < bestDist) {
        bestDist = dist;
        bestVal = values[j];
      }
    }
    filled[i] = bestVal;
  }
  return filled;
}

function tileToHorizon(dayShape: number[], startTimeIso: string, slotMinutes: number, horizonSlots: number): number[] {
  const perDay = dayShape.length || 1;
  const startSlot = utcSlotOfDay(startTimeIso, slotMinutes);
  const out = new Array<number>(horizonSlots);
  for (let t = 0; t < horizonSlots; t++) {
    out[t] = dayShape[(startSlot + t) % perDay] ?? 0;
  }
  return out;
}

function scoreConfidence(sampleCount: number[], totalSamples: number): { confidence: number; quality: ForecastQuality } {
  const perDay = sampleCount.length || 1;
  if (totalSamples === 0) return { confidence: 0, quality: 'none' };
  const coverage = sampleCount.filter((c) => c > 0).length / perDay;
  const richness = clamp01(totalSamples / perDay);
  const confidence = clamp01(0.5 * coverage + 0.5 * richness);
  const quality: ForecastQuality = confidence >= 0.7 ? 'high' : confidence >= 0.34 ? 'medium' : 'low';
  return { confidence, quality };
}

export interface ForecastOptions {
  startTimeIso: string;
  slotMinutes: number;
  horizonSlots: number;
}

function buildForecast(
  history: TeslaEnergyHistoryEntry[] | null | undefined,
  extract: (entry: TeslaEnergyHistoryEntry) => number | null | undefined,
  options: ForecastOptions,
): ForecastResult {
  const slotMinutes = options.slotMinutes > 0 ? options.slotMinutes : 15;
  const horizonSlots = options.horizonSlots > 0 ? Math.floor(options.horizonSlots) : 0;
  const shape = buildDayShape(Array.isArray(history) ? history : [], extract, slotMinutes);
  const filled = fillGaps(shape.avgPowerW, shape.sampleCount);
  const seriesW = horizonSlots > 0 ? tileToHorizon(filled, options.startTimeIso, slotMinutes, horizonSlots) : [];
  const { confidence, quality } = scoreConfidence(shape.sampleCount, shape.totalSamples);
  return {
    seriesW,
    confidence,
    quality,
    sourceSampleCount: shape.totalSamples,
    latestSampleIso: shape.latestIso,
  };
}

/** Builds a solar generation forecast (watts) from Tesla energy-site history. */
export function buildSolarForecast(history: TeslaEnergyHistoryEntry[] | null | undefined, options: ForecastOptions): ForecastResult {
  return buildForecast(history, (e) => e.solar_energy_wh, options);
}

/**
 * Builds a household load forecast (watts) from Tesla energy-site history.
 * See the module doc comment: this cannot be cleanly separated from
 * historical vehicle charging load measured on the same circuit.
 */
export function buildLoadForecast(history: TeslaEnergyHistoryEntry[] | null | undefined, options: ForecastOptions): ForecastResult {
  return buildForecast(history, (e) => e.consumer_energy_wh, options);
}
