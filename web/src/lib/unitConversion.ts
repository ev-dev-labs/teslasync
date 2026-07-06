/**
 * SI-floor unit conversion module (, ).
 *
 * Every conversion / formatter in this file accepts canonical SI input
 * ONLY. There is NO runtime fallback that "guesses the input unit" —
 * that anti-pattern hid bugs in the legacy code. Producers (api/hooks/*)
 * deliver SI; renderers convert at the boundary.
 *
 * Authoritative SI baseline (mirrors `internal/tesla/units` Go package
 * for the Tesla telemetry pipeline; pressure and energy SI baselines
 * are scoped to the frontend display contract per ):
 *
 * distance → meters (m)
 * speed → meters per second (m/s)
 * temperature → degrees Celsius (°C)
 * pressure → kilopascals (kPa)
 * energy → watt-hours (Wh)
 * duration → seconds (s)
 *
 * Public surface (NEW, SI-floor):
 *
 * const SI — informational map of canonical SI units.
 * type UnitPref — user display preference bag.
 * formatDistance(meters, pref): string
 * formatSpeed(mps, pref): string
 * formatTemperature(celsius, pref): string
 * formatPressure(kpa, pref): string
 * formatEnergy(wh, pref): string
 * formatDuration(seconds, pref): string
 * formatPower(watts, pref): string
 * convertDistanceFromSI / convertSpeedFromSI / convertTempFromSI /
 * convertPressureFromSI / convertEnergyFromSI / convertDurationFromSI /
 * convertPowerFromSI
 */

// ---------------------------------------------------------------------------
// SI canonical baseline (informational; renderers reference this so the
// canonical input contract is discoverable from a single export).
// ---------------------------------------------------------------------------

/**
 * Canonical SI input units this module accepts. Provided as a frozen
 * literal so call sites can `import { SI }` and document the producer
 * contract at the call boundary.
 */
export const SI = Object.freeze({
  distance: 'm',
  speed: 'm/s',
  temperature: '°C',
  pressure: 'kPa',
  energy: 'Wh',
  duration: 's',
  power: 'W',
} as const)

// ---------------------------------------------------------------------------
// User display preference bag.
// ---------------------------------------------------------------------------

/** Distance display unit (target of formatDistance). */
export type DistanceUnitPref = 'km' | 'mi' | 'ft'
/** Speed display unit (target of formatSpeed). */
export type SpeedUnitPref = 'km/h' | 'mph'
/** Temperature display unit (target of formatTemperature). */
export type TemperatureUnitPref = '°C' | '°F'
/** Pressure display unit (target of formatPressure). */
export type PressureUnitPref = 'kPa' | 'psi' | 'bar'
/** Energy display unit (target of formatEnergy). */
export type EnergyUnitPref = 'Wh' | 'kWh'
/** Duration display unit (target of formatDuration). */
export type DurationUnitPref = 's' | 'min' | 'h' | 'd'
/** Power display unit (target of formatPower). */
export type PowerUnitPref = 'W' | 'kW'

/**
 * UnitPref aggregates the user's per-quantity display preference plus
 * locale + precision hints for `Intl.NumberFormat`. Pages compute one
 * UnitPref per render (typically from `useSettings`) and pass it to
 * each `formatX` call. There is intentionally no module-level cache —
 * the caller owns the preference lifecycle.
 */
export interface UnitPref {
  distance: DistanceUnitPref
  speed: SpeedUnitPref
  temperature: TemperatureUnitPref
  pressure: PressureUnitPref
  energy: EnergyUnitPref
  duration: DurationUnitPref
  power: PowerUnitPref
  /** BCP-47 locale tag passed to `Intl.NumberFormat`. Undefined = host. */
  locale?: string
  /** Default `maximumFractionDigits` when formatX has no per-call override. */
  precision?: number
  /** Display fallback when a formatX receives null/undefined/NaN. Default '—'. */
  emptyDisplay?: string
}

// ---------------------------------------------------------------------------
// Conversion factors. Values are NIST-grade where applicable. Each
// converter is a pure unidirectional function: SI input → display unit.
// ---------------------------------------------------------------------------

/** 1 mile = 1609.344 m exactly (international yard, NIST). */
const METERS_PER_MILE = 1609.344
/** 1 km = 1000 m exactly. */
const METERS_PER_KM = 1000
/** 1 ft = 0.3048 m exactly (international foot, NIST). */
const METERS_PER_FOOT = 0.3048
/** 1 psi = 6.894757 kPa (NIST SP 811, rounded to display precision). */
const KPA_PER_PSI = 6.894757
/** 1 bar = 100 kPa (BIPM definition). */
const KPA_PER_BAR = 100
/** Seconds in a minute / hour / day. */
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400

