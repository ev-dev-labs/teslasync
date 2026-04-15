/**
 * Parse Tesla Fleet Telemetry enum values into clean display strings.
 * Tesla sends values like "DistanceUnitMiles", "TemperatureUnitCelsius",
 * "ChargeUnitPercent", "PressureUnitPsi" — this strips the prefix and returns
 * the human-readable value.
 */

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

/** Parse a Tesla setting enum to clean display value */
export function parseSettingEnum(value: string | undefined | null, category: keyof typeof enumMappings): string {
  if (!value) return '—'
  const lower = value.toLowerCase().replace(/[^a-z]/g, '')
  return enumMappings[category]?.[lower] ?? value
}

/** Detect if setting means imperial/miles */
export function isSettingMiles(value: string | undefined | null): boolean {
  if (!value) return false
  const lower = value.toLowerCase()
  return lower.includes('mile')
}

/** Detect if setting means Fahrenheit */
export function isSettingFahrenheit(value: string | undefined | null): boolean {
  if (!value) return false
  const lower = value.toLowerCase()
  return lower.includes('fahr')
}

/** Detect if setting means PSI */
export function isSettingPSI(value: string | undefined | null): boolean {
  if (!value) return false
  const lower = value.toLowerCase()
  return lower.includes('psi')
}

/** Detect if setting means Bar */
export function isSettingBar(value: string | undefined | null): boolean {
  if (!value) return false
  const lower = value.toLowerCase()
  return lower.includes('bar')
}
