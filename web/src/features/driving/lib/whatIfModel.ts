/**
 * What-If — a physics-lite counterfactual engine for a single real drive.
 *
 * It decomposes the drive's ACTUAL observed energy into first-principles
 * components (aerodynamic drag, rolling resistance, elevation work, climate
 * load) plus a measured residual ("other": electronics, battery conditioning,
 * drivetrain losses). Anchoring to the real energy means the baseline always
 * reconciles with what the car actually used; only the knobs move things.
 *
 * Then it recomputes those components under user "what-if" knobs:
 *   - speedFactor : scale average speed (aero ∝ v², climate time ∝ 1/v)
 *   - tires       : rolling-resistance multiplier (under/over-inflation)
 *   - hvac        : climate load on/off
 *   - ambientC    : ambient temperature (colder ⇒ more heating + less regen)
 *
 * All outputs are null-safe and clamped; a drive missing energy just yields a
 * neutral, clearly-flagged result rather than NaN.
 */
import type { Drive } from '@/types/driving';
import type { DriveTelemetryPoint } from '@/types/driving';

// Generic mid-size EV constants (Model 3-class); good enough for relative
// what-if deltas, which is what this tool communicates.
const MASS_KG = 1800;
const CDA = 0.58; // drag coefficient × frontal area (m²)
const RHO = 1.225; // air density (kg/m³)
const G = 9.81;
const DRIVETRAIN_EFF = 0.9;
const CLIMATE_BASE_W = 1500; // steady HVAC draw when on at ~20°C
const J_TO_WH = 1 / 3600;
const DEFAULT_PACK_WH = 75000;

export type TirePreset = 'low' | 'nominal' | 'high';

export interface WhatIfKnobs {
  speedFactor: number; // 0.8 .. 1.2
  tires: TirePreset;
  hvac: boolean;
  ambientC: number; // effective ambient temperature °C
}

export const DEFAULT_KNOBS: WhatIfKnobs = { speedFactor: 1, tires: 'nominal', hvac: true, ambientC: 18 };

export interface EnergyBreakdown {
  aero: number;
  rolling: number;
  elevation: number;
  climate: number;
  other: number;
  total: number;
}

export interface WhatIfResult {
  ok: boolean;
  baseline: EnergyBreakdown;
  scenario: EnergyBreakdown;
  packWh: number;
  startSocPct: number | null;
  baselineArrivalSoc: number | null;
  scenarioArrivalSoc: number | null;
  /** scenario − baseline energy, Wh (negative = saved). */
  energyDeltaWh: number;
  /** duration under the scenario (s). */
  scenarioDurationS: number;
  ambientNativeC: number;
}

const TIRE_CRR: Record<TirePreset, number> = { low: 0.0138, nominal: 0.011, high: 0.0099 };

