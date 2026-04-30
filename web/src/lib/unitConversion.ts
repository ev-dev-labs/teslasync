/**
 * Pure unit conversion helpers.
 *
 * Internal storage is always: miles, °C, PSI.
 * These functions convert between internal and display units.
 */

import { UNITS } from './constants'

// ---------------------------------------------------------------------------
// Unit enums (match Tesla proto values used by the API)
// ---------------------------------------------------------------------------

export enum DistanceUnit {
  Unknown = 0,
  Miles = 1,
  Kilometers = 2,
}

export enum TemperatureUnit {
  Unknown = 0,
  Fahrenheit = 1,
  Celsius = 2,
}

export enum PressureUnit {
  Unknown = 0,
  PSI = 1,
  Bar = 2,
}

// ---------------------------------------------------------------------------
// Low-level converters (stateless, pure)
// ---------------------------------------------------------------------------

export function milesToKm(miles: number): number {
  return miles * UNITS.MI_TO_KM
}

export function kmToMiles(km: number): number {
  return km * UNITS.KM_TO_MI
}

export function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32
}

export function fahrenheitToCelsius(f: number): number {
  return (f - 32) * 5 / 9
}

export function psiToBar(psi: number): number {
  return psi / UNITS.BAR_TO_PSI
}

export function barToPsi(bar: number): number {
  return bar * UNITS.BAR_TO_PSI
}

// ---------------------------------------------------------------------------
// High-level display converters (internal units → user preference)
// ---------------------------------------------------------------------------

/** Convert a value from internal units to user's display preference */
export function convertDistance(miles: number, toUnit: 'mi' | 'km'): number {
  return toUnit === 'km' ? milesToKm(miles) : miles
}

export function convertTemp(celsius: number, toUnit: '°C' | '°F'): number {
  return toUnit === '°F' ? celsiusToFahrenheit(celsius) : celsius
}

export function convertPressure(psi: number, toUnit: 'PSI' | 'bar'): number {
  return toUnit === 'bar' ? psiToBar(psi) : psi
}

// ---------------------------------------------------------------------------
// Source-aware display converters
// ---------------------------------------------------------------------------

/**
 * Convert a distance from its source unit to the user's display unit,
 * rounding to the given precision.
 *
 * When both source and target are Unknown (0), the raw value is returned.
 */
export function toDisplayDistance(
  value: number,
  fromUnit: DistanceUnit,
  toUnit: DistanceUnit,
  precision = 1,
): number {
  const miles =
    fromUnit === DistanceUnit.Kilometers ? kmToMiles(value) : value
  const display =
    toUnit === DistanceUnit.Kilometers ? milesToKm(miles) : miles
  return Number(display.toFixed(precision))
}

/**
 * Convert a temperature from its source unit to the user's display unit,
 * rounding to the given precision.
 */
export function toDisplayTemperature(
  value: number,
  fromUnit: TemperatureUnit,
  toUnit: TemperatureUnit,
  precision = 1,
): number {
  const celsius =
    fromUnit === TemperatureUnit.Fahrenheit
      ? fahrenheitToCelsius(value)
      : value
  const display =
    toUnit === TemperatureUnit.Fahrenheit
      ? celsiusToFahrenheit(celsius)
      : celsius
  return Number(display.toFixed(precision))
}

/**
 * Convert a pressure from its source unit to the user's display unit,
 * rounding to the given precision.
 */
export function toDisplayPressure(
  value: number,
  fromUnit: PressureUnit,
  toUnit: PressureUnit,
  precision = 1,
): number {
  const psi =
    fromUnit === PressureUnit.Bar ? barToPsi(value) : value
  const display =
    toUnit === PressureUnit.Bar ? psiToBar(psi) : psi
  return Number(display.toFixed(precision))
}

// ---------------------------------------------------------------------------
// Unit labels
// ---------------------------------------------------------------------------

export function distanceLabel(unit: DistanceUnit): string {
  return unit === DistanceUnit.Kilometers ? 'km' : 'mi'
}

export function speedLabel(unit: DistanceUnit): string {
  return unit === DistanceUnit.Kilometers ? 'km/h' : 'mph'
}

export function temperatureLabel(unit: TemperatureUnit): string {
  return unit === TemperatureUnit.Fahrenheit ? '°F' : '°C'
}

export function pressureLabel(unit: PressureUnit): string {
  return unit === PressureUnit.Bar ? 'bar' : 'PSI'
}
