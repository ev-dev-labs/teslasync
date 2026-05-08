import { useCallback, useMemo } from 'react'
import { useSettings } from './useSettings'
import {
  formatDistance as libFormatDistance,
  formatSpeed as libFormatSpeed,
  formatTemperature as libFormatTemperature,
  formatPressure as libFormatPressure,
  formatEnergy as libFormatEnergy,
  formatDuration as libFormatDuration,
  formatPower as libFormatPower,
  type UnitPref,
  type DistanceUnitPref,
  type SpeedUnitPref,
  type TemperatureUnitPref,
  type PressureUnitPref,
  type EnergyUnitPref,
  type DurationUnitPref,
  type PowerUnitPref,
} from '../lib/unitConversion'

/**
 * Phase-43 / Prompt 0013 — `useUnits` is the per-render bridge between the
 * user's settings preference and SI-floor formatters.
 *
 * Contract:
 *   - Reads `useSettings()` once per render and derives a stable `UnitPref`.
  *   - Exposes `formatDistance / formatSpeed / formatTemperature /
  *     formatPressure / formatEnergy / formatDuration / formatPower`. Every formatter
 *     delegates to the corresponding `formatX(value, pref, options)` in
 *     `@/lib/unitConversion` — this hook performs NO unit math itself.
 *     Inline math here was the source of legacy drift that prompt 0010
 *     consolidated; rule of thumb: never reach for a hand-typed mile-to-km
 *     factor or a Fahrenheit offset in this file — let the lib do it.
 *   - Returns a stable `unitPrefs` so non-hook utilities (chart-axis label
 *     resolvers, custom report builders) can pass it to the same
 *     `formatX(value, pref)` lib functions outside of the React tree.
 *
 * Reference stability:
 *   - `unitPrefs`, every `formatX`, and the outer return object are
 *     memoized over the primitive preference dependencies (distance,
 *     speed, temperature, pressure, energy, duration prefs + locale +
 *     precision). Re-renders that don't change those primitives return
 *     identical references, so memoized child components / `useMemo`
 *     hooks downstream don't recompute.
 */

/** Per-call formatter override surface. Mirrors lib `FormatOptions`. */
export interface FormatOptions {
  /** Override the default `maximumFractionDigits` for this call only. */
  precision?: number
}

/** Function signature shared by every formatter returned by `useUnits`. */
export type UnitFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string

/** Shape of the value returned by `useUnits`. */
export interface UseUnitsResult {
  /** Stable `UnitPref` bag suitable for direct use with `lib/unitConversion`. */
  unitPrefs: UnitPref
  formatDistance: UnitFormatter
  formatSpeed: UnitFormatter
  formatTemperature: UnitFormatter
  formatPressure: UnitFormatter
  formatEnergy: UnitFormatter
  formatDuration: UnitFormatter
  formatPower: UnitFormatter
}

/**
 * Default energy display unit. The backend's energy fields surface in
 * watt-hours (SI), but vehicle-energy widgets read more naturally in kWh.
 * A future settings field can promote this to a user preference; for now
 * the hook centralises the default so adoption sites don't need to know.
 */
const DEFAULT_ENERGY_PREF: EnergyUnitPref = 'kWh'

/**
 * Default duration display unit. Drives, charging sessions, and idle
 * windows are all conveniently expressed in hours; sub-minute durations
 * should pass `{ precision }` if they need finer granularity.
 */
const DEFAULT_DURATION_PREF: DurationUnitPref = 'h'
const DEFAULT_POWER_PREF: PowerUnitPref = 'kW'

/** Default locale fallback when `settings.locale` is absent or empty. */
const DEFAULT_LOCALE = 'en-US'

function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km'
}

function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h'
}

function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C'
}

function derivePressure(unitOfPressure: string | undefined): PressureUnitPref {
  return unitOfPressure === 'psi' ? 'psi' : 'bar'
}

function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) return locale
  return DEFAULT_LOCALE
}

function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') return undefined
  if (!Number.isFinite(decimalPrecision)) return undefined
  if (decimalPrecision < 0) return undefined
  return Math.floor(decimalPrecision)
}

export function useUnits(): UseUnitsResult {
  const { settings } = useSettings()

  const distance = deriveDistance(settings.unit_of_length)
  const speed = deriveSpeed(settings.unit_of_length)
  const temperature = deriveTemperature(settings.unit_of_temp)
  const pressure = derivePressure(settings.unit_of_pressure)
  const locale = deriveLocale(settings.locale)
  const precision = derivePrecision(settings.decimal_precision)

  const unitPrefs = useMemo<UnitPref>(
    () => ({
      distance,
      speed,
      temperature,
      pressure,
      energy: DEFAULT_ENERGY_PREF,
      duration: DEFAULT_DURATION_PREF,
      power: DEFAULT_POWER_PREF,
      locale,
      precision,
    }),
    [distance, speed, temperature, pressure, locale, precision],
  )

  const formatDistance = useCallback<UnitFormatter>(
    (value, options) => libFormatDistance(value, unitPrefs, options),
    [unitPrefs],
  )
  const formatSpeed = useCallback<UnitFormatter>(
    (value, options) => libFormatSpeed(value, unitPrefs, options),
    [unitPrefs],
  )
  const formatTemperature = useCallback<UnitFormatter>(
    (value, options) => libFormatTemperature(value, unitPrefs, options),
    [unitPrefs],
  )
  const formatPressure = useCallback<UnitFormatter>(
    (value, options) => libFormatPressure(value, unitPrefs, options),
    [unitPrefs],
  )
  const formatEnergy = useCallback<UnitFormatter>(
    (value, options) => libFormatEnergy(value, unitPrefs, options),
    [unitPrefs],
  )
  const formatDuration = useCallback<UnitFormatter>(
    (value, options) => libFormatDuration(value, unitPrefs, options),
    [unitPrefs],
  )
  const formatPower = useCallback<UnitFormatter>(
    (value, options) => libFormatPower(value, unitPrefs, options),
    [unitPrefs],
  )

  return useMemo(
    () => ({
      unitPrefs,
      formatDistance,
      formatSpeed,
      formatTemperature,
      formatPressure,
      formatEnergy,
      formatDuration,
      formatPower,
    }),
    [
      unitPrefs,
      formatDistance,
      formatSpeed,
      formatTemperature,
      formatPressure,
      formatEnergy,
      formatDuration,
      formatPower,
    ],
  )
}
