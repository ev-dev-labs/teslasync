import type { Geofence, Vehicle } from '@/api/types'
import { toZonedDatetimeStr, zonedWallTimeToUtc } from '@/lib/dateConvert'

export type SharedChargerVehicleChoice = Pick<Vehicle, 'id' | 'display_name'>
export type SharedChargerPlaceChoice = Pick<Geofence, 'id' | 'name' | 'updated_at'>

export function sharedChargerWallTime(wall: string, tz: string): Date | null {
  const instant = zonedWallTimeToUtc(wall, tz)
  return instant && Number.isFinite(instant.getTime()) && toZonedDatetimeStr(instant, tz) === wall
    ? instant : null
}
