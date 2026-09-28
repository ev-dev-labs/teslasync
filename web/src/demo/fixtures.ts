import type { Vehicle } from '@/types/vehicle'
import type {
  BatteryHealthAnalytics, EnergyStats, VampireDrainEvent,
  VampireDrainStats, VampireDrainWatch,
} from '@/types/energy'
import type { Alert, NotificationLog } from '@/api/types'
import type { RuntimeStatusSnapshot } from '@/types/admin'
import type { RepairCaseStats } from '@/api/hooks/useRepairCaseStats'
import type { FleetWorkOrder } from '@/api/hooks/useFleetOps'
import type { ChartAnnotationRow } from '@/types/annotations'
import type { ChargingOptimizerData } from '@/types/charging'

const now = new Date()
const daysAgo = (days: number, hour = 12) => {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(hour, 0, 0, 0)
  return date.toISOString()
}

export const vehicles: Vehicle[] = [
  {
    id: 7, vehicle_id: 7, vin: '5YJMOCK0000000001', display_name: 'Aurora',
    model: 'Model Y', trim_badging: 'Long Range', exterior_color: 'Pearl White',
    wheel_type: 'Gemini', state: 'online', healthy: true, timezone: 'UTC',
    created_at: daysAgo(365), updated_at: daysAgo(0),
  },
  {
    id: 8, vehicle_id: 8, vin: '5YJMOCK0000000002', display_name: 'Comet',
    model: 'Model 3', trim_badging: 'Long Range', exterior_color: 'Deep Blue',
    wheel_type: 'Aero', state: 'asleep', healthy: true, timezone: 'UTC',
    created_at: daysAgo(280), updated_at: daysAgo(1),
  },
]

export const currentOdometerM = 32_100_000

export const drives = Array.from({ length: 14 }, (_, index) => {
  const start = daysAgo(index + 1, 8 + index % 5)
  const distance = 12_000 + (index % 5) * 4_200
  const energy = Math.round(distance * (0.15 + index % 3 * 0.008))
  return {
    id: 101 + index,
    vehicle_id: index % 4 === 0 ? 8 : 7,
    start_ts: start,
    end_ts: new Date(Date.parse(start) + 1_800_000).toISOString(),
    duration_s: 1_800,
    distance_m: distance,
    start_address: 'Sample North Campus',
    end_address: 'Sample City Center',
    start_lat: 37.4, start_lon: -122.1,
    end_lat: 37.45, end_lon: -122.15,
    start_soc_pct: 78, end_soc_pct: Number((78 - energy / 780).toFixed(1)),
    energy_used_wh: energy, regen_energy_wh: Math.round(energy * 0.12),
    avg_speed_mps: distance / 1_800, max_speed_mps: 25,
    avg_power_w: energy * 2, outside_temp_avg_c: 20,
    inside_temp_avg_c: 21, score: 85 + index % 10,
    ended_status: 'completed', created_at: start, updated_at: start,
  }
}).map((row, index, rows) => {
  const newerDistance = rows.slice(0, index)
    .filter(other => other.vehicle_id === row.vehicle_id)
    .reduce((sum, other) => sum + other.distance_m, 0)
  const endOdometer = currentOdometerM - newerDistance
  return {
    ...row, start_odometer_m: endOdometer - row.distance_m,
    end_odometer_m: endOdometer,
  }
})

export const charging = Array.from({ length: 6 }, (_, index) => {
  const started = daysAgo(index * 3 + 1, 21)
  const energyAddedWh = 39_000 + index * 1_100
  const vehicleId = index % 3 === 0 ? 8 : 7
  const newerDistance = drives.filter(row =>
    row.vehicle_id === vehicleId && Date.parse(row.start_ts) > Date.parse(started))
    .reduce((sum, row) => sum + row.distance_m, 0)
  const odometer = currentOdometerM - newerDistance
  return {
    id: 201 + index,
    vehicle_id: vehicleId,
    started_at: started,
    start_ts: started,
    ended_at: new Date(Date.parse(started) + 14_400_000).toISOString(),
    start_soc_pct: 26 + index % 5, end_soc_pct: 80,
    delta_soc_pct: 54 - index % 5,
    start_odometer_m: odometer,
    end_odometer_m: odometer,
    total_energy_added_wh: energyAddedWh,
    peak_power_w: 11_200, avg_power_w: energyAddedWh / 4,
    cost_decimal: Number((6.5 + index * 0.5).toFixed(2)),
    cost_currency: 'USD', charger_type: 'AC', cable_type: 'Type 2',
    start_place: 'Sample Home Charger', live: false,
  }
})

