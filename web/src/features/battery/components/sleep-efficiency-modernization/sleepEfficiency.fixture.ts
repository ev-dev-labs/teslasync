import type { SleepEfficiencyData } from '@/types/energy';

/** Authored runtime fixture, NOT a production source or a replacement calculation. */
export function sleepEfficiencyFixture(): SleepEfficiencyData {
  return {
    vehicle_id: 1,
    period_days: 3,
    state_distribution: [
      { state: 'asleep', count: 8, total_minutes: 0 },
      { state: 'online', count: 2, total_minutes: 0 },
      { state: 'mystery', count: 1, total_minutes: 0 },
    ],
    sleep_efficiency_pct: 0,
    time_to_sleep_avg_min: 0,
    sentry_comparison: [],
    sentry_on_drain_rate: 0,
    sentry_off_drain_rate: 0,
    sentry_monthly_kwh: 0,
    sentry_monthly_cost: 0,
    sentry_extra_drain_rate: 0,
    sentry_extra_monthly_kwh: 0,
    sentry_extra_monthly_cost: 0,
    battery_capacity_wh: 75_000,
    capacity_source: 'default',
    base_cost_per_kwh: 0.12,
    recent_events: [{
      id: 10,
      start_date: '2026-08-06T01:00:00Z',
      end_date: '2026-08-06T05:00:00Z',
      duration_hours: 4,
      battery_lost: 2,
      drain_rate: 0.5,
      sentry_mode: false,
      outside_temp: 20,
      start_battery: 80,
      end_battery: 78,
    }],
    total_events: 1,
    avg_sentry_duration_hours: 0,
  };
}

export const sleepSectionIds = [
  'kpi-evidence', 'transition-distribution', 'transition-composition',
  'dwell-distribution', 'diagnostics', 'transition-diversity', 'sentry-comparison',
  'state-directory', 'sentry-projection', 'event-profile', 'event-directory',
  'availability-matrix', 'range-source-coverage', 'methodology',
].map(suffix => `sleep-efficiency-${suffix}`);
