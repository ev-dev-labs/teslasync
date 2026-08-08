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
  startMs: number;
  endMs: number;
  durationS: number;
  state: ThermalPhaseState;
  avgHeaterW: number;
}

export type ThermalEnergySource = 'cumulative' | 'power_integral' | 'none';

export interface ChargingThermalTaxSummary {
  sampleCount: number;
  /** Wall-clock span covered by the samples, seconds. */
  spanS: number;
  heaterWh: number;
  deliveredEnergyWh: number | null;
  /** heaterWh / deliveredEnergyWh, 0..100+. Null when delivered energy is unknown or zero. */
  heaterSharePct: number | null;
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
  const points: TimedPoint[] = [];
  for (const s of samples) {
    const t = tsMs(s);
    if (t == null) continue;
    const ac = num(s.ac_charging_energy_in_wh);
    const dc = num(s.dc_charging_energy_in_wh);
    if (ac == null && dc == null) continue;
    points.push({ tMs: t, value: (ac ?? 0) + (dc ?? 0) });
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a.tMs - b.tMs);
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.value < points[i - 1]!.value) return null; // reset — untrustworthy
  }
  const delivered = points[points.length - 1]!.value - points[0]!.value;
  return delivered >= 0 ? delivered : null;
}

/** Fallback delivered-energy estimate: trapezoid-integrate instantaneous AC+DC power. */
function powerIntegralDeliveredWh(samples: readonly ThermalTaxSample[]): number | null {
  const points: TimedPoint[] = [];
  for (const s of samples) {
    const t = tsMs(s);
    if (t == null) continue;
    const ac = num(s.ac_charging_power_w);
    const dc = num(s.dc_charging_power_w);
    if (ac == null && dc == null) continue;
    points.push({ tMs: t, value: (ac ?? 0) + (dc ?? 0) });
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a.tMs - b.tMs);
  return trapezoidIntegrateWh(points);
}

/**
 * Segment the (time-sorted) samples into contiguous heater-on / heater-off
 * phases. Boundaries fall on sample timestamps — the true transition
 * instant between two samples is approximated by the timestamp of the
 * sample where the new state is first observed.
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
        avgHeaterW: Math.round(avgHeaterW),
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
      heaterOnS: 0,
      heaterOnPct: 0,
      peakHeaterW: 0,
      phases: [],
      dataCoveragePct: 0,
      energySource: 'none',
    };
  }

  const spanS = (timed[timed.length - 1]!.tMs - timed[0]!.tMs) / 1000;

  const heaterPoints: TimedPoint[] = timed.map((p) => ({
    tMs: p.tMs,
    value: Math.max(0, num(p.sample.battery_heater_power_w) ?? 0),
  }));
  const heaterWh = trapezoidIntegrateWh(heaterPoints);
  const peakHeaterW = Math.max(...heaterPoints.map((p) => p.value));

  // Heater-on duration: midpoint rule between consecutive samples — an
  // interval counts as "on" for its full duration when the average of its
  // two endpoint readings clears the on-threshold.
  let heaterOnS = 0;
  for (let i = 1; i < heaterPoints.length; i++) {
    const prev = heaterPoints[i - 1]!;
    const cur = heaterPoints[i]!;
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
  if (cumulative != null && cumulative > 0) {
    deliveredEnergyWh = cumulative;
    energySource = 'cumulative';
  } else {
    const integral = powerIntegralDeliveredWh(samples);
    if (integral != null && integral > 0) {
      deliveredEnergyWh = integral;
      energySource = 'power_integral';
    }
  }

  const heaterSharePct =
    deliveredEnergyWh != null && deliveredEnergyWh > 0
      ? Math.round((heaterWh / deliveredEnergyWh) * 1000) / 10
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
    heaterWh: Math.round(heaterWh),
    deliveredEnergyWh: deliveredEnergyWh != null ? Math.round(deliveredEnergyWh) : null,
    heaterSharePct,
    heaterOnS: Math.round(heaterOnS),
    heaterOnPct: spanS > 0 ? Math.round((heaterOnS / spanS) * 1000) / 10 : 0,
    peakHeaterW: Math.round(peakHeaterW),
    phases,
    dataCoveragePct,
    energySource,
  };
}
