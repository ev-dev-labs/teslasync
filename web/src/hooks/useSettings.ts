import { useQuery } from '@tanstack/react-query'
import { getSettings, type AppSettings } from '../api'
import { setGlobalPrecision, fmtNumber } from '../lib/numberFormat'
import { UNITS } from '../lib/constants'

const defaults: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
}

/**
 * React hook providing application settings with unit conversion utilities.
 *
 * Fetches settings from the API (cached for 5 min) and returns converter
 * functions for distance, speed, temperature, efficiency, and pressure
 * based on the user's preferred unit system (metric vs imperial).
 *
 * @returns Settings state, boolean flags (isMiles, isFahrenheit), conversion
 *   functions (convertDistance, convertSpeed, convertTemp, convertEfficiency,
 *   convertPressure), unit labels, and formatting helpers (fmtDistance,
 *   fmtSpeed, fmtTemp).
 */
export function useSettings() {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const s = settings ?? defaults
  const decimals = s.decimal_precision ?? 2

  // Sync global precision so fmtNumber/fmtPercent/etc. use it automatically
  setGlobalPrecision(decimals)

  const isMiles = s.unit_of_length === 'mi'
  const isFahrenheit = s.unit_of_temp === 'F'

  // DB stores raw Tesla values: miles, mph, °C, PSI.
  // Convert to user's preferred display unit.

  /** Convert miles (DB) to user's preferred distance unit */
  const convertDistance = (mi: number): number => isMiles ? mi : mi * UNITS.MI_TO_KM

  /** Convert mph (DB) to user's preferred speed unit */
  const convertSpeed = (mph: number): number => isMiles ? mph : mph * UNITS.MI_TO_KM

  /** Convert Celsius (DB) to user's preferred temperature unit */
  const convertTemp = (celsius: number): number => isFahrenheit ? celsius * 9 / 5 + 32 : celsius

  /** Convert Wh/mi (DB) to user's preferred efficiency unit */
  const convertEfficiency = (whPerMi: number): number => isMiles ? whPerMi : whPerMi * UNITS.KM_TO_MI

  /** Convert PSI (DB) to user's preferred pressure unit */
  const convertPressure = (psi: number): number => isMiles ? psi : psi * UNITS.PSI_TO_BAR

  const distanceUnit = isMiles ? 'mi' : 'km'
  const speedUnit = isMiles ? 'mph' : 'km/h'
  const tempUnit = isFahrenheit ? '°F' : '°C'
  const efficiencyUnit = isMiles ? 'Wh/mi' : 'Wh/km'
  const pressureUnit = isMiles ? 'psi' : 'bar'
  const rangeType = s.preferred_range as 'rated' | 'ideal'

  /** Format a distance value with unit (input: miles from DB) */
  const fmtDistance = (mi: number, d?: number): string =>
    `${fmtNumber(convertDistance(mi), d)} ${distanceUnit}`

  /** Format a speed value with unit (input: mph from DB) */
  const fmtSpeed = (mph: number, d?: number): string =>
    `${fmtNumber(convertSpeed(mph), d)} ${speedUnit}`

  /** Format a temperature value with unit (input: °C from DB) */
  const fmtTemp = (celsius: number, d?: number): string =>
    `${fmtNumber(convertTemp(celsius), d)} ${tempUnit}`

  return {
    settings: s,
    isMiles,
    isFahrenheit,
    decimals,
    convertDistance,
    convertSpeed,
    convertTemp,
    convertEfficiency,
    convertPressure,
    distanceUnit,
    speedUnit,
    tempUnit,
    efficiencyUnit,
    pressureUnit,
    rangeType,
    fmtDistance,
    fmtSpeed,
    fmtTemp,
  }
}
