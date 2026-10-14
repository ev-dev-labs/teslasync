/**
 * Charging Thermal Tax — how much of a charge went into warming the battery
 * instead of into range?
 *
 * On cold days a Tesla's battery heater draws real power *during* a charge
 * session to bring the pack up to an efficient charging temperature. That
 * power is metered exactly like any other load, so it eats into the
 * session's effective charge speed without showing up anywhere on the
 * energy-added summary. This module quantifies that "thermal tax" from raw
 * per-sample charge telemetry — heater watts, and delivered energy.
 *
 * This is explicitly NOT `chargingCurve` (which plots power vs. SoC over a
 * session): the thermal tax module never looks at SoC at all. It only asks
 * "how much of what went into the charger went into the heater".
 *
 * Two independent numbers are computed, on purpose:
 *   - `heaterWh` — trapezoidal integration of `battery_heater_power_w` over
 *     the sample timestamps. This is a genuine numerical integral of a
 *     noisy, irregularly-sampled series, not a simple average × duration.
 *   - `deliveredEnergyWh` — the energy the charger actually pushed in.
 *     Preferred source: the difference between the first and last
 *     cumulative `ac_charging_energy_in_wh` + `dc_charging_energy_in_wh`
 *     readings (the odometer-style running total Tesla reports). If those
 *     are missing, or ever decrease (a session-boundary reset), the module
 *     falls back to trapezoidally integrating the instantaneous
 *     `ac_charging_power_w` + `dc_charging_power_w` readings instead —
 *     less precise, but still principled, and the summary's `energySource`
 *     field always says which one was used so a caller can hedge the UI.
 * Raw signed and fractional readings are retained. The share uses only
 * source intervals fully covered by finite heater readings within maxGapS;
 * it never compares a partial counter window with the full heater integral.
 * A measured zero remains a cumulative/power result, not missing energy.
 *
 * Pure and React-free. Accepts a minimal STRUCTURAL sample shape rather than
 * importing the full API telemetry type, so it stays trivially testable
 * with plain object literals; `ChargeTelemetryReading` satisfies it as-is.
 */

export interface ThermalTaxSample {
  ts: string;
  battery_heater_power_w: number | null;
  ac_charging_power_w: number | null;
  dc_charging_power_w: number | null;
  ac_charging_energy_in_wh: number | null;
  dc_charging_energy_in_wh: number | null;
}

export type ThermalPhaseState = 'heater_on' | 'heater_off';

export interface ThermalPhase {
  /** First and last observations of this state, not exact transition instants. */
  startMs: number;
  endMs: number;
  /** Observed span only; independent of the summary's midpoint-rule heaterOnS. */
  durationS: number;
  state: ThermalPhaseState;
  avgHeaterW: number;
  /** Transition windows bracketed by opposite-state observations; null at unobserved session edges. */
  startTransition: { earliestMs: number; latestMs: number } | null;
  endTransition: { earliestMs: number; latestMs: number } | null;
}

export type ThermalEnergySource = 'cumulative' | 'power_integral' | 'none';

export interface ThermalSourceInterval {
  startMs: number;
  endMs: number;
  deliveredEnergyWh: number;
  /** Null unless heater readings cover this entire source interval without a coverage gap. */
  heaterWh: number | null;
}

export interface ChargingThermalTaxSummary {
  sampleCount: number;
  /** Wall-clock span covered by the samples, seconds. */
  spanS: number;
  heaterWh: number;
  deliveredEnergyWh: number | null;
  /** Ratio of matchedHeaterWh / matchedDeliveredEnergyWh; null without comparable positive energy. */
  heaterSharePct: number | null;
  sourceIntervals: ThermalSourceInterval[];
  /** Fraction of the sample span represented by the delivered-energy source, including unmatched intervals. */
  sourceCoveragePct: number;
  matchedHeaterWh: number | null;
  matchedDeliveredEnergyWh: number | null;
  /** Fraction of the sample span covered by matched source intervals. */
  matchedCoveragePct: number;
  heaterOnS: number;
  heaterOnPct: number;
  peakHeaterW: number;
  phases: ThermalPhase[];
  /** Fraction of spanS actually bridged by samples no further than `maxGapS` apart. */
  dataCoveragePct: number;
  energySource: ThermalEnergySource;
}