export const alerts: Alert[] = [{
  id: 301,
  vehicle_id: 7,
  type: 'charging_complete',
  severity: 'info',
  title: 'Sample home charging complete',
  message: 'Aurora finished a fictional home charging session.',
  is_read: false,
  created_at: charging[1].ended_at,
}]

export const notificationLogs: NotificationLog[] = [{
  id: 401,
  channel_id: null,
  alert_id: alerts[0].id,
  title: alerts[0].title,
  message: alerts[0].message,
  severity: alerts[0].severity,
  event_type: alerts[0].type,
  status: 'triggered',
  error: '',
  created_at: alerts[0].created_at,
  sent_at: null,
  read_at: null,
  archived_at: null,
}]

export const workOrders: FleetWorkOrder[] = [{
  id: 501, vehicle_id: 8, vehicle_display_name: vehicles[1].display_name,
  cost_center_id: null, cost_center_name: null,
  title: 'Sample tire rotation', description: 'Fictional scheduled tire inspection.',
  status: 'scheduled', severity: 'low',
  due_odometer_m: null, due_at: daysAgo(-14),
  scheduled_start_at: daysAgo(-14, 10), scheduled_end_at: daysAgo(-14, 11),
  cost_minor: 7500, currency: 'USD', version: 1,
  created_at: daysAgo(2), updated_at: daysAgo(2),
}]

export const annotations: ChartAnnotationRow[] = [{
  id: 601, vehicle_id: 7, occurred_at: charging[1].ended_at,
  category: 'milestone', title: 'Sample home charge',
  description: 'A fictional charge event in the demo history.',
  scope: ['energy', 'charging'], color: null,
  created_at: charging[1].ended_at, updated_at: charging[1].ended_at,
}]

export function chargingOptimizer(vehicleId: number): ChargingOptimizerData {
  const sessions = charging.filter(row => row.vehicle_id === vehicleId)
  const cost = sessions.reduce((sum, row) => sum + row.cost_decimal, 0)
  const energyWh = sessions.reduce((sum, row) => sum + row.total_energy_added_wh, 0)
  return {
    current_schedule: {
      most_common_start_hour: 21,
      most_common_day: new Date(sessions[0].started_at).toLocaleDateString('en-US', {
        weekday: 'long', timeZone: 'UTC',
      }),
      avg_sessions_per_week: sessions.length / 3,
      home_charging_pct: 100,
      avg_charge_to_pct: sessions.reduce((sum, row) => sum + row.end_soc_pct, 0) / sessions.length,
    },
    cost_analysis: {
      peak_hours: [16, 17, 18, 19, 20], offpeak_hours: [21, 22, 23, 0, 1, 2, 3, 4, 5],
      peak_cost_per_kwh: 0.32,
      offpeak_cost_per_kwh: energyWh > 0 ? cost / (energyWh / 1000) : 0,
      sessions_during_peak_pct: 0, potential_monthly_savings: 0,
    },
    battery_health_score: batteryHealth(vehicleId).current_soh,
    recommendations: [{
      type: 'schedule', priority: 'low', title: 'Sample off-peak schedule',
      detail: 'Fictional sessions already start after the sample peak window.',
      estimated_savings: 0,
    }],
    weekly_heatmap: sessions.map(row => ({
      day: new Date(row.started_at).getUTCDay(),
      hour: new Date(row.started_at).getUTCHours(),
      sessions: 1,
      avg_cost_per_kwh: row.cost_decimal / (row.total_energy_added_wh / 1000),
    })),
  }
}

