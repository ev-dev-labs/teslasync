import type { Vehicle } from '@/types/vehicle'
import type { BatteryHealthAnalytics } from '@/types/energy'

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
    end_lat: 37.5, end_lon: -122.2,
    start_soc_pct: 78, end_soc_pct: 68,
    energy_used_wh: energy, regen_energy_wh: Math.round(energy * 0.12),
    avg_speed_mps: 14.5, max_speed_mps: 25,
    avg_power_w: 8_900, outside_temp_avg_c: 20,
    inside_temp_avg_c: 21, score: 85 + index % 10,
    ended_status: 'completed', created_at: start, updated_at: start,
  }
})

export const charging = Array.from({ length: 6 }, (_, index) => {
  const started = daysAgo(index * 3 + 1, 21)
  return {
    id: 201 + index,
    vehicle_id: index % 3 === 0 ? 8 : 7,
    started_at: started,
    start_ts: started,
    ended_at: new Date(Date.parse(started) + 10_800_000).toISOString(),
    start_soc_pct: 26 + index % 5, end_soc_pct: 80,
    delta_soc_pct: 54 - index % 5,
    start_odometer_m: 32_100_000 + index * 60_000,
    end_odometer_m: 32_100_000 + index * 60_000,
    total_energy_added_wh: 39_000 + index * 1_100,
    peak_power_w: 11_200, avg_power_w: 9_800,
    cost_decimal: Number((6.5 + index * 0.5).toFixed(2)),
    cost_currency: 'USD', charger_type: 'AC', cable_type: 'Type 2',
    start_place: 'Sample Home Charger', live: false,
  }
})

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
