import type { FleetAnalytics, StatsSummary } from '@/api/types'
import { batteryHealth, charging, drives, vehicles } from './fixtures'

type Drive = (typeof drives)[number]
type Charge = (typeof charging)[number]

const round = (value: number, places = 1) => Number(value.toFixed(places))
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0)

function stats(values: number[]): StatsSummary {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return { min: 0, max: 0, avg: 0, median: 0, p95: 0, count: 0 }
  return {
    min: round(sorted[0]), max: round(sorted[sorted.length - 1]),
    avg: round(total(sorted) / sorted.length),
    median: round(sorted[Math.floor(sorted.length / 2)]),
    p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
    count: sorted.length,
  }
}

function buckets(values: number[], bounds: number[], labels: string[]) {
  return labels.map((range, index) => ({
    range,
    count: values.filter(value => value >= bounds[index] && value < bounds[index + 1]).length,
  }))
}

function dailyDrives(rows: Drive[]) {
  const byDay = new Map<string, { date: string; drives: number; distance: number }>()
  for (const row of rows) {
    const date = row.start_ts.slice(0, 10)
    const day = byDay.get(date) ?? { date, drives: 0, distance: 0 }
    day.drives++
    day.distance += row.distance_m / 1000
    byDay.set(date, day)
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map(day => ({ ...day, distance: round(day.distance) }))
}

function monthlyCharging(rows: Charge[]) {
  const byMonth = new Map<string, Charge[]>()
  for (const row of rows) {
    const month = row.started_at.slice(0, 7)
    byMonth.set(month, [...(byMonth.get(month) ?? []), row])
  }
  return [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, sessions]) => {
    const energy = total(sessions.map(row => row.total_energy_added_wh)) / 1000
    const cost = total(sessions.map(row => row.cost_decimal))
    const gasCost = energy * 0.14 * 8.5
    return {
      month, energy: round(energy, 2), cost: round(cost, 2), sessions: sessions.length,
      avg_power: round(total(sessions.map(row => row.peak_power_w)) / sessions.length / 1000),
      gas_cost: round(gasCost, 2), savings: round(gasCost - cost, 2),
    }
  })
}

