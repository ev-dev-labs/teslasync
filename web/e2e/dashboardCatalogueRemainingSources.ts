import type { Page } from '@playwright/test';
import type {
  Alert, Automation, AutomationHistoryListResponse, NotificationLog, NotificationStats,
  YearReview, FleetAnalytics, StatsSummary,
} from '../src/api/types';
import type { LifetimeStats } from '../src/api/hooks/useAnalytics';
import type { AnomalyData } from '../src/api/hooks/useAnomalies';
import type { MonthlyMileageResponse, MileageStats, StateSummary, TimelineEvent, WeeklyDigestData } from '../src/types/analytics';
import type { FSMStats, FSMTransitionResponse } from '../src/types/fsm';
import { fulfillApiFixture, type MockApiController } from './mockApi';

export type CatalogueSources = Record<string, unknown>;

// Some legacy hook interfaces describe client aliases; the fake wire must still
// emit the snake_case keys that the real server/client transform uses.
export function catalogueWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(catalogueWire);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), catalogueWire(item),
  ]));
}

export async function installCatalogueRoutes(page: Page, mocks: MockApiController, sources: CatalogueSources) {
  for (const [path, json] of Object.entries(sources)) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, mocks, { json });
    });
  }
}

export function catalogueAnalyticsSources(now: string): CatalogueSources {
  const earlier = new Date(Date.parse(now) - 3_600_000).toISOString();
  const day = now.slice(0, 10);
  const statsValue = (value: number): StatsSummary => ({
    min: value, max: value, avg: value, median: value, p95: value, count: 1,
  });
  const fleet: FleetAnalytics = {
    period_days: 30, total_vehicles: 1, total_distance_km: 300, total_drives: 30,
    total_charging_sessions: 1, total_energy_kwh: 42, total_cost: 6.72,
    avg_efficiency_wh_km: 180,
    most_efficient_vehicle: { id: 7, name: 'Aurora', efficiency: 180 },
    vehicle_comparison: [{ id: 7, name: 'Aurora', distance: 300, energy: 54, efficiency: 180, drives: 30 }],
    drive_analytics: {
      hourly_pattern: [{ hour: 8, drives: 30, distance: 300 }],
      day_of_week: [{ day: 'Saturday', drives: 30, distance: 300, avg_distance: 10 }],
      speed_distribution: [{ range: '60-80', count: 30 }],
      distance_distribution: [{ range: '0-20', count: 30 }],
      speed_stats: statsValue(64.8), power_stats: statsValue(9600), regen_stats: statsValue(840),
      duration_stats: statsValue(1800), distance_stats: statsValue(10000),
      efficiency_stats: statsValue(180),
      daily_trend: [{ date: day, drives: 1, distance: 17.4, efficiency: 241.38 }],
      temp_vs_efficiency: [{ temp: 18, efficiency: 180, distance: 300 }],
      temperature: { inside: statsValue(21), outside: statsValue(18) },
    },
    charging_analytics: {
      hourly_pattern: [{ hour: 1, charges: 1, energy: 42 }],
      charger_types: [{ type: 'AC', count: 1 }], charger_brands: [{ brand: 'Tesla', count: 1 }],
      monthly_trend: [{ month: day.slice(0, 7), energy: 42, cost: 6.72, sessions: 1,
        avg_power: 10500, gas_cost: 0, savings: 0 }],
      power_stats: statsValue(10500), duration_stats: statsValue(14400), energy_stats: statsValue(42000),
      cost_stats: statsValue(6.72), start_battery_dist: [{ range: '30-40', count: 1 }],
      efficiency_stats: statsValue(95),
    },
    battery_trend: [{ date: day, health_score: 94, capacity_wh: 74200,
      degradation_pct: 6, range_km: 438, cycle_count: 184 }],
  };
  const digest: WeeklyDigestData = {
    drives: 4, distanceKm: 42, energyKwh: 7, cost: 2.1, efficiency: 166.67,
    prevDrives: 2, prevDistanceKm: 21, prevEnergyKwh: 4, prevCost: 1.2, prevEfficiency: 190.48,
  };
  const lifetime: LifetimeStats = {
    total_drives: 123, total_distance_km: 1234, total_driving_hours: 40,
    longest_drive_km: 210, highest_speed_kmh: 100, avg_efficiency_wh_km: 180,
    total_charge_sessions: 22, total_energy_kwh: 222.12, total_charging_hours: 18,
    total_charging_cost: 35.54, gas_equivalent_cost: 120, total_savings: 84.46,
    co2_offset_kg: 55, trees_equivalent: 2.5, earth_circumferences: 0.0308,
    moon_trips: 0.0032, days_on_road: 1.67, homes_equivalent_days: 7.4,
    first_drive_date: earlier, ownership_days: 100, most_active_day_of_week: 'Saturday',
    most_active_hour: 8,
    longest_drive_record: { value: 210, date: day },
    highest_speed_record: { value: 100, date: day },
    max_charge_record: { value: 42, date: day },
    achievements: [{
      id: 'catalogue-first-trip', name: 'Catalogue first trip',
      description: 'Recorded a qualifying synthetic trip', icon: 'Car',
      unlocked: true, unlocked_at: now, progress: 100, target: 1, current: 1,
    }],
  };
  const year: YearReview = {
    year: Number(day.slice(0, 4)), vehicle: { id: 7, display_name: 'Aurora', model: 'Model Y' },
    total_drives: 123, total_distance_km: 1234, total_energy_kwh: 222.12,
    total_charge_sessions: 22, total_driving_minutes: 2400, total_charging_cost: 35.54,
    gas_savings: 84.46, co2_offset_kg: 55, longest_drive: null, shortest_drive: null,
    most_efficient_drive: null, least_efficient_drive: null, fastest_speed_kmh: 100,
    coldest_drive_temp_c: -5, hottest_drive_temp_c: 35,
    monthly_stats: [{ month: Number(day.slice(5, 7)), drives: 123, distance_km: 1234, energy_kwh: 222.12, cost: 35.54 }],
    most_active_day_of_week: 'Saturday', most_active_hour: 8, avg_drives_per_week: 4,
    avg_distance_per_drive_km: 1234 / 123, avg_efficiency_wh_km: 180,
    supercharger_pct: 10, dc_fast_pct: 10, ac_other_pct: 80, avg_charge_start_soc: 35, comparisons: [],
  };
  const monthly: MonthlyMileageResponse = {
    vehicle_id: 7, months: [{
      year_month: day.slice(0, 7), drive_count: 12, total_km: 123,
      total_wh_consumed: 22_140, avg_efficiency_wh_per_km: 180,
    }],
  };
  const mileage: MileageStats = {
    vehicle_id: 7, lifetime_km: 1234, last_7d_km: 70, last_30d_km: 300,
    last_365d_km: 1234, drive_count_lifetime: 123, drive_count_30d: 30,
    first_drive_at: earlier, last_drive_at: now,
  };
  const summary: StateSummary[] = [
    { state: 'driving', count: 2, totalMin: 120 }, { state: 'parked', count: 1, totalMin: 60 },
  ];
  const timeline: { transitions: TimelineEvent[] } = {
    transitions: [{ id: 'catalogue-transition', state: 'driving', startDate: earlier, durationMin: 120 }],
  };
  const anomaly: AnomalyData = {
    anomalies: [{
      signal: 'InsideTemp', type: 'range', severity: 'warning', value: 45, baseline: 22,
      z_score: 3, detected_at: now, message: 'Catalogue cabin temperature exceeded baseline',
    }],
    health_summary: { InsideTemp: 'warning' }, signals_monitored: 12,
    anomalies_last_7d: 1, anomalies_last_24h: 1,
  };
  const fsm: FSMStats = { enabled: true, stats: { driving: 2, parked: 1 }, active_subs: [] };
  const transitions: FSMTransitionResponse = {
    data: [{ id: 1, vehicle_id: 7, ts: now, fsm_name: 'vehicle',
      from_state: 'parked', to_state: 'driving', trigger: 'speed_positive', details: null }],
    total: 1, page: 1, per_page: 5,
  };
  const automation: Omit<Automation, 'trigger_type' | 'trigger_config' | 'conditions' | 'actions'> = {
    id: 1, name: 'Catalogue cabin routine', description: 'Local acceptance fixture only',
    vehicle_id: 7, enabled: true, created_at: earlier, updated_at: now,
    stop_on_failure: true, notify_on_run: false, notify_on_failure: false,
    seasonal_start: null, seasonal_end: null, last_triggered_at: now,
    last_success_at: now, last_failure_at: null, execution_count: 3, failure_count: 0,
    consecutive_failures: 0, auto_disabled: false, auto_disabled_reason: null, preset_id: null,
  };
  const history: AutomationHistoryListResponse = {
    items: [{
      id: 1, automation_id: 1, automation_name: automation.name, vehicle_id: 7,
      triggered_at: earlier, completed_at: now, duration_ms: 1250, trigger_type: 'schedule',
      trigger_snapshot: null, conditions_met: true, conditions_snapshot: null,
      actions_executed: null, actions_total: 1, actions_succeeded: 1, actions_failed: 0,
      status: 'success', error: null, fsm_state: 'completed', created_at: earlier,
    }],
    total: 1, limit: 20, offset: 0,
    summary: { total_executions: 1, succeeded: 1, failed: 0, partial: 0, success_rate: 100, avg_duration_ms: 1250 },
    trend: [{ day, status: 'success', count: 1 }],
  };
  const alerts: Alert[] = [{
    id: 1, vehicle_id: 7, type: 'low_battery', severity: 'warning',
    title: 'Catalogue battery threshold', message: 'Synthetic SOC crossed the configured threshold',
    is_read: false, created_at: now,
  }];
  const stats: NotificationStats = {
    total_sent: 10, sent: 9, failed: 1, pending: 0, total_channels: 2, enabled_channels: 1,
  };
  const logs: NotificationLog[] = [{
    id: 1, channel_id: 1, alert_id: 1, title: 'Catalogue battery threshold',
    message: 'Local fake delivery only', status: 'sent', error: '', created_at: now, sent_at: now,
  }];
  return {
    '/analytics/fleet': fleet,
    '/vehicles/7/weekly-digest': catalogueWire(digest),
    '/analytics/lifetime': lifetime, '/analytics/year-review': year,
    '/mileage/monthly': monthly, '/mileage/stats': mileage,
    '/vehicle-states/summary': catalogueWire(summary),
    '/vehicle-states/timeline': catalogueWire(timeline),
    '/analytics/anomalies': anomaly, '/fsm/stats': fsm, '/fsm/transitions': transitions,
    '/automations': [automation], '/automations/history': history,
    '/alerts': alerts, '/notifications/stats': stats, '/notifications/logs': logs,
  };
}
