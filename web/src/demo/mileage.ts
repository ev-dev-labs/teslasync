import type {
  DailyMileageResponse, MileageStats, MonthlyMileageResponse,
} from '@/types/analytics'
import { drives } from './fixtures'

const distanceKm = (rows: typeof drives) =>
  rows.reduce((sum, row) => sum + row.distance_m, 0) / 1000

const recent = (vehicleId: number, days: number) =>
  drives.filter(row =>
    row.vehicle_id === vehicleId
    && Date.parse(row.start_ts) >= Date.now() - days * 86_400_000)

export function mileageStats(vehicleId: number): MileageStats {
  const rows = drives.filter(row => row.vehicle_id === vehicleId)
    .sort((a, b) => a.start_ts.localeCompare(b.start_ts))
  const last30 = recent(vehicleId, 30)
  return {
    vehicle_id: vehicleId,
    lifetime_km: distanceKm(rows),
    last_7d_km: distanceKm(recent(vehicleId, 7)),
    last_30d_km: distanceKm(last30),
    last_365d_km: distanceKm(recent(vehicleId, 365)),
    drive_count_lifetime: rows.length,
    drive_count_30d: last30.length,
    first_drive_at: rows[0]?.start_ts ?? null,
    last_drive_at: rows[rows.length - 1]?.start_ts ?? null,
  }
}

export function mileageMonthly(vehicleId: number, months: number): MonthlyMileageResponse {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCMonth(start.getUTCMonth() - months + 1)
  const grouped = new Map<string, typeof drives>()
  for (const row of drives) {
    if (row.vehicle_id !== vehicleId || Date.parse(row.start_ts) < start.getTime()) continue
    const month = row.start_ts.slice(0, 7)
    grouped.set(month, [...(grouped.get(month) ?? []), row])
  }
  return {
    vehicle_id: vehicleId,
    months: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([year_month, rows]) => {
      const totalWh = rows.reduce((sum, row) => sum + row.energy_used_wh, 0)
      const km = distanceKm(rows)
      return {
        year_month, drive_count: rows.length, total_km: km,
        total_wh_consumed: totalWh,
        avg_efficiency_wh_per_km: km > 0 ? totalWh / km : null,
      }
    }),
  }
}

export function mileageDaily(vehicleId: number, days: number): DailyMileageResponse {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - days + 1)
  const grouped = new Map<string, typeof drives>()
  for (const row of drives) {
    if (row.vehicle_id !== vehicleId || Date.parse(row.start_ts) < start.getTime()) continue
    const date = row.start_ts.slice(0, 10)
    grouped.set(date, [...(grouped.get(date) ?? []), row])
  }

  return {
    vehicle_id: vehicleId,
    days: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({
      date, drive_count: rows.length, total_km: distanceKm(rows),
      end_odometer_km: Math.max(...rows.map(row => row.end_odometer_m)) / 1000,
    })),
  }
}

export function drivingStats(vehicleId: number) {
  const rows = drives.filter(row => row.vehicle_id === vehicleId)
  const totalDistanceKm = distanceKm(rows)
  const totalEnergyWh = rows.reduce((sum, row) => sum + row.energy_used_wh, 0)
  const regenEnergyWh = rows.reduce((sum, row) => sum + row.regen_energy_wh, 0)
  return {
    total_drives: rows.length,
    total_distance_km: totalDistanceKm,
    total_duration_s: rows.reduce((sum, row) => sum + row.duration_s, 0),
    avg_efficiency_wh_km: totalDistanceKm ? totalEnergyWh / totalDistanceKm : 0,
    avg_speed_kmh: rows.length
      ? rows.reduce((sum, row) => sum + row.distance_m / row.duration_s, 0) / rows.length * 3.6 : 0,
    top_speed_kmh: rows.length ? Math.max(...rows.map(row => row.max_speed_mps)) * 3.6 : 0,
    regen_ratio: totalEnergyWh ? regenEnergyWh / totalEnergyWh : 0,
    regen_energy_wh: regenEnergyWh,
    co2_saved_kg: totalDistanceKm * 0.07,
  }
}