export interface ChargingThermalTaxOptions {
  /** Heater power above this is considered "on" rather than sensor noise, W. */
  heaterOnThresholdW?: number;
  /** Consecutive samples farther apart than this open a coverage gap, seconds. */
  maxGapS?: number;
}

const DEFAULTS = {
  heaterOnThresholdW: 50,
  maxGapS: 300,
} as const;

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function tsMs(sample: ThermalTaxSample): number | null {
  const ms = new Date(sample.ts).getTime();
  return Number.isFinite(ms) ? ms : null;
}

interface TimedPoint {
  tMs: number;
  value: number;
  channels?: string;
}

function energyPoints(samples: readonly ThermalTaxSample[], cumulative: boolean): TimedPoint[] {
  return samples.flatMap((s) => {
    const tMs = tsMs(s);
    const ac = num(cumulative ? s.ac_charging_energy_in_wh : s.ac_charging_power_w);
    const dc = num(cumulative ? s.dc_charging_energy_in_wh : s.dc_charging_power_w);
    return tMs == null || (ac == null && dc == null) ? [] : [{
      tMs,
      value: (ac ?? 0) + (dc ?? 0),
      channels: `${ac != null ? 'ac' : ''}${dc != null ? 'dc' : ''}`,
    }];
  }).sort((a, b) => a.tMs - b.tMs);
}

/** Trapezoidal integral of `value` (a rate, per hour) over time → the "Wh" (or matching) accumulated. */
function trapezoidIntegrateWh(points: readonly TimedPoint[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const dtH = (cur.tMs - prev.tMs) / 3_600_000;
    if (dtH <= 0) continue;
    total += ((prev.value + cur.value) / 2) * dtH;
  }
  return total;
}

/**
 * Cumulative-energy delivered estimate: last-minus-first of the summed
 * AC+DC running totals, using only samples where at least one of the two
 * cumulative fields is present. Returns null when fewer than two usable
 * points exist, or when the series is non-monotonic (a reset), signalling
 * the caller should fall back to the power integral instead.
 */
function cumulativeDeliveredWh(samples: readonly ThermalTaxSample[]): number | null {
  const points = energyPoints(samples, true);
  if (points.length < 2) return null;
  if (points[0]!.tMs === points[points.length - 1]!.tMs) return null;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.channels !== points[i - 1]!.channels ||
        (points[i]!.tMs === points[i - 1]!.tMs && points[i]!.value !== points[i - 1]!.value) ||
        points[i]!.value < points[i - 1]!.value) return null; // reset or changed source
  }
  const delivered = points[points.length - 1]!.value - points[0]!.value;
  return delivered >= 0 ? delivered : null;
}

/** Fallback delivered-energy estimate: trapezoid-integrate instantaneous AC+DC power. */
function powerIntegralDeliveredWh(samples: readonly ThermalTaxSample[]): number | null {
  const points = energyPoints(samples, false);
  if (points.length < 2) return null;
  if (points[0]!.tMs === points[points.length - 1]!.tMs ||
      points.some((p, i) => p.channels !== points[0]!.channels ||
        (i > 0 && p.tMs === points[i - 1]!.tMs && p.value !== points[i - 1]!.value))) return null;
  return trapezoidIntegrateWh(points);
}

/**
 * Segment the (time-sorted) samples into contiguous heater-on / heater-off
 * phases. Retain each run's observed span and bracket transitions between
 * the adjacent opposite-state readings. Sparse observations cannot establish
 * an exact transition instant or prove that only one transition occurred.
 */
