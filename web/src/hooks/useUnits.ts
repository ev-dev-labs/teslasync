import { useMemo } from 'react'
import { useSettings } from './useSettings'
import { fmtNumber } from '../lib/numberFormat'

/**
 * Convenience formatting hook — wraps useSettings conversions with null handling.
 * DB stores: miles, mph, °C, PSI. Converts to user preference automatically.
 */
export function useUnits() {
  const {
    convertDistance, convertSpeed, convertTemp, convertEfficiency, convertPressure,
    distanceUnit, speedUnit, tempUnit, efficiencyUnit, pressureUnit,
    isMiles, isFahrenheit,
  } = useSettings()

  const isMetric = !isMiles
  const isCelsius = !isFahrenheit

  return useMemo(() => ({
    distance: (v: number | undefined | null) => v == null ? '—' : `${fmtNumber(convertDistance(v))} ${distanceUnit}`,
    distanceVal: convertDistance,
    distanceUnit,

    speed: (v: number | undefined | null) => v == null ? '—' : `${fmtNumber(convertSpeed(v))} ${speedUnit}`,
    speedVal: convertSpeed,
    speedUnit,

    temp: (v: number | undefined | null) => v == null ? '—' : `${fmtNumber(convertTemp(v))}${tempUnit}`,
    tempVal: convertTemp,
    tempUnit,

    efficiency: (v: number | undefined | null) => v == null ? '—' : `${fmtNumber(convertEfficiency(v))} ${efficiencyUnit}`,
    efficiencyVal: convertEfficiency,
    efficiencyUnit,

    pressure: (v: number | undefined | null) => v == null ? '—' : `${fmtNumber(convertPressure(v))} ${pressureUnit}`,
    pressureVal: convertPressure,
    pressureUnit,

    isMetric,
    isCelsius,
  }), [convertDistance, convertSpeed, convertTemp, convertEfficiency, convertPressure,
       distanceUnit, speedUnit, tempUnit, efficiencyUnit, pressureUnit, isMetric, isCelsius])
}
