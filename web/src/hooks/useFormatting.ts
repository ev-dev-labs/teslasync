import { useCallback, useMemo } from 'react'
import { FUEL } from '@/lib/constants'
import { fmtNumber } from '@/lib/numberFormat'
import { convertDistanceFromSI } from '@/lib/unitConversion'
import { useSettings } from './useSettings'
import { useUnits } from './useUnits'

export interface UseFormattingResult {
  costPerKwh: number
  currencySymbol: string
  formatEnergyCost: (kwh: number) => string
  formatCurrency: (amount: number, decimals?: number) => string
  costPerDistanceUnit: (kwh: number, distanceM: number) => number | null
  estimateGasCost: (distanceM: number) => number | null
}

export function useFormatting(): UseFormattingResult {
  const { settings } = useSettings()
  const { unitPrefs } = useUnits()

  const costPerKwh = settings.base_cost_per_kwh ?? 0.12
  const currencySymbol = settings.currency_symbol && settings.currency_symbol.trim() ? settings.currency_symbol : '$'
  const userPrecision = typeof settings.decimal_precision === 'number' && Number.isFinite(settings.decimal_precision) && settings.decimal_precision >= 0
    ? Math.floor(settings.decimal_precision)
    : 2

  const formatEnergyCost = useCallback((kwh: number): string => {
    const cost = kwh * costPerKwh
    return `${currencySymbol}${fmtNumber(cost, userPrecision)}`
  }, [costPerKwh, currencySymbol, userPrecision])

  const formatCurrency = useCallback((amount: number, decimals?: number): string => {
    const d = decimals ?? userPrecision
    return `${currencySymbol}${fmtNumber(amount, d)}`
  }, [currencySymbol, userPrecision])

  /**
   * Calculate cost per user-preferred distance unit from SI meters.
   * @since phase-48-slice-5 distanceM input changed from legacy miles to SI meters.
   */
  const costPerDistanceUnit = useCallback((kwh: number, distanceM: number): number | null => {
    if (distanceM <= 0) return null
    const cost = kwh * costPerKwh
    const distance = convertDistanceFromSI(distanceM, unitPrefs.distance)
    return distance > 0 ? cost / distance : null
  }, [costPerKwh, unitPrefs.distance])

  /**
   * Estimate gasoline cost for an SI-meter distance. MPG is miles-based, so
   * this one internal bridge converts meters to miles before applying mpg.
   * @since phase-48-slice-5 distanceM input changed from legacy miles to SI meters.
   */
  const estimateGasCost = useCallback((distanceM: number): number | null => {
    const mpg = settings.gas_efficiency_mpg ?? 0
    const gasPrice = settings.gas_price_per_unit ?? 0
    if (mpg <= 0 || gasPrice <= 0 || distanceM <= 0) return null
    const distanceMi = convertDistanceFromSI(distanceM, 'mi')
    const gallonsUsed = distanceMi / mpg
    if ((settings.gas_unit ?? 'gallon') === 'liter') {
      return gallonsUsed * FUEL.GALLONS_TO_LITERS * gasPrice
    }
    return gallonsUsed * gasPrice
  }, [settings.gas_efficiency_mpg, settings.gas_price_per_unit, settings.gas_unit])

  return useMemo(() => ({
    costPerKwh,
    currencySymbol,
    formatEnergyCost,
    formatCurrency,
    costPerDistanceUnit,
    estimateGasCost,
  }), [
    costPerKwh,
    currencySymbol,
    formatEnergyCost,
    formatCurrency,
    costPerDistanceUnit,
    estimateGasCost,
  ])
}