export const repairCaseStats: RepairCaseStats = {
  total: 0, open: 0, in_review: 0, applied: 0, dismissed: 0,
  quarantined: 0, restored: 0, resolved: 0, drive: 0, charging: 0,
  oldest_open_at: null, last_scan_at: null,
}

export function runtimeStatus(): RuntimeStatusSnapshot {
  const generatedAt = new Date().toISOString()
  return {
    status: 'operational', generated_at: generatedAt,
    components: [{
      name: 'Synthetic fixture viewer', status: 'healthy',
      consecutive_failures: 0, last_check_at: generatedAt,
    }],
    counts: {
      components_total: 1, components_healthy: 1,
      components_degraded: 0, components_unhealthy: 0,
    },
  }
}

export function energyStats(vehicleId: number, days: number): EnergyStats {
  const cutoff = Date.now() - days * 86_400_000
  const vehicleDrives = drives.filter(row => row.vehicle_id === vehicleId && Date.parse(row.start_ts) >= cutoff)
  const sessions = charging.filter(row => row.vehicle_id === vehicleId && Date.parse(row.started_at) >= cutoff)
  const dates = new Map<string, { energy_wh: number; cost: number; distance_m: number }>()
  for (const row of vehicleDrives) {
    const date = row.start_ts.slice(0, 10)
    const entry = dates.get(date) ?? { energy_wh: 0, cost: 0, distance_m: 0 }
    entry.energy_wh += row.energy_used_wh
    entry.distance_m += row.distance_m
    dates.set(date, entry)
  }
  for (const row of sessions) {
    const date = row.started_at.slice(0, 10)
    const entry = dates.get(date) ?? { energy_wh: 0, cost: 0, distance_m: 0 }
    entry.cost += row.cost_decimal
    dates.set(date, entry)
  }
  const totalEnergyWh = vehicleDrives.reduce((sum, row) => sum + row.energy_used_wh, 0)
  const totalDistanceM = vehicleDrives.reduce((sum, row) => sum + row.distance_m, 0)
  return {
    vehicle_id: vehicleId, period_days: days,
    total_energy_used_wh: totalEnergyWh,
    total_energy_charged_wh: sessions.reduce((sum, row) => sum + row.total_energy_added_wh, 0),
    total_wh: totalEnergyWh,
    total_cost: sessions.reduce((sum, row) => sum + row.cost_decimal, 0),
    total_distance_m: totalDistanceM,
    avg_efficiency_wh_per_m: totalDistanceM ? totalEnergyWh / totalDistanceM : 0,
    co2_saved_kg: totalEnergyWh / 1000 * 0.4,
    daily_breakdown: [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({
      date, ...row, efficiency_wh_per_m: row.distance_m ? row.energy_wh / row.distance_m : 0,
    })),
  }
}

export const vampireEvents: VampireDrainEvent[] = [
  {
    started_at: daysAgo(4, 20), ended_at: daysAgo(3, 8),
    duration_hours: 12, start_battery_pct: 73, end_battery_pct: 72,
    drain_pct: 1, drain_pct_per_day: 2,
    ambient_temp_c_avg: 17,
  },
]

export const vampireStats: VampireDrainStats = {
  event_count: vampireEvents.length, total_observed_hours: 12,
  avg_drain_pct_per_day: 2, median_drain_pct_per_day: 2,
  p95_drain_pct_per_day: 2, sample_window_days: 30,
}

export const vampireWatch: VampireDrainWatch = {
  status: 'ok', threshold_pct_per_day: 3, avg_drain_pct_per_day: 2,
  events_evaluated: vampireEvents.length, breach_streak: 0,
  breaches_last_7_days: 0, worst_event: vampireEvents[0],
  recommendation: 'Sample parked-drain rate is below the alert threshold.',
}

