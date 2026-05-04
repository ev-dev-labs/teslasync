/**
 * SI-input unit conversion helpers (Phase-42).
 *
 * Pre-Phase-42 the Tesla pipeline emitted hot-table values in mixed units
 * (mph for speed, miles for distance, PSI for tire pressure, °F for some
 * climate fields). After Prompts 0030–0036 + 0070, every snapshot/hot-
 * table column is canonical SI: meters (m), meters/second (m/s),
 * Pascals (Pa), Celsius (°C). The legacy converters in
 * `@/lib/unitConversion` still expect mph / miles / PSI / °F as the
 * SOURCE value (their `fromUnit` enum has no Meters / Pascals member),
 * which means they cannot consume Phase-42 SI inputs directly.
 *
 * This module fills that gap. It does NOT change the user-facing display
 * unit (that still comes from app preferences / Settings); it only adds
 * the missing SI → display conversion path.
 *
 * See `.github/instructions/unit-conversion.instructions.md`.
 */

import {
  DistanceUnit,
  PressureUnit,
  TemperatureUnit,
  celsiusToFahrenheit,
  kmToMiles,
  milesToKm,
} from '../unitConversion'

// ---------------------------------------------------------------------------
// Conversion constants
// ---------------------------------------------------------------------------

/** Exact factor (per the international yard) for meters → miles. */
export const METERS_PER_MILE = 1609.344

/** Exact factor for meters → kilometers. */
export const METERS_PER_KM = 1000

/** 1 PSI = 6894.757293168361 Pa (NIST SP 811). */
export const PASCALS_PER_PSI = 6894.757293168361

/** 1 bar = 100_000 Pa (BIPM). */
export const PASCALS_PER_BAR = 100_000

// ---------------------------------------------------------------------------
// Distance (meters → miles / km)
// ---------------------------------------------------------------------------

export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE
}

export function metersToKm(m: number): number {
  return m / METERS_PER_KM
}

/**
 * Convert a distance whose source unit is SI meters into the user's
 * display unit (miles or km), rounded to `precision` decimals.
 */
export function toDisplayDistanceFromMeters(
  meters: number,
  toUnit: DistanceUnit,
  precision = 1,
): number {
  const display =
    toUnit === DistanceUnit.Kilometers ? metersToKm(meters) : metersToMiles(meters)
  return Number(display.toFixed(precision))
}

// ---------------------------------------------------------------------------
// Speed (m/s → mph / km/h)
// ---------------------------------------------------------------------------

/** 1 m/s = 3.6 km/h = 2.236936… mph. Derived from METERS_PER_MILE. */
export function mpsToMph(mps: number): number {
  return (mps * 3600) / METERS_PER_MILE
}

export function mpsToKmh(mps: number): number {
  return mps * 3.6
}

/**
 * Convert a speed whose source unit is SI m/s into the user's display
 * unit (mph or km/h, selected via the same DistanceUnit enum used for
 * distance).
 */
export function toDisplaySpeedFromMps(
  mps: number,
  toUnit: DistanceUnit,
  precision = 0,
): number {
  const display =
    toUnit === DistanceUnit.Kilometers ? mpsToKmh(mps) : mpsToMph(mps)
  return Number(display.toFixed(precision))
}

// ---------------------------------------------------------------------------
// Pressure (Pa → PSI / bar)
// ---------------------------------------------------------------------------

export function pascalsToPsi(pa: number): number {
  return pa / PASCALS_PER_PSI
}

export function pascalsToBar(pa: number): number {
  return pa / PASCALS_PER_BAR
}

/**
 * Convert a pressure whose source unit is SI Pascals into the user's
 * display unit (PSI or bar).
 */
export function toDisplayPressureFromPascals(
  pa: number,
  toUnit: PressureUnit,
  precision = 1,
): number {
  const display =
    toUnit === PressureUnit.Bar ? pascalsToBar(pa) : pascalsToPsi(pa)
  return Number(display.toFixed(precision))
}

// ---------------------------------------------------------------------------
// Temperature (°C is already SI — re-export the existing converter for
// symmetry so callers can `import { toDisplayTemperatureFromCelsius } from
// '@/lib/units'` without crossing module boundaries).
// ---------------------------------------------------------------------------

export function toDisplayTemperatureFromCelsius(
  c: number,
  toUnit: TemperatureUnit,
  precision = 1,
): number {
  const display =
    toUnit === TemperatureUnit.Fahrenheit ? celsiusToFahrenheit(c) : c
  return Number(display.toFixed(precision))
}

// Re-export the legacy enums so consumers of '@/lib/units' have a
// one-stop import surface.
export { DistanceUnit, PressureUnit, TemperatureUnit }

// Sanity helpers exposed for cross-module reuse — the underlying legacy
// converters already round-trip cleanly with these new SI helpers
// because the conversion factors share an exact base.
export { kmToMiles, milesToKm }