function buildPhases(
  sorted: readonly { tMs: number; heaterW: number; state: ThermalPhaseState }[],
): ThermalPhase[] {
  if (sorted.length === 0) return [];
  const phases: ThermalPhase[] = [];
  let runStartIdx = 0;
  for (let i = 1; i <= sorted.length; i++) {
    const atEnd = i === sorted.length;
    if (atEnd || sorted[i]!.state !== sorted[runStartIdx]!.state) {
      const run = sorted.slice(runStartIdx, i);
      const startMs = run[0]!.tMs;
      const endMs = run[run.length - 1]!.tMs;
      const avgHeaterW = run.reduce((sum, p) => sum + p.heaterW, 0) / run.length;
      phases.push({
        startMs,
        endMs,
        durationS: Math.max(0, (endMs - startMs) / 1000),
        state: sorted[runStartIdx]!.state,
        avgHeaterW,
        startTransition: runStartIdx > 0 ? {
          earliestMs: sorted[runStartIdx - 1]!.tMs,
          latestMs: startMs,
        } : null,
        endTransition: !atEnd ? {
          earliestMs: endMs,
          latestMs: sorted[i]!.tMs,
        } : null,
      });
      runStartIdx = i;
    }
  }
  return phases;
}

export function analyzeChargingThermalTax(
  samples: readonly ThermalTaxSample[],
  options: ChargingThermalTaxOptions = {},
): ChargingThermalTaxSummary {
  const opts = { ...DEFAULTS, ...options };

  const timed = samples
    .map((s) => ({ sample: s, tMs: tsMs(s) }))
    .filter((p): p is { sample: ThermalTaxSample; tMs: number } => p.tMs != null)
    .sort((a, b) => a.tMs - b.tMs);

  if (timed.length === 0) {
    return {
      sampleCount: 0,
      spanS: 0,
      heaterWh: 0,
      deliveredEnergyWh: null,
      heaterSharePct: null,
      sourceIntervals: [],
      sourceCoveragePct: 0,
      matchedHeaterWh: null,
      matchedDeliveredEnergyWh: null,
      matchedCoveragePct: 0,
      heaterOnS: 0,
      heaterOnPct: 0,
      peakHeaterW: 0,
      phases: [],
      dataCoveragePct: 0,
      energySource: 'none',
    };
  }

  const spanS = (timed[timed.length - 1]!.tMs - timed[0]!.tMs) / 1000;

  const heaterReadings = timed.map((p) => ({
    tMs: p.tMs,
    value: num(p.sample.battery_heater_power_w),
  }));
  const heaterPoints = heaterReadings.filter((p): p is TimedPoint => p.value != null);
  let heaterWh = 0;
  for (let i = 1; i < heaterReadings.length; i++) {
    const prev = heaterReadings[i - 1]!;
    const cur = heaterReadings[i]!;
    if (prev.value != null && cur.value != null) {
      heaterWh += trapezoidIntegrateWh([
        { tMs: prev.tMs, value: prev.value }, { tMs: cur.tMs, value: cur.value },
      ]);
    }
  }
  const peakHeaterW = heaterPoints.length ? Math.max(...heaterPoints.map((p) => p.value)) : 0;

  // Heater-on duration: midpoint rule between consecutive samples — an
  // interval counts as "on" for its full duration when the average of its
  // two endpoint readings clears the on-threshold.
  let heaterOnS = 0;
  for (let i = 1; i < heaterReadings.length; i++) {
    const prev = heaterReadings[i - 1]!;
    const cur = heaterReadings[i]!;
    if (prev.value == null || cur.value == null) continue;
    const dtS = (cur.tMs - prev.tMs) / 1000;
    if (dtS <= 0) continue;
    const avgW = (prev.value + cur.value) / 2;
    if (avgW > opts.heaterOnThresholdW) heaterOnS += dtS;
  }

  const stateSeries = heaterPoints.map((p) => ({
    tMs: p.tMs,
    heaterW: p.value,
    state: (p.value > opts.heaterOnThresholdW ? 'heater_on' : 'heater_off') as ThermalPhaseState,
  }));
  const phases = buildPhases(stateSeries);

  let deliveredEnergyWh: number | null = null;
  let energySource: ThermalEnergySource = 'none';
  const cumulative = cumulativeDeliveredWh(samples);
  if (cumulative != null) {
    deliveredEnergyWh = cumulative;
    energySource = 'cumulative';
  } else {
    const integral = powerIntegralDeliveredWh(samples);
    if (integral != null) {
      deliveredEnergyWh = integral;
      energySource = 'power_integral';
    }
  }

  const sourcePoints = energySource === 'none' ? [] : energyPoints(samples, energySource === 'cumulative');
  const sourceIntervals: ThermalSourceInterval[] = [];
  for (let i = 1; i < sourcePoints.length; i++) {
    const prev = sourcePoints[i - 1]!;
    const cur = sourcePoints[i]!;
    if (cur.tMs <= prev.tMs) continue;
    const heater = heaterReadings.filter((p) => p.tMs >= prev.tMs && p.tMs <= cur.tMs);
    // Do not prorate cumulative counters or extrapolate missing heater endpoints.
    const covered = heater.length >= 2 &&
      heater[0]!.tMs === prev.tMs && heater[heater.length - 1]!.tMs === cur.tMs &&
      heater.every((p, index) => p.value != null &&
        (index === 0 || (p.tMs - heater[index - 1]!.tMs) / 1000 <= opts.maxGapS)) &&
      (energySource === 'cumulative' || (cur.tMs - prev.tMs) / 1000 <= opts.maxGapS);
    sourceIntervals.push({
      startMs: prev.tMs,
      endMs: cur.tMs,
      deliveredEnergyWh: energySource === 'cumulative'
        ? cur.value - prev.value : trapezoidIntegrateWh([prev, cur]),
      heaterWh: covered
        ? trapezoidIntegrateWh(heater.filter((p): p is TimedPoint => p.value != null)) : null,
    });
  }
  const matched = sourceIntervals.filter((p) => p.heaterWh != null);
  const matchedHeaterWh = matched.length ? matched.reduce((sum, p) => sum + p.heaterWh!, 0) : null;
  const matchedDeliveredEnergyWh = matched.length
    ? matched.reduce((sum, p) => sum + p.deliveredEnergyWh, 0) : null;
  const matchedS = matched.reduce((sum, p) => sum + (p.endMs - p.startMs) / 1000, 0);
  const sourceS = sourceIntervals.reduce((sum, p) => sum + (p.endMs - p.startMs) / 1000, 0);
  const heaterSharePct =
    matchedHeaterWh != null && matchedDeliveredEnergyWh != null && matchedDeliveredEnergyWh > 0
      ? (matchedHeaterWh / matchedDeliveredEnergyWh) * 100
      : null;

  // Coverage: fraction of the span bridged by gaps no larger than maxGapS.
  let coveredS = 0;
  for (let i = 1; i < timed.length; i++) {
    const dtS = (timed[i]!.tMs - timed[i - 1]!.tMs) / 1000;
    if (dtS <= opts.maxGapS) coveredS += dtS;
  }
  const dataCoveragePct = spanS > 0 ? Math.round((coveredS / spanS) * 1000) / 10 : 0;

  return {
    sampleCount: timed.length,
    spanS: Math.round(spanS),
    heaterWh,
    deliveredEnergyWh,
    heaterSharePct,
    sourceIntervals,
    sourceCoveragePct: spanS > 0 ? (sourceS / spanS) * 100 : 0,
    matchedHeaterWh,
    matchedDeliveredEnergyWh,
    matchedCoveragePct: spanS > 0 ? (matchedS / spanS) * 100 : 0,
    heaterOnS: Math.round(heaterOnS),
    heaterOnPct: spanS > 0 ? Math.round((heaterOnS / spanS) * 1000) / 10 : 0,
    peakHeaterW,
    phases,
    dataCoveragePct,
    energySource,
  };
}
