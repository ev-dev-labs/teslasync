import type { Page } from '@playwright/test';
import type {
  BatteryCellSummary, DegradationData, ProjectedRangeData, SleepEfficiencyData,
  VampireDrainEventsResponse, VampireDrainStats, VampireDrainWatch,
} from '../src/types/energy';
import { fulfillApiFixture, type MockApiController } from './mockApi';

export const batteryReadings: Record<string, RegExp> = {
  'battery-gauge': /72/,
  'battery-radial-gauge': /72/,
  'range-estimate': /410/,
  'range-bar': /410/,
  'battery-degradation-trend': /94/,
  'energy-flow': /14\.00/,
  'projected-range': /438/,
  'battery-cells': /3\.800/,
  'battery-degradation-forecast': /94/,
  'battery-health-analytics': /94/,
  'vampire-drain': /1\.50/,
  'sleep-efficiency': /85/,
  'live-power-flow': /4\.20/,
  'backup-history': /(?:30m|30 min|30\.00)/,
};

export async function installCatalogueBatterySources(page: Page, mocks: MockApiController) {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const monthly = [95, 94.5, 94].map((health, index) => ({
    month: `2026-0${index + 7}`, avg_health: health, avg_capacity: 74.2,
    avg_range: 450 - index * 6,
  }));
  const event = {
    started_at: earlier, ended_at: now, duration_hours: 12, start_battery_pct: 73,
    end_battery_pct: 72.25, drain_pct: 0.75, drain_pct_per_day: 1.5, ambient_temp_c_avg: 18,
  };
  const fixtures: Record<string, unknown> = {
    '/vehicles/7/battery/cells': {
      total_cells: 4, avg_voltage: 3.8, min_voltage: 3.79, max_voltage: 3.81,
      voltage_spread: 0.02, avg_temperature: 28, min_temperature: 27,
      max_temperature: 29, temp_spread: 2,
      cells: [3.79, 3.8, 3.8, 3.81].map((voltage, index) => ({
        cell_id: index + 1, module: 1, voltage, temperature: 27 + index % 3,
      })),
    } satisfies BatteryCellSummary,
    '/vehicles/7/battery/projected-range': {
      current_range_km: 438, new_range_km: 466, degradation_pct: 6,
      total_cycles: 184, health_score: 94, current_capacity_pct: 94, avg_daily_km: 40,
    } satisfies ProjectedRangeData,
    '/analytics/battery-degradation': {
      current_health: 94, current_capacity: 74.2, current_cycles: 184,
      current_range: 438, current_temp: 28, stress_level: 'Low', fast_charge_ratio: 0.18,
      snapshots: [], monthly_trend: monthly,
      prediction: {
        has_enough_data: true, slope_per_year: -1.4, years_to_80_pct: 10,
        predicted_date: '2036-10-01', projection_points: [
          { month: '2026-10', health: 94 }, { month: '2027-10', health: 92.6 },
        ],
      },
      charging_habits: {
        fast_charge_count: 8, slow_charge_count: 34, deep_discharge_count: 2,
        charge_to_full_count: 4, high_soc_count: 6, avg_energy_per_session: 35_952, total_count: 42,
      },
      current_health_pct: 94, degradation_rate_pct_per_month: 0.1,
      projected_80pct_date: '2036-10-01',
      projections: [{ date: '2027-10-01', health_pct: 92.6, confidence_low: 90, confidence_high: 95 }],
      risk_factors: [{ name: 'Fast charging', score: 18, label: 'Low', detail: 'Most recorded sessions use AC.' }],
      recommendations: ['Keep daily charge below80% when practical.'],
    } satisfies DegradationData,
    '/vampire-drain': { vehicle_id: 7, events: [event] } satisfies VampireDrainEventsResponse,
    '/vampire-drain/stats': {
      event_count: 1, total_observed_hours: 12, avg_drain_pct_per_day: 1.5,
      median_drain_pct_per_day: 1.5, p95_drain_pct_per_day: 1.5, sample_window_days: 30,
    } satisfies VampireDrainStats,
    '/vampire-drain/watch': {
      status: 'ok', threshold_pct_per_day: 3, avg_drain_pct_per_day: 1.5, events_evaluated: 1,
      breach_streak: 0, breaches_last_7_days: 0, worst_event: event,
      recommendation: 'Observed drain is below the watch threshold.',
    } satisfies VampireDrainWatch,
    '/analytics/sleep': {
      vehicle_id: 7, period_days: 30, sleep_efficiency_pct: 85,
      sentry_off_drain_rate: 0.05, total_events: 1, battery_capacity_wh: 74_200,
      capacity_source: 'fleet_telemetry', state_distribution: [
        { state: 'asleep', count: 17, total_minutes: 0 },
        { state: 'online', count: 3, total_minutes: 0 },
      ],
      recent_events: [{
        id: 1, start_date: earlier, end_date: now, duration_hours: 12,
        battery_lost: 0.6, drain_rate: 0.05, sentry_mode: false, outside_temp: 18,
        start_battery: 73, end_battery: 72.4,
      }],
    } satisfies SleepEfficiencyData,
  };
  for (const [path, json] of Object.entries(fixtures)) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, mocks, { json });
    });
  }
}