// ---------------------------------------------------------------------------
// Pure SI → display numeric converters.
// Every fn assumes SI input. NO branching on a "guess the input unit" flag.
// ---------------------------------------------------------------------------

/**
 * Convert distance from SI meters to the user's display unit.
 * @param meters - distance in meters (SI)
 * @param to - target display unit
 */
export function convertDistanceFromSI(
  meters: number,
  to: DistanceUnitPref,
): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM
    case 'mi':
      return meters / METERS_PER_MILE
    case 'ft':
      return meters / METERS_PER_FOOT
  }
}

/**
 * Convert a distance from a display unit back to SI meters.
 *
 * Exact inverse of {@link convertDistanceFromSI}. Producers should already
 * emit SI, so this is reserved for the rare case where a constant is only
 * known in a display unit (e.g. an efficiency figure quoted in mi/kWh) and
 * must be lifted into SI before feeding an SI-only consumer — without any
 * call site hardcoding the mile/foot factor.
 *
 * @param value - distance in the `from` display unit
 * @param from - source display unit
 */
export function convertDistanceToSI(
  value: number,
  from: DistanceUnitPref,
): number {
  switch (from) {
    case 'km':
      return value * METERS_PER_KM
    case 'mi':
      return value * METERS_PER_MILE
    case 'ft':
      return value * METERS_PER_FOOT
  }
}

/**
 * Convert speed from SI meters-per-second to the user's display unit.
 * @param mps - speed in meters per second (SI)
 * @param to - target display unit
 */
export function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
  }
}

/**
 * Convert temperature from SI Celsius to the user's display unit.
 * @param celsius - temperature in degrees Celsius (SI)
 * @param to - target display unit
 */
export function convertTempFromSI(
  celsius: number,
  to: TemperatureUnitPref,
): number {
  switch (to) {
    case '°C':
      return celsius
    case '°F':
      return (celsius * 9) / 5 + 32
  }
}

/**
 * Convert pressure from SI kilopascals to the user's display unit.
 * @param kpa - pressure in kilopascals (SI)
 * @param to - target display unit
 */
export function convertPressureFromSI(
  kpa: number,
  to: PressureUnitPref,
): number {
  switch (to) {
    case 'kPa':
      return kpa
    case 'psi':
      return kpa / KPA_PER_PSI
    case 'bar':
      return kpa / KPA_PER_BAR
  }
}

/**
 * Convert energy from SI watt-hours to the user's display unit.
 * @param wh - energy in watt-hours (SI for the FE display contract;
 * matches the new Go struct's energy_*_wh JSON tags).
 * @param to - target display unit
 */
export function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh
    case 'kWh':
      return wh / 1000
  }
}

/**
 * Convert duration from SI seconds to the user's display unit.
 * @param seconds - duration in seconds (SI)
 * @param to - target display unit
 */
export function convertDurationFromSI(
  seconds: number,
  to: DurationUnitPref,
): number {
  switch (to) {
    case 's':
      return seconds
    case 'min':
      return seconds / SECONDS_PER_MINUTE
    case 'h':
      return seconds / SECONDS_PER_HOUR
    case 'd':
      return seconds / SECONDS_PER_DAY
  }
}

/**
 * Convert power from SI watts to the user's display unit.
 * @param watts - power in watts (SI)
 * @param to - target display unit
 */
export function convertPowerFromSI(watts: number, to: PowerUnitPref): number {
  switch (to) {
    case 'W':
      return watts
    case 'kW':
      return watts / 1000
  }
}

// ---------------------------------------------------------------------------
// Locale-aware string formatters.
// Each fn returns the locale '—' fallback (or pref.emptyDisplay) for
// null / undefined / NaN / non-finite inputs and never throws.
// ---------------------------------------------------------------------------

/** Default fallback string for nullish / NaN inputs. */
const DEFAULT_EMPTY_DISPLAY = '—'

/** Default precision per quantity when `pref.precision` is unset. */
const DEFAULT_PRECISION: Record<keyof typeof SI, number> = {
  distance: 1,
  speed: 0,
  temperature: 1,
  pressure: 1,
  energy: 2,
  duration: 0,
  power: 2,
}

