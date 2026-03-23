import { useQuery } from '@tanstack/react-query'
import { getSettings, type AppSettings } from '../api'

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

  const isMiles = s.unit_of_length === 'mi'
  const isFahrenheit = s.unit_of_temp === 'F'

  /** Convert km to user's preferred distance unit */
  const convertDistance = (km: number): number => isMiles ? km * 0.621371 : km

  /** Convert km/h to user's preferred speed unit */
  const convertSpeed = (kmh: number): number => isMiles ? kmh * 0.621371 : kmh

  /** Convert Celsius to user's preferred temperature unit */
  const convertTemp = (celsius: number): number => isFahrenheit ? celsius * 9 / 5 + 32 : celsius

  /** Convert Wh/km to Wh/mi if user prefers miles */
  const convertEfficiency = (whPerKm: number): number => isMiles ? whPerKm * 1.60934 : whPerKm

  /** Convert bar to psi if user prefers miles (imperial) */
  const convertPressure = (bar: number): number => isMiles ? bar * 14.5038 : bar

  const distanceUnit = isMiles ? 'mi' : 'km'
  const speedUnit = isMiles ? 'mph' : 'km/h'
  const tempUnit = isFahrenheit ? '°F' : '°C'
  const efficiencyUnit = isMiles ? 'Wh/mi' : 'Wh/km'
  const pressureUnit = isMiles ? 'psi' : 'bar'
  const rangeType = s.preferred_range as 'rated' | 'ideal'

  /** Format a distance value with unit */
  const fmtDistance = (km: number, decimals = 1): string =>
    `${convertDistance(km).toFixed(decimals)} ${distanceUnit}`

  /** Format a speed value with unit */
  const fmtSpeed = (kmh: number, decimals = 0): string =>
    `${convertSpeed(kmh).toFixed(decimals)} ${speedUnit}`

  /** Format a temperature value with unit */
  const fmtTemp = (celsius: number, decimals = 1): string =>
    `${convertTemp(celsius).toFixed(decimals)} ${tempUnit}`

  return {
    settings: s,
    isMiles,
    isFahrenheit,
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