function num(v: number | null | undefined, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Net positive elevation gain (m) across the telemetry, climate flag, ambient. */
function analyzeTelemetry(points: readonly DriveTelemetryPoint[]): {
  climb: number;
  climateOn: boolean;
  ambientC: number | null;
} {
  let climb = 0;
  let prev: number | null = null;
  let climateHits = 0;
  let climateSeen = 0;
  let ambientSum = 0;
  let ambientN = 0;
  for (const p of points) {
    const e = p.elevation;
    if (typeof e === 'number' && Number.isFinite(e)) {
      if (prev != null && e > prev) climb += e - prev;
      prev = e;
    }
    if (typeof p.isClimateOn === 'boolean') {
      climateSeen += 1;
      if (p.isClimateOn) climateHits += 1;
    }
    if (typeof p.outsideTemp === 'number' && Number.isFinite(p.outsideTemp)) {
      ambientSum += p.outsideTemp;
      ambientN += 1;
    }
  }
  return {
    climb,
    climateOn: climateSeen === 0 ? true : climateHits / climateSeen > 0.3,
    ambientC: ambientN > 0 ? ambientSum / ambientN : null,
  };
}

/** Heating power multiplier as a function of ambient temp (colder ⇒ more). */
function climatePowerFor(ambientC: number, on: boolean): number {
  if (!on) return 0;
  const belowComfort = Math.max(0, 20 - ambientC);
  const aboveComfort = Math.max(0, ambientC - 26);
  return CLIMATE_BASE_W * (1 + belowComfort * 0.06 + aboveComfort * 0.04);
}

export function simulateWhatIf(
  drive: Drive | undefined,
  telemetry: readonly DriveTelemetryPoint[] | undefined,
  knobs: WhatIfKnobs,
): WhatIfResult {
  const points = (telemetry ?? []).filter(Boolean);
  const distance = num(drive?.distanceM);
  const duration = Math.max(1, num(drive?.durationS, 1));
  const observed = num(drive?.energyUsedWh);
  const avgSpeed = num(drive?.avgSpeedMps, distance / duration);

  const neutral: WhatIfResult = {
    ok: false,
    baseline: { aero: 0, rolling: 0, elevation: 0, climate: 0, other: 0, total: 0 },
    scenario: { aero: 0, rolling: 0, elevation: 0, climate: 0, other: 0, total: 0 },
    packWh: DEFAULT_PACK_WH,
    startSocPct: drive?.startBatteryPct ?? null,
    baselineArrivalSoc: null,
    scenarioArrivalSoc: null,
    energyDeltaWh: 0,
    scenarioDurationS: duration,
    ambientNativeC: knobs.ambientC,
  };
  if (!drive || distance < 10 || observed <= 0 || avgSpeed <= 0) return neutral;

  const { climb, climateOn, ambientC } = analyzeTelemetry(points);
  const nativeAmbient = ambientC ?? knobs.ambientC;

  // ---- Baseline decomposition (anchored to observed energy) -------------
  const aero0 = (0.5 * RHO * CDA * avgSpeed * avgSpeed * distance) * J_TO_WH / DRIVETRAIN_EFF;
  const roll0 = (TIRE_CRR.nominal * MASS_KG * G * distance) * J_TO_WH / DRIVETRAIN_EFF;
  const elev0 = (MASS_KG * G * climb) * J_TO_WH / DRIVETRAIN_EFF;
  const climate0 = (climatePowerFor(nativeAmbient, climateOn) * duration) * J_TO_WH * 3600 / 3600; // W·s→Wh
  const modeled0 = aero0 + roll0 + elev0 + climate0;
  // Residual attributed to "other" (auxiliaries, conditioning); never negative.
  const other = Math.max(0, observed - modeled0);
  const baseline: EnergyBreakdown = {
    aero: aero0,
    rolling: roll0,
    elevation: elev0,
    climate: climate0,
    other,
    total: aero0 + roll0 + elev0 + climate0 + other,
  };

  // ---- Scenario recompute -----------------------------------------------
  const k = clamp(knobs.speedFactor, 0.5, 1.6);
  const scenSpeed = avgSpeed * k;
  const scenDuration = distance / scenSpeed;
  const aero1 = aero0 * k * k; // ∝ v²
  const roll1 = roll0 * (TIRE_CRR[knobs.tires] / TIRE_CRR.nominal);
  const elev1 = elev0; // gravity work is route-fixed
  const climate1 = (climatePowerFor(knobs.ambientC, knobs.hvac) * scenDuration) * J_TO_WH;
  // Cold ambient also reduces battery/regen efficiency a touch.
  const coldPenalty = 1 + Math.max(0, 10 - knobs.ambientC) * 0.008;
  const scenario: EnergyBreakdown = {
    aero: aero1 * coldPenalty,
    rolling: roll1 * coldPenalty,
    elevation: elev1,
    climate: climate1,
    other: other * coldPenalty,
    total: 0,
  };
  scenario.total = scenario.aero + scenario.rolling + scenario.elevation + scenario.climate + scenario.other;

  // ---- SoC / pack -------------------------------------------------------
  const startSoc = drive.startBatteryPct;
  const endSoc = drive.endBatteryPct;
  let packWh = DEFAULT_PACK_WH;
  if (startSoc != null && endSoc != null && startSoc > endSoc) {
    const inferred = observed / ((startSoc - endSoc) / 100);
    if (Number.isFinite(inferred) && inferred > 30000 && inferred < 130000) packWh = inferred;
  }
  const baselineArrival = startSoc != null ? clamp(startSoc - (baseline.total / packWh) * 100, 0, 100) : null;
  const scenarioArrival = startSoc != null ? clamp(startSoc - (scenario.total / packWh) * 100, 0, 100) : null;

  return {
    ok: true,
    baseline,
    scenario,
    packWh,
    startSocPct: startSoc,
    baselineArrivalSoc: baselineArrival,
    scenarioArrivalSoc: scenarioArrival,
    energyDeltaWh: scenario.total - baseline.total,
    scenarioDurationS: scenDuration,
    ambientNativeC: nativeAmbient,
  };
}
