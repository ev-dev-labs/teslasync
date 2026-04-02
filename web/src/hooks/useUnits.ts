import { useMemo } from 'react'
import { useSettings } from './useSettings'

export function useUnits() {
  const { settings } = useSettings()

  const isMetric = settings?.unit_of_length !== 'mi'
  const isCelsius = settings?.unit_of_temp !== 'F'

  return useMemo(() => ({
    distance: (km: number | undefined | null) => {
      if (km == null) return '—'
      return isMetric ? `${km.toFixed(1)} km` : `${(km * 0.621371).toFixed(1)} mi`
    },
    distanceVal: (km: number) => isMetric ? km : km * 0.621371,
    distanceUnit: isMetric ? 'km' : 'mi',

    speed: (kmh: number | undefined | null) => {
      if (kmh == null) return '—'
      return isMetric ? `${kmh.toFixed(0)} km/h` : `${(kmh * 0.621371).toFixed(0)} mph`
    },
    speedVal: (kmh: number) => isMetric ? kmh : kmh * 0.621371,
    speedUnit: isMetric ? 'km/h' : 'mph',

    temp: (celsius: number | undefined | null) => {
      if (celsius == null) return '—'
      return isCelsius ? `${celsius.toFixed(1)}°C` : `${(celsius * 9 / 5 + 32).toFixed(1)}°F`
    },
    tempVal: (celsius: number) => isCelsius ? celsius : celsius * 9 / 5 + 32,
    tempUnit: isCelsius ? '°C' : '°F',

    efficiency: (whPerKm: number | undefined | null) => {
      if (whPerKm == null) return '—'
      return isMetric ? `${whPerKm.toFixed(0)} Wh/km` : `${(whPerKm * 1.60934).toFixed(0)} Wh/mi`
    },
    efficiencyVal: (whPerKm: number) => isMetric ? whPerKm : whPerKm * 1.60934,
    efficiencyUnit: isMetric ? 'Wh/km' : 'Wh/mi',

    pressure: (bar: number | undefined | null) => {
      if (bar == null) return '—'
      return isMetric ? `${bar.toFixed(2)} bar` : `${(bar * 14.5038).toFixed(1)} psi`
    },
    pressureVal: (bar: number) => isMetric ? bar : bar * 14.5038,
    pressureUnit: isMetric ? 'bar' : 'psi',

    isMetric,
    isCelsius,
  }), [isMetric, isCelsius])
}
