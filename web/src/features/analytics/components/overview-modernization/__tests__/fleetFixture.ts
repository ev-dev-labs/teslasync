import type { FleetAnalytics, StatsSummary } from '@/api/types';

export function fleetFixture(): FleetAnalytics {
  const stats: StatsSummary = { min: 1, max: 4, avg: 2, median: 2, p95: 4, count: 3 };
  return {
    period_days: 30,
    total_vehicles: 2,
    total_distance_km: 1234.567,
    total_drives: 42,
    total_charging_sessions: 7,
    total_energy_kwh: 100.25,
    total_cost: 25.5,
    avg_efficiency_wh_km: 160.125,
    most_efficient_vehicle: { id: 1, name: 'Vehicle one', efficiency: 150 },
    vehicle_comparison: [
      { id: 1, name: 'Vehicle one', distance: 500, energy: 75, efficiency: 150, drives: 20 },
      { id: 2, name: 'Vehicle two', distance: 734.567, energy: 25.25, efficiency: 175, drives: 22 },
    ],
    drive_analytics: {
      hourly_pattern: [{ hour: 8, drives: 2, distance: 35 }],
      day_of_week: [{ day: 'Monday', drives: 2, distance: 35, avg_distance: 17.5 }],
      speed_distribution: [{ range: '20–40', count: 3 }],
      distance_distribution: [{ range: '10–20', count: 2 }],
      speed_stats: stats,
      power_stats: stats,
      regen_stats: stats,
      duration_stats: stats,
      distance_stats: stats,
      efficiency_stats: stats,
      daily_trend: [{ date: '2026-10-01', drives: 2, distance: 35, efficiency: 160 }],
      temp_vs_efficiency: [{ temp: 18, efficiency: 160, distance: 35 }],
      duration_distribution: [{ range: '10–20', count: 2 }],
      temperature: { inside: stats, outside: stats },
    },
    charging_analytics: {
      hourly_pattern: [{ hour: 9, charges: 1, energy: 25 }],
      charger_types: [{ type: 'AC', count: 3 }],
      charger_brands: [{ brand: 'Source brand', count: 3 }],
      monthly_trend: [{
        month: '2026-10', energy: 25, cost: 6, sessions: 1, avg_power: 11, gas_cost: 10, savings: 4,
      }],
      power_stats: stats,
      duration_stats: stats,
      energy_stats: stats,
      cost_stats: stats,
      start_battery_dist: [{ range: '20–40', count: 3 }],
      efficiency_stats: stats,
    },
    battery_trend: [{
      date: '2026-10-01', health_score: 95, capacity_wh: 75000,
      degradation_pct: 5, range_km: 400, cycle_count: 123,
    }],
  };
}
