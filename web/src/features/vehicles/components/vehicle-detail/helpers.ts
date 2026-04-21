import type { Vehicle, VehicleState, VehicleStatus } from '@/api/types'
import { fmtInt } from '@/lib/numberFormat'

export interface StateResponse {
  state: VehicleState
  live: boolean
}

export function deriveStatus(v: Vehicle, s?: VehicleState | null): VehicleStatus {
  if (s?.is_charging) return 'charging'
  if (s?.speed && s.speed > 0) return 'driving'
  if (v.state === 'online') return 'online'
  if (v.state === 'asleep') return 'asleep'
  return 'offline'
}

export function batteryColor(level: number): string {
  if (level > 60) return '#10b981'
  if (level > 25) return '#f59e0b'
  return '#ef4444'
}

export function statusVariant(status: VehicleStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'online':
    case 'driving':
      return 'success'
    case 'charging':
      return 'warning'
    case 'asleep':
      return 'info'
    default:
      return 'danger'
  }
}

export function tirePressureVariant(psi: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (psi == null) return 'neutral'
  if (psi >= 2.5 && psi <= 3.5) return 'success'
  if (psi >= 2.0 && psi < 2.5) return 'warning'
  return 'danger'
}

export function durationStr(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = fmtInt(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