export const settings = {
  unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
  preferred_range: 'rated', language: 'en', base_cost_per_kwh: 0.16,
  api_suspended: false, theme: 'neon-cyan', mode: 'dark',
  custom_primary: '#00b4d8', custom_accent: '#e63946',
  gas_price_per_unit: 0, gas_unit: 'gallon', gas_efficiency_mpg: 25,
  decimal_precision: 2, quiet_hours_enabled: false,
  quiet_hours_start: '22:00', quiet_hours_end: '07:00',
  alert_digest_mode: 'instant', currency_symbol: '$',
  locale: 'en-US', tz_display_default: 'vehicle', timezone_user: 'UTC',
  tab_badge_enabled: true, critical_flash_enabled: false,
  ui_density: 'comfortable', time_format_default: 'absolute',
  chart_palette: 'cb_safe', ai_mode: 'off', ai_features: {},
  ai_provider_config: {}, ai_cost_cap_cents: 0,
  font_family: 'system', font_mono: 'system', font_custom_sans: '',
  font_custom_mono: '', font_scale: 1, font_leading: 1.5,
  font_tracking: '0em', font_heading_weight: 700,
}

export function batteryHealth(vehicleId: number): BatteryHealthAnalytics {
  const startSoh = vehicleId === 7 ? 96.8 : 95.9
  const originalCapacityWh = vehicleId === 7 ? 78_000 : 75_000
  const history = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now)
    date.setUTCMonth(date.getUTCMonth() - (11 - index))
    const soh = Number((startSoh - index * 0.14).toFixed(2))
    return {
      date: date.toISOString().slice(0, 10),
      odometer_m: 19_000_000 + index * 1_200_000,
      soh_pct: soh,
      capacity_wh: Math.round(originalCapacityWh * soh / 100),
      range_m: Math.round(440_000 * soh / 100),
    }
  })
  const currentSoh = history[history.length - 1].soh_pct
  const slopePerYear = -1.68
  const projections = Array.from({ length: 24 }, (_, index) => {
    const date = new Date(now)
    date.setUTCMonth(date.getUTCMonth() + index + 1)
    const health = Number((currentSoh + slopePerYear * (index + 1) / 12).toFixed(2))
    return {
      date: date.toISOString().slice(0, 10),
      health_pct: health,
      confidence_low: health - 0.8, confidence_high: health + 0.8,
    }
  })
  const yearsTo80 = (currentSoh - 80) / -slopePerYear
  const projectedDate = new Date(now)
  projectedDate.setUTCMonth(projectedDate.getUTCMonth() + Math.round(yearsTo80 * 12))
  return {
    vehicle_id: vehicleId,
    current_soh: currentSoh,
    estimated_capacity_wh: history[history.length - 1].capacity_wh,
    original_capacity_wh: originalCapacityWh,
    degradation_rate_pct_per_year: -slopePerYear,
    battery_age_months: 24,
    total_cycles: vehicleId === 7 ? 148 : 121,
    avg_depth_of_discharge_pct: 36,
    fast_charge_pct: 12,
    full_charge_pct: 4,
    charge_habits_score: 88,
    stress_level: 'Low',
    temp_exposure_score: 91,
    temp_exposure_reason: 'Sample data: temperate climate',
    history,
    prediction: {
      has_enough_data: true, slope_per_year: slopePerYear,
      years_to_80_pct: yearsTo80,
      predicted_date: projectedDate.toISOString().slice(0, 10),
      projection_points: projections.map(point => ({ month: point.date, health: point.health_pct })),
    },
    projections,
    charging_habits: {
      fast_charge_count: 1, slow_charge_count: 5, deep_discharge_count: 0,
      charge_to_full_count: 0, high_soc_count: 0,
      avg_energy_per_session: 40_000, total_count: 6,
    },
    risk_factors: [],
    recommendations: [],
    charging_analysis: {
      charge_level_distribution: [
        { min_soc_pct: 20, max_soc_pct: 39, start_count: 6, end_count: 0 },
        { min_soc_pct: 60, max_soc_pct: 79, start_count: 0, end_count: 0 },
        { min_soc_pct: 80, max_soc_pct: 99, start_count: 0, end_count: 6 },
      ],
      avg_start_soc_pct: 28, avg_end_soc_pct: 80,
      ac_session_count: 6, dc_session_count: 0, supercharger_count: 0,
      dc_fast_count: 0, deep_discharge_count: 0,
      ac_energy_wh: 240_000, dc_energy_wh: 0, total_sessions: 6,
    },
    capacity_source: 'synthetic',
  }
}
