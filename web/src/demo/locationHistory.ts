import type { LocationSnapshot } from '@/api/types'
import { drives } from './fixtures'

export function locationHistory(vehicleId: number): LocationSnapshot[] {
  return drives.filter(row => row.vehicle_id === vehicleId).flatMap(row => [
    {
      id: row.id * 2,
      vehicle_id: vehicleId,
      latitude: row.start_lat,
      longitude: row.start_lon,
      speed_mph: row.avg_speed_mps,
      created_at: row.start_ts,
    },
    {
      id: row.id * 2 + 1,
      vehicle_id: vehicleId,
      latitude: row.end_lat,
      longitude: row.end_lon,
      speed_mph: 0,
      created_at: row.end_ts,
    },
  ]).sort((a, b) => b.created_at.localeCompare(a.created_at))
}
