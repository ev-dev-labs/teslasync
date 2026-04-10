import { useMemo } from 'react'
import { useSettings } from './useSettings'
import { fmtNumber } from '../lib/numberFormat'

export function useUnits() {
  const { settings } = useSettings()

  const isMetric = settings?.unit_of_length !== 'mi'
  const isCelsius = settings?.unit_of_temp !== 'F'

  return useMemo(() => ({
    distance: (km: number | undefined | null) => {
      if (km == null) return '—'
      return isMetric ? `${fmtNumber(km)} km` : `${fmtNumber(km * 0.621371)} mi`
    },
    distanceVal: (km: number) => isMetric ? km : km * 0.621371,
    distanceUnit: isMetric ? 'km' : 'mi',

    speed: (kmh: number | undefined | null) => {
      if (kmh == null) return '—'
      return isMetric ? `${fmtNumber(kmh)} km/h` : `${fmtNumber(kmh * 0.621371)} mph`
    },
    speedVal: (kmh: number) => isMetric ? kmh : kmh * 0.621371,
    speedUnit: isMetric ? 'km/h' : 'mph',

    temp: (celsius: number | undefined | null) => {
      if (celsius == null) return '—'
      return isCelsius ? `${fmtNumber(celsius)}°C` : `${fmtNumber(celsius * 9 / 5 + 32)}°F`
    },
    tempVal: (celsius: number) => isCelsius ? celsius : celsius * 9 / 5 + 32,
    tempUnit: isCelsius ? '°C' : '°F',

    efficiency: (whPerKm: number | undefined | null) => {
      if (whPerKm == null) return '—'
      return isMetric ? `${fmtNumber(whPerKm)} Wh/km` : `${fmtNumber(whPerKm * 1.60934)} Wh/mi`
    },
    efficiencyVal: (whPerKm: number) => isMetric ? whPerKm : whPerKm * 1.60934,
    efficiencyUnit: isMetric ? 'Wh/km' : 'Wh/mi',

    pressure: (bar: number | undefined | null) => {
      if (bar == null) return '—'
      return isMetric ? `${fmtNumber(bar)} bar` : `${fmtNumber(bar * 14.5038)} psi`
    },
    pressureVal: (bar: number) => isMetric ? bar : bar * 14.5038,
    pressureUnit: isMetric ? 'bar' : 'psi',

    isMetric,
    isCelsius,
  }), [isMetric, isCelsius])
}
