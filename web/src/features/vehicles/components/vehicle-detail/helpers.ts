import type { VehicleState } from '@/api/types'
import { fmtInt } from '@/lib/numberFormat'
export { deriveVehicleStatus as deriveStatus, statusVariant } from '@/api/types'

export interface StateResponse {
  state: VehicleState
  live: boolean
}

export function batteryColor(level: number): string {
  if (level > 60) return '#10b981'
  if (level > 25) return '#f59e0b'
  return '#ef4444'
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