export function fleetAnalytics(start?: string, end?: string, days?: number): FleetAnalytics {
  const cutoff = start ? Date.parse(start) : days ? Date.now() - days * 86_400_000 : -Infinity
  const until = end ? Date.parse(end) : Infinity
  const driveRows = drives.filter(row => {
    const timestamp = Date.parse(row.start_ts)
    return timestamp >= cutoff && timestamp <= until
  })
  const chargeRows = charging.filter(row => {
    const timestamp = Date.parse(row.started_at)
    return timestamp >= cutoff && timestamp <= until
  })
  const comparisons = vehicles.map(vehicle => {
    const vehicleDrives = driveRows.filter(row => row.vehicle_id === vehicle.id)
    const vehicleCharges = chargeRows.filter(row => row.vehicle_id === vehicle.id)
    const distance = total(vehicleDrives.map(row => row.distance_m)) / 1000
    const energy = total(vehicleCharges.map(row => row.total_energy_added_wh)) / 1000
    return {
      id: vehicle.id, name: vehicle.display_name, distance, energy,
      efficiency: distance ? energy * 1000 / distance : 0, drives: vehicleDrives.length,
    }

  })
  const best = comparisons.filter(row => row.efficiency > 0)
    .sort((a, b) => a.efficiency - b.efficiency)[0]
  const totalDistance = total(driveRows.map(row => row.distance_m)) / 1000
  const totalEnergy = total(chargeRows.map(row => row.total_energy_added_wh)) / 1000
  const speeds = driveRows.map(row => row.max_speed_mps * 3.6)
  const distances = driveRows.map(row => row.distance_m / 1000)
  const efficiencies = driveRows.map(row => row.energy_used_wh / (row.distance_m / 1000))
  const hourlyDriving = Array.from({ length: 24 }, (_, hour) => {
    const matches = driveRows.filter(row => new Date(row.start_ts).getUTCHours() === hour)
    return { hour, drives: matches.length, distance: round(total(matches.map(row => row.distance_m)) / 1000) }
  })
  const hourlyCharging = Array.from({ length: 24 }, (_, hour) => {
    const matches = chargeRows.filter(row => new Date(row.started_at).getUTCHours() === hour)
    return { hour, charges: matches.length, energy: round(total(matches.map(row => row.total_energy_added_wh)) / 1000) }
  })
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const chargeTypes = [...new Set(chargeRows.map(row => row.charger_type))]

  return {
    period_days: days ?? (start ? Math.max(0, Math.ceil(((end ? Date.parse(end) : Date.now()) - cutoff) / 86_400_000)) : 0),
    total_vehicles: vehicles.length,
    total_distance_km: round(totalDistance),
    total_drives: driveRows.length,
    total_charging_sessions: chargeRows.length,
    total_energy_kwh: round(totalEnergy, 2),
    total_cost: round(total(chargeRows.map(row => row.cost_decimal)), 2),
    avg_efficiency_wh_km: totalDistance ? round(totalEnergy * 1000 / totalDistance) : 0,
    most_efficient_vehicle: best ? { id: best.id, name: best.name, efficiency: best.efficiency } : null,
    vehicle_comparison: comparisons,
    drive_analytics: {
      hourly_pattern: hourlyDriving,
      day_of_week: dayNames.map((day, index) => {
        const matches = driveRows.filter(row => new Date(row.start_ts).getUTCDay() === index)
        const distance = total(matches.map(row => row.distance_m)) / 1000
        return { day, drives: matches.length, distance: round(distance), avg_distance: matches.length ? round(distance / matches.length) : 0 }
      }),
      speed_distribution: buckets(speeds, [0, 30, 60, 90, 120, 150, Infinity], ['0-30', '30-60', '60-90', '90-120', '120-150', '150+']),
      distance_distribution: buckets(distances, [0, 5, 15, 30, 50, 100, 200, Infinity], ['0-5', '5-15', '15-30', '30-50', '50-100', '100-200', '200+']),
      speed_stats: stats(speeds),
      power_stats: stats(driveRows.map(row => row.avg_power_w / 1000)),
      regen_stats: stats(driveRows.map(row => row.regen_energy_wh / 1000)),
      duration_stats: stats(driveRows.map(row => row.duration_s / 60)),
      distance_stats: stats(distances),
      efficiency_stats: stats(efficiencies),
      daily_trend: dailyDrives(driveRows),
      temp_vs_efficiency: driveRows.map(row => ({
        temp: row.outside_temp_avg_c,
        efficiency: round(row.energy_used_wh / (row.distance_m / 1000)),
        distance: round(row.distance_m / 1000),
      })),
      temperature: {
        inside: stats(driveRows.map(row => row.inside_temp_avg_c)),
        outside: stats(driveRows.map(row => row.outside_temp_avg_c)),
      },
    },
    charging_analytics: {
      hourly_pattern: hourlyCharging,
      charger_types: chargeTypes.map(type => ({
        type, count: chargeRows.filter(row => row.charger_type === type).length,
      })),
      charger_brands: [],
      monthly_trend: monthlyCharging(chargeRows),
      power_stats: stats(chargeRows.map(row => row.peak_power_w / 1000)),
      duration_stats: stats(chargeRows.map(row => (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 60_000)),
      energy_stats: stats(chargeRows.map(row => row.total_energy_added_wh / 1000)),
      cost_stats: stats(chargeRows.map(row => row.cost_decimal)),
      start_battery_dist: buckets(chargeRows.map(row => row.start_soc_pct),
        [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101],
        ['0-10%', '10-20%', '20-30%', '30-40%', '40-50%', '50-60%', '60-70%', '70-80%', '80-90%', '90-100%']),
      efficiency_stats: stats(chargeRows.map(row => row.total_energy_added_wh / ((Date.parse(row.ended_at) - Date.parse(row.started_at)) / 3_600_000))),
    },
    battery_trend: vehicles.flatMap(vehicle => batteryHealth(vehicle.id).history
      .filter(point => Date.parse(point.date) >= cutoff && Date.parse(point.date) <= until)
      .map(point => ({
        date: point.date, health_score: point.soh_pct, capacity_wh: point.capacity_wh,
        degradation_pct: round(100 - point.soh_pct, 2), range_km: point.range_m / 1000,
        cycle_count: batteryHealth(vehicle.id).total_cycles,
      }))).sort((a, b) => a.date.localeCompare(b.date)),
  }
}

export function periodStats(vehicleId: number, days = 0) {
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : -Infinity
  const driveRows = drives.filter(row =>
    row.vehicle_id === vehicleId && Date.parse(row.start_ts) >= cutoff)
  const chargeRows = charging.filter(row =>
    row.vehicle_id === vehicleId && Date.parse(row.started_at) >= cutoff)
  const totalDistanceKm = total(driveRows.map(row => row.distance_m)) / 1000
  const energyWh = total(chargeRows.map(row => row.total_energy_added_wh))
  return {
    total_distance: round(totalDistanceKm, 2),
    total_drives: driveRows.length,
    energy_used: round(energyWh / 1000, 2),
    avg_efficiency: totalDistanceKm ? round(energyWh / totalDistanceKm, 2) : 0,
    total_cost: round(total(chargeRows.map(row => row.cost_decimal)), 2),
    co2_saved: round(totalDistanceKm * 0.120, 2),
  }
}
