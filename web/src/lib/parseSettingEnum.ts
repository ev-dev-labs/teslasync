/**
 * Parse Tesla Fleet Telemetry enum values into clean display strings.
 * Tesla sends values like "DistanceUnitMiles", "TemperatureUnitCelsius",
 * "ChargeUnitPercent", "PressureUnitPsi" — this strips the prefix and returns
 * the human-readable value.
 *
 * The backend serializes raw `signal.SignalValue` (`interface{}`) directly, so
 * a nominally "string" setting field can arrive at runtime as a bool/number.
 * Every helper accepts `unknown` and narrows defensively via `asNonEmptyString`
 * — never calling `.toLowerCase()`/`.includes()` on a value whose runtime shape
 * we don't control (mirrors safetyEnum.ts / parseEnums.ts).
 */

import { asNonEmptyString } from './typeGuards'

const enumMappings: Record<string, Record<string, string>> = {
  distance: {
    distanceunitmiles: 'Miles',
    distanceunitkilometers: 'Kilometers',
    distanceunitkm: 'Kilometers',
    miles: 'Miles',
    mi: 'Miles',
    km: 'Kilometers',
    kilometers: 'Kilometers',
  },
  temperature: {
    temperatureunitcelsius: 'Celsius',
    temperatureunitfahrenheit: 'Fahrenheit',
    celsius: 'Celsius',
    fahrenheit: 'Fahrenheit',
    c: 'Celsius',
    f: 'Fahrenheit',
  },
  charge: {
    chargeunitpercent: 'Percent',
    chargeunitmiles: 'Miles',
    chargeunitkilometers: 'Kilometers',
    percent: 'Percent',
    mi: 'Miles',
    km: 'Kilometers',
  },
  pressure: {
    pressureunitpsi: 'PSI',
    pressureunitbar: 'Bar',
    pressureunitkpa: 'kPa',
    psi: 'PSI',
    bar: 'Bar',
    kpa: 'kPa',
  },
}

/** Parse a Tesla setting enum to clean display value. Returns '—' for
 *  nullish / non-string / empty input. */
export function parseSettingEnum(value: unknown, category: keyof typeof enumMappings): string {
  const raw = asNonEmptyString(value)
  if (!raw) return '—'
  const lower = raw.toLowerCase().replace(/[^a-z]/g, '')
  return enumMappings[category]?.[lower] ?? raw
}

/** Detect if a setting means imperial/miles. Matches the full Tesla enum
 *  ("DistanceUnitMiles"/"ChargeUnitMiles") and the codec-stripped "mi"
 *  abbreviation — both of which the enumMappings table above lists. Without
 *  the "mi" branch a car reporting the short form would sync the app to km. */
export function isSettingMiles(value: unknown): boolean {
  const raw = asNonEmptyString(value)
  if (!raw) return false
  const lower = raw.toLowerCase()
  return lower.includes('mile') || lower.replace(/[^a-z]/g, '') === 'mi'
}

/** Detect if a setting means Fahrenheit. Matches the full Tesla enum
 *  ("TemperatureUnitFahrenheit") and the "f" abbreviation. */
export function isSettingFahrenheit(value: unknown): boolean {
  const raw = asNonEmptyString(value)
  if (!raw) return false
  const lower = raw.toLowerCase()
  return lower.includes('fahr') || lower.replace(/[^a-z]/g, '') === 'f'
}

/** Detect if a setting means PSI. */
export function isSettingPSI(value: unknown): boolean {
  const raw = asNonEmptyString(value)
  if (!raw) return false
  return raw.toLowerCase().includes('psi')
}

/** Detect if a setting means Bar. */
export function isSettingBar(value: unknown): boolean {
  const raw = asNonEmptyString(value)
  if (!raw) return false
  return raw.toLowerCase().includes('bar')
}
