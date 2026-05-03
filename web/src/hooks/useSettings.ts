import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSettings } from '@/api/settings'
import type { AppSettings } from '@/api/types'
import { setGlobalPrecision, setGlobalLocale, fmtNumber } from '../lib/numberFormat'
import { subscribe } from '../lib/broadcast'
import { TOPICS } from '../lib/broadcastTopics'
import { FUEL } from '../lib/constants'
import {
  milesToKm,
  celsiusToFahrenheit,
  barToPsi,
  kmToMiles,
} from '@/lib/unitConversion'

const defaults: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
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
  currency_symbol: '$',
  locale: 'en-US',
  tz_display_default: 'vehicle',
  timezone_user: '',
  tab_badge_enabled: true,
  critical_flash_enabled: true,
  ui_density: 'comfortable',
  time_format_default: 'relative',
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
  const { data: settings, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const s = settings ?? defaults
  const decimals = s.decimal_precision ?? 2
  const locale = s.locale ?? 'en-US'
  const density: 'compact' | 'comfortable' | 'spacious' =
    s.ui_density === 'compact' || s.ui_density === 'spacious' ? s.ui_density : 'comfortable'

  // Sync global precision/locale so fmtNumber/fmtPercent/etc. use them
  // automatically. Phase-45/06: moved into useEffect so the side effect
  // runs in commit phase (not during render) — this avoids
  // double-application under React.StrictMode and makes the contract
  // consistent with <FormatterPrefsBridge /> at the app root.
  useEffect(() => {
    setGlobalPrecision(decimals)
    setGlobalLocale(locale)
  }, [decimals, locale])

  // Phase-45/06: listen for cross-tab `settings.changed` broadcasts so
  // even if this tab's `['settings']` query was never fetched (e.g. the
  // bridge tore down for some reason), we still refetch on a peer's
  // mutation. Coexists harmlessly with <FormatterPrefsBridge /> which
  // does the same — TanStack Query dedupes concurrent invalidations.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== TOPICS.SETTINGS_CHANGED) return
      void refetch()
    })
  }, [refetch])

  const isMiles = s.unit_of_length === 'mi'
  const isFahrenheit = s.unit_of_temp === 'F'
  const isPSI = (s.unit_of_pressure ?? 'bar') === 'psi'

  // Internal storage: miles, mph, °C, bar.
  // Convert to user's preferred display unit using @/lib/unitConversion.

  /** Convert miles (internal) to user's preferred distance unit */
  const convertDistance = (mi: number): number => isMiles ? mi : milesToKm(mi)

  /** Convert mph (internal) to user's preferred speed unit */
  const convertSpeed = (mph: number): number => isMiles ? mph : milesToKm(mph)

  /** Convert Celsius (internal) to user's preferred temperature unit */
  const convertTemp = (celsius: number): number => isFahrenheit ? celsiusToFahrenheit(celsius) : celsius

  /** Convert Wh/mi (internal) to user's preferred efficiency unit */
  const convertEfficiency = (whPerMi: number): number => isMiles ? whPerMi : kmToMiles(whPerMi)

  /** Convert bar (internal) to user's preferred pressure unit */
  const convertPressure = (bar: number): number => isPSI ? barToPsi(bar) : bar

  const distanceUnit = isMiles ? 'mi' : 'km'
  const speedUnit = isMiles ? 'mph' : 'km/h'
  const tempUnit = isFahrenheit ? '°F' : '°C'
  const efficiencyUnit = isMiles ? 'Wh/mi' : 'Wh/km'
  const pressureUnit = isPSI ? 'psi' : 'bar'
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

  /** Format a pressure value with unit (input: bar from internal storage) */
  const fmtPressure = (bar: number, d?: number): string =>
    `${fmtNumber(convertPressure(bar), d)} ${pressureUnit}`

  // ---- Cost helpers ----
  const costPerKwh = s.base_cost_per_kwh ?? 0.12
  const currencySymbol = s.currency_symbol && s.currency_symbol.trim() ? s.currency_symbol : '$'

  /** Format energy consumption (kWh) as a currency string */
  const formatEnergyCost = (kwh: number): string => {
    const cost = kwh * costPerKwh
    return `${currencySymbol}${cost.toFixed(2)}`
  }

  /** Format a raw currency amount */
  const formatCurrency = (amount: number, d = 2): string =>
    `${currencySymbol}${amount.toFixed(d)}`

  /** Calculate cost per user-preferred distance unit (input: kWh and miles from DB) */
  const costPerDistanceUnit = (kwh: number, distanceMi: number): number | null => {
    if (distanceMi <= 0) return null
    const cost = kwh * costPerKwh
    const dist = convertDistance(distanceMi)
    return cost / dist
  }

  /** Estimate gas cost for same distance (input: miles from DB). Normalizes gas_unit (gallon/liter). */
  const estimateGasCost = (distanceMi: number): number | null => {
    const mpg = s.gas_efficiency_mpg ?? 0
    const gasPrice = s.gas_price_per_unit ?? 0
    if (mpg <= 0 || gasPrice <= 0 || distanceMi <= 0) return null
    const gallonsUsed = distanceMi / mpg
    if ((s.gas_unit ?? 'gallon') === 'liter') {
      return gallonsUsed * FUEL.GALLONS_TO_LITERS * gasPrice
    }
    return gallonsUsed * gasPrice
  }

  return {
    settings: s,
    isMiles,
    isFahrenheit,
    isPSI,
    decimals,
    locale,
    density,
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
    fmtPressure,
    costPerKwh,
    currencySymbol,
    formatEnergyCost,
    formatCurrency,
    costPerDistanceUnit,
    estimateGasCost,
  }
}
