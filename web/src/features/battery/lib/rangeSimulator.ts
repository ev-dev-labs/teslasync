/**
 * Range Simulator model — Monte Carlo trip simulation over YOUR history.
 *
 * Instead of a single point estimate, the simulator answers "what's the
 * probability I arrive with battery to spare?" by bootstrapping from the
 * driver's own per-drive consumption distribution:
 *
 *  1. Pack calibration: every drive with meaningful SoC use implies a usable
 *     pack size (`energyUsedWh / socUsed × 100`); the median across drives is
 *     a self-measured capacity — no spec-sheet guess.
 *  2. Each trial assembles the requested distance from randomly drawn
 *     historical drives (distance-weighted, so a 3 km hop doesn't count as
 *     much evidence as a 200 km run) and sums their real consumption rates.
 *  3. Thousands of trials yield an arrival-SoC distribution: P10/P50/P90 and
 *     the probability of arriving at or above the reserve floor.
 *
 * Deterministic: randomness comes from an injected seed via mulberry32, so
 * results are reproducible and unit-testable.
 */

import type { Drive } from '@/types/driving';

export const SIM_RESERVE_PCT = 10;

export interface SimulationResult {
  /** Usable pack estimate in Wh, or null when uncalibratable. */
  packWhEstimate: number | null;
  /** Number of drives feeding the consumption distribution. */
  sampleSize: number;
  trials: number;
  /** Arrival SoC percentiles (per cent), null when the sim can't run. */
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** Share of trials arriving ≥ SIM_RESERVE_PCT, 0–1. */
  successProb: number | null;
  /** Histogram of arrival SoC in 5%-wide buckets from 0 to 100 (+1 failure bucket at index 0 for <0). */
  histogram: { fromPct: number; toPct: number; count: number }[];
}

/** mulberry32 — tiny, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SampleDrive {
  whPerKm: number;
  distanceKm: number;
}

function usableForConsumption(d: Drive): boolean {
  return (
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    Number.isFinite(d.distanceM) && d.distanceM >= 2000
  );
}

/** Median implied usable pack size (Wh) from drives with ≥5% SoC use. */
export function estimatePackWh(drives: readonly Drive[]): number | null {
  const implied: number[] = [];
  for (const d of drives) {
    if (!usableForConsumption(d)) continue;
    const s = d.startBatteryPct;
    const e = d.endBatteryPct;
    if (s == null || e == null || !Number.isFinite(s) || !Number.isFinite(e)) continue;
    const used = s - e;
    if (used < 5) continue; // tiny SoC deltas are quantization noise
    implied.push((d.energyUsedWh! / used) * 100);
  }
  if (implied.length < 5) return null;
  implied.sort((a, b) => a - b);
  const mid = Math.floor(implied.length / 2);
  const med = implied.length % 2 === 1 ? implied[mid]! : (implied[mid - 1]! + implied[mid]!) / 2;
  return Math.round(med);
}

export interface SimulateOptions {
  trials?: number;
  seed?: number;
  /** Override the self-calibrated pack size (Wh). */
  packWhOverride?: number;
}

export function simulateTrip(
  drives: readonly Drive[],
  tripKm: number,
  startSocPct: number,
  options: SimulateOptions = {},
): SimulationResult {
  const trials = options.trials ?? 2000;
  const rand = mulberry32(options.seed ?? 1337);

  const samples: SampleDrive[] = drives.filter(usableForConsumption).map((d) => ({
    whPerKm: d.energyUsedWh! / (d.distanceM / 1000),
    distanceKm: d.distanceM / 1000,
  }));

  const packWhEstimate = options.packWhOverride ?? estimatePackWh(drives);

  const empty: SimulationResult = {
    packWhEstimate,
    sampleSize: samples.length,
    trials,
    p10: null, p50: null, p90: null,
    successProb: null,
    histogram: [],
  };
  if (
    samples.length < 8 || packWhEstimate == null || packWhEstimate <= 0 ||
    !Number.isFinite(tripKm) || tripKm <= 0 ||
    !Number.isFinite(startSocPct) || startSocPct <= 0
  ) {
    return empty;
  }

  // Distance-weighted sampling: cumulative distance table + binary search.
  const cumulative: number[] = [];
  let acc = 0;
  for (const s of samples) {
    acc += s.distanceKm;
    cumulative.push(acc);
  }
  const totalKm = acc;
  const draw = (): SampleDrive => {
    const target = rand() * totalKm;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return samples[lo]!;
  };

  const arrivals: number[] = [];
  for (let i = 0; i < trials; i++) {
    let remaining = tripKm;
    let energyWh = 0;
    // Assemble the trip out of sampled historical legs. The final partial leg
    // contributes proportionally.
    while (remaining > 0) {
      const leg = draw();
      const legKm = Math.min(leg.distanceKm, remaining);
      energyWh += leg.whPerKm * legKm;
      remaining -= legKm;
    }
    arrivals.push(startSocPct - (energyWh / packWhEstimate) * 100);
  }
  arrivals.sort((a, b) => a - b);

  const pct = (p: number) => {
    const idx = Math.min(arrivals.length - 1, Math.max(0, Math.round((p / 100) * (arrivals.length - 1))));
    return Math.round(arrivals[idx]! * 10) / 10;
  };

  const histogram: SimulationResult['histogram'] = [];
  histogram.push({ fromPct: -100, toPct: 0, count: arrivals.filter((a) => a < 0).length });
  for (let from = 0; from < 100; from += 5) {
    histogram.push({
      fromPct: from,
      toPct: from + 5,
      count: arrivals.filter((a) => a >= from && a < from + 5).length,
    });
  }

  return {
    packWhEstimate,
    sampleSize: samples.length,
    trials,
    p10: pct(10),
    p50: pct(50),
    p90: pct(90),
    successProb: arrivals.filter((a) => a >= SIM_RESERVE_PCT).length / arrivals.length,
    histogram,
  };
}