interface FormatOptions {
  /** Override `pref.precision` for this single call. */
  precision?: number
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function formatNumber(
  value: number,
  locale: string | undefined,
  fractionDigits: number,
): string {
  // Intl.NumberFormat handles negatives, very large, very small, locale
  // separators, and grouping. We pin maximum + minimum to the same
  // digit count to keep tabular layouts aligned.
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

function resolveEmpty(pref: Pick<UnitPref, 'emptyDisplay'> | undefined): string {
  return pref?.emptyDisplay ?? DEFAULT_EMPTY_DISPLAY
}

function resolvePrecision(
  pref: Pick<UnitPref, 'precision'> | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override)
  }
  if (
    pref &&
    typeof pref.precision === 'number' &&
    Number.isFinite(pref.precision) &&
    pref.precision >= 0
  ) {
    return Math.floor(pref.precision)
  }
  return fallback
}

/**
 * Format an SI-meters distance for display in the user's unit.
 * @param meters - distance in meters (SI). Null/undefined/NaN → fallback.
 * @param pref - user display preference.
 */
export function formatDistance(
  meters: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(meters)) return resolveEmpty(pref)
  const digits = resolvePrecision(pref, options?.precision, DEFAULT_PRECISION.distance)
  const value = convertDistanceFromSI(meters, pref.distance)
  return `${formatNumber(value, pref.locale, digits)} ${pref.distance}`
}

/**
 * Format an SI m/s speed for display in the user's unit.
 * @param mps - speed in meters per second (SI). Null/undefined/NaN → fallback.
 * @param pref - user display preference.
 */
export function formatSpeed(
  mps: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(mps)) return resolveEmpty(pref)
  const digits = resolvePrecision(pref, options?.precision, DEFAULT_PRECISION.speed)
  const value = convertSpeedFromSI(mps, pref.speed)
  return `${formatNumber(value, pref.locale, digits)} ${pref.speed}`
}

/**
 * Format an SI Celsius temperature for display in the user's unit.
 * @param celsius - temperature in degrees Celsius (SI). Null/undefined/NaN → fallback.
 * @param pref - user display preference.
 */
export function formatTemperature(
  celsius: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(celsius)) return resolveEmpty(pref)
  const digits = resolvePrecision(pref, options?.precision, DEFAULT_PRECISION.temperature)
  const value = convertTempFromSI(celsius, pref.temperature)
  // No space between number and °unit (typographic convention).
  return `${formatNumber(value, pref.locale, digits)}${pref.temperature}`
}

/**
 * Format an SI kilopascal pressure for display in the user's unit.
 * @param kpa - pressure in kilopascals (SI). Null/undefined/NaN → fallback.
 * @param pref - user display preference.
 */
export function formatPressure(
  kpa: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(kpa)) return resolveEmpty(pref)
  const digits = resolvePrecision(pref, options?.precision, DEFAULT_PRECISION.pressure)
  const value = convertPressureFromSI(kpa, pref.pressure)
  return `${formatNumber(value, pref.locale, digits)} ${pref.pressure}`
}

/**
 * Format an SI watt-hours energy for display in the user's unit.
 * @param wh - energy in watt-hours (SI). Null/undefined/NaN → fallback.
 * @param pref - user display preference.
 */
export function formatEnergy(
  wh: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(wh)) return resolveEmpty(pref)
  const digits = resolvePrecision(pref, options?.precision, DEFAULT_PRECISION.energy)
  const value = convertEnergyFromSI(wh, pref.energy)
  return `${formatNumber(value, pref.locale, digits)} ${pref.energy}`
}

/**
 * Format an SI seconds duration for display in the user's unit.
 * @param seconds - duration in seconds (SI). Null/undefined/NaN → fallback.
 * @param pref - user display preference.
 */
export function formatDuration(
  seconds: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(seconds)) return resolveEmpty(pref)
  const digits = resolvePrecision(pref, options?.precision, DEFAULT_PRECISION.duration)
  const value = convertDurationFromSI(seconds, pref.duration)
  return `${formatNumber(value, pref.locale, digits)} ${pref.duration}`
}

/**
 * Format SI watts for display in the user's unit.
 * @param watts - power in watts (SI). Null/undefined/NaN → fallback.
 * @param pref - user display preference.
 */
export function formatPower(
  watts: number | null | undefined,
  pref: UnitPref,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(watts)) return resolveEmpty(pref)
  const digits = resolvePrecision(pref, options?.precision, DEFAULT_PRECISION.power)
  const value = convertPowerFromSI(watts, pref.power)
  return `${formatNumber(value, pref.locale, digits)} ${pref.power}`
}
