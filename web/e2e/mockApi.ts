import { expect, type Page, type Request as PlaywrightRequest, type Route } from '@playwright/test';
import { ensureMockSseServer } from './mockSseServer';
import type { DataScenario } from './routeRegistry';

export type E2EUIDensity = 'compact' | 'comfortable' | 'spacious';

export interface BrowserSeedOptions {
  density?: E2EUIDensity;
}

const NOW = '2026-08-26T16:00:00.000Z';
const STALE = '2026-08-19T16:00:00.000Z';

const settings = {
  unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
  preferred_range: 'rated', language: 'en', base_cost_per_kwh: 0.16,
  api_suspended: false, theme: 'neon-cyan',
  custom_primary: '#00b4d8', custom_accent: '#e63946',
  gas_price_per_unit: 0, gas_unit: 'gallon', gas_efficiency_mpg: 25,
  decimal_precision: 2, quiet_hours_enabled: false, quiet_hours_start: '22:00',
  quiet_hours_end: '07:00', alert_digest_mode: 'instant', currency_symbol: '$',
  locale: 'en-US', tz_display_default: 'vehicle', timezone_user: 'UTC',
  tab_badge_enabled: true, critical_flash_enabled: false, ui_density: 'comfortable',
  time_format_default: 'absolute', chart_palette: 'cb_safe', ai_mode: 'off',
  ai_features: {}, ai_provider_config: {}, ai_cost_cap_cents: 0,
  font_family: 'system', font_mono: 'system', font_custom_sans: '',
  font_custom_mono: '', font_scale: 1, font_leading: 1.5,
  font_tracking: '0em', font_heading_weight: 700,
};

const vehicle = {
  id: 7, vehicle_id: 7, vin: '5YJMOCK0000000001', display_name: 'Aurora',
  model: 'Model Y', trim_badging: 'Long Range', exterior_color: 'Pearl White',
  wheel_type: 'Gemini', state: 'online', healthy: true, timezone: 'UTC',
  created_at: NOW, updated_at: NOW,
};

const LARGE_FLEET_SIZE = 120;

function largeFleetVehicles() {
  return Array.from({ length: LARGE_FLEET_SIZE }, (_, index) => {
    const id = index + vehicle.id;
    const state = ['online', 'asleep', 'offline'][index % 3];
    return {
      ...vehicle,
      id,
      vehicle_id: id,
      vin: `5YJMOCK${String(id).padStart(10, '0')}`,
      display_name: `Fleet Vehicle ${String(index + 1).padStart(3, '0')}`,
      model: index % 4 === 0 ? 'Model 3' : index % 4 === 1 ? 'Model Y' : index % 4 === 2 ? 'Model S' : 'Model X',
      state,
      healthy: state !== 'offline',
    };
  });
}

function largeFleetStates(observedAt: string) {
  return largeFleetVehicles().map((fleetVehicle, index) => {
    const charging = index % 11 === 0;
    const driving = index % 7 === 0 && !charging;
    return {
      vehicle_id: fleetVehicle.id,
      outcome: 'resolved',
      state: {
        vehicle_id: fleetVehicle.id,
        state: charging ? 'charging' : driving ? 'driving' : fleetVehicle.state,
        latitude: 37.4 + index * 0.001,
        longitude: -122.1 - index * 0.001,
        speed: driving ? 18 : 0,
        power: charging ? -7_200 : driving ? 14_000 : 0,
        battery_level: 35 + (index % 61),
        rated_range: 300_000 + index * 800,
        ideal_range: 315_000 + index * 800,
        odometer: 12_000_000 + index * 110_000,
        inside_temp: 21,
        outside_temp: 18,
        is_climate_on: index % 13 === 0,
        is_charging: charging,
        locked: !driving,
        sentry_mode: index % 9 === 0,
        plugged_in: charging,
        charge_port_door_open: charging,
        timestamp: observedAt,
      },
      live: true,
      data_source: 'signal_store',
      observed_at: observedAt,
      freshness: 'fresh',
      verified_fields: ['state', 'battery_level', 'speed', 'is_charging', 'timestamp'],
    };
  });
}

const drive = {
  id: 101, vehicle_id: 7, start_ts: '2026-08-25T08:00:00.000Z',
  end_ts: '2026-08-25T08:32:00.000Z', duration_s: 1920, distance_m: 28750,
  start_address: 'Home', end_address: 'Office', start_lat: 37.4, start_lon: -122.1,
  end_lat: 37.7, end_lon: -122.4, start_soc_pct: 78, end_soc_pct: 68,
  energy_used_wh: 5120, regen_energy_wh: 740, avg_speed_mps: 14.9,
  max_speed_mps: 29.1, avg_power_w: 9600, outside_temp_avg_c: 21,
  inside_temp_avg_c: null, score: 92, ended_status: 'completed',
  created_at: NOW, updated_at: NOW,
};

const charging = {
  id: 201, vehicle_id: 7, started_at: '2026-08-24T23:00:00.000Z',
  ended_at: '2026-08-25T02:10:00.000Z', start_soc_pct: 24, end_soc_pct: 80,
  delta_soc_pct: 56, start_odometer_m: 32100000, end_odometer_m: 32100000,
  start_lat: 37.4, start_lng: -122.1, start_place: 'Home',
  total_energy_added_wh: 42100, peak_power_w: 11200, avg_power_w: 9800,
  cost_decimal: 6.74, cost_currency: 'USD', charger_type: 'AC', cable_type: 'Type 2',
  live: false,
};

const repairCase = {
  id: 301, fingerprint: 'mock-drive-101', kind: 'drive', session_id: 101,
  related_session_id: null, vehicle_id: 7, rule: 'missing_end_boundary',
  confidence: 'high', status: 'open', applicable: true, blocked_reason: null,
  suggested_ended_at: '2026-08-25T08:32:00.000Z',
  evidence_started_at: '2026-08-25T08:00:00.000Z', evidence_stored_ended_at: null,
  evidence_contradiction_ts: '2026-08-25T08:32:00.000Z',
  evidence_contradiction_src: 'gear', evidence_contradiction_field: 'shift_state',
  evidence_contradiction_value: 'P', evidence_last_in_session_ts: '2026-08-25T08:31:55.000Z',
  evidence_last_in_session_src: 'location', evidence_last_in_session_field: 'speed',
  evidence_last_in_session_value: '0', evidence_gap_s: 5, assigned_to: null,
  resolution_note: null, first_seen_at: NOW, last_seen_at: NOW, created_at: NOW, updated_at: NOW,
};

function fsdInsightsFixture(scenario: DataScenario) {
  const empty = scenario === 'empty';
  const partial = scenario === 'partial';
  const shareBasisAvailable = !empty && !partial;
  const start = Date.UTC(2026, 6, 28);
  const daily = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    const hasCounterObservation = !empty && index % 2 === 0;
    const fsdEmitted =
      hasCounterObservation && index % 6 === 0 && (!partial || index >= 6);
    const measured = hasCounterObservation && index >= (partial ? 12 : 0);
    const reset = partial && index === 18;
    const fsdDistanceM = measured
      ? fsdEmitted && !reset
        ? 3_200 + index * 75
        : 0
      : null;
    const drivingDistanceM = hasCounterObservation ? 11_000 + index * 250 : null;
    return {
      date,
      fsd_distance_m: fsdDistanceM,
      driving_distance_m: drivingDistanceM,
      fsd_share_pct:
        shareBasisAvailable &&
        fsdDistanceM != null &&
        drivingDistanceM != null &&
        drivingDistanceM > 0
          ? Math.round((fsdDistanceM / drivingDistanceM) * 10_000) / 100
          : null,
      fsd_observation_count: fsdEmitted ? 1 : 0,
      driving_observation_count: hasCounterObservation ? 1 : 0,
      reset_count: reset ? 1 : 0,
      has_counter_observation: hasCounterObservation,
    };
  });
  const measuredDays = daily.filter((day) => day.fsd_distance_m != null);
  const activeDays = measuredDays.filter((day) => (day.fsd_distance_m ?? 0) > 0);
  const fsdDistanceM = empty
    ? null
    : measuredDays.reduce((sum, day) => sum + (day.fsd_distance_m ?? 0), 0);
  const drivingDistanceM = empty
    ? null
    : daily.reduce((sum, day) => sum + (day.driving_distance_m ?? 0), 0);
  const bestDay = activeDays
    .slice()
    .sort((a, b) => (b.fsd_distance_m ?? 0) - (a.fsd_distance_m ?? 0))[0];
  const counterObservationDays = daily.filter((day) => day.has_counter_observation).length;

  return {
    vehicle_id: 7,
    period: {
      days: 30,
      start_date: '2026-07-28',
      end_date: '2026-08-26',
      timezone: 'UTC',
    },
    totals: {
      fsd_distance_m: fsdDistanceM,
      driving_distance_m: drivingDistanceM,
      fsd_share_pct:
        shareBasisAvailable &&
        fsdDistanceM != null &&
        drivingDistanceM != null &&
        drivingDistanceM > 0
          ? Math.round((fsdDistanceM / drivingDistanceM) * 10_000) / 100
          : null,
      active_days: activeDays.length,
      measured_days: measuredDays.length,
      days_in_period: 30,
      avg_measured_day_fsd_distance_m:
        fsdDistanceM != null && measuredDays.length > 0
          ? fsdDistanceM / measuredDays.length
          : null,
      avg_active_day_fsd_distance_m:
        fsdDistanceM != null && activeDays.length > 0
          ? fsdDistanceM / activeDays.length
          : null,
      best_day: bestDay
        ? {
            date: bestDay.date,
            fsd_distance_m: bestDay.fsd_distance_m,
            driving_distance_m: bestDay.driving_distance_m,
            fsd_share_pct: shareBasisAvailable ? bestDay.fsd_share_pct : null,
          }
        : null,
    },
    quality: {
      fsd_sample_count: daily.reduce((sum, day) => sum + day.fsd_observation_count, 0),
      driving_sample_count: empty ? 0 : counterObservationDays,
      fsd_invalid_sample_count: 0,
      driving_invalid_sample_count: 0,
      fsd_duplicate_sample_count: 0,
      driving_duplicate_sample_count: 0,
      fsd_reset_count: partial ? 1 : 0,
      driving_reset_count: 0,
      fsd_baseline_available: !empty && !partial,
      driving_baseline_available: !empty,
      fsd_reported_in_period: !empty,
      driving_reported_in_period: !empty,
      fsd_distance_derivable: !empty,
      driving_denominator_available: !empty,
      share_basis_available: shareBasisAvailable,
      fsd_measured_days: measuredDays.length,
      historical_data_guarded: true,
      required_normalization_version: 1,
      fsd_untrusted_sample_count: partial ? 3 : 0,
      driving_untrusted_sample_count: partial ? 2 : 0,
      counter_observation_days: counterObservationDays,
      days_without_counter_observation: 30 - counterObservationDays,
      counter_observation_day_pct: Math.round((counterObservationDays / 30) * 10_000) / 100,
      first_observation_at: empty ? null : '2026-07-28T08:00:00Z',
      last_observation_at: empty ? null : '2026-08-25T18:00:00Z',
      fsd_first_observation_at: empty ? null : partial ? '2026-08-03T08:00:00Z' : '2026-07-28T08:00:00Z',
      fsd_last_observation_at: empty ? null : '2026-08-21T18:00:00Z',
      share_clamped: false,
    },
    daily,
  };
}

function listFor<T>(scenario: DataScenario, value: T): T[] {
  return scenario === 'empty' ? [] : [value];
}

interface MockResolution {
  matched: boolean;
  body?: unknown;
  status?: number;
}

const matched = (body: unknown, status = 200): MockResolution => ({ matched: true, body, status });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validVitalsPayload(value: unknown): boolean {
  if (!isPlainObject(value) || !Array.isArray(value.metrics)) return false;
  const metricsValid = value.metrics.every((metric) =>
    isPlainObject(metric)
    && typeof metric.name === 'string'
    && typeof metric.value === 'number'
    && Number.isFinite(metric.value));
  if (!metricsValid) return false;
  if (
    value.events != null
    && (
      !Array.isArray(value.events)
      || !value.events.every((event) =>
        isPlainObject(event)
        && typeof event.kind === 'string'
        && typeof event.outcome === 'string')
    )
  ) return false;
  if (value.context != null && !isPlainObject(value.context)) return false;
  const eventCount = Array.isArray(value.events) ? value.events.length : 0;
  return value.metrics.length + eventCount > 0;
}

function validWebErrorPayload(value: unknown): boolean {
  return isPlainObject(value)
    && typeof value.name === 'string' && value.name.trim().length > 0
    && typeof value.message === 'string' && value.message.trim().length > 0
    && typeof value.route === 'string' && value.route.length > 0
    && typeof value.userAgent === 'string' && value.userAgent.length > 0
    && typeof value.occurredAt === 'string' && !Number.isNaN(Date.parse(value.occurredAt))
    && (value.stack == null || typeof value.stack === 'string');
}

function validateRumBody(
  path: string,
  contentType: string,
  body: string | null,
): string[] {
  const violations: string[] = [];
  const size = body == null ? 0 : Buffer.byteLength(body);
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    violations.push('content-type');
  }
  if (body == null || body.trim() === '') violations.push('empty-body');
  if (size > MAX_BEACON_BYTES) violations.push('payload-too-large');
  let parsed: unknown = null;
  if (body != null && body.trim() !== '') {
    try {
      parsed = JSON.parse(body);
    } catch {
      violations.push('malformed-json');
    }
  }
  if (parsed != null && path === '/web-vitals' && !validVitalsPayload(parsed)) {
    violations.push('web-vitals-schema');
  }
  if (parsed != null && path === '/web-errors' && !validWebErrorPayload(parsed)) {
    violations.push('web-errors-schema');
  }
  return violations;
}

export function resolveApiFixture(
  path: string,
  method: string,
  scenario: DataScenario,
  theme: 'dark' | 'light' = 'dark',
  density: E2EUIDensity = 'comfortable',
): MockResolution {
  const observedAt = scenario === 'stale' ? STALE : NOW;
  if (method !== 'GET') {
    if (
      /^\/(?:settings|vehicles|data-repair|alerts|notifications|pinned|drives|charging|web-vitals|web-errors)(?:\/|\?|$)/.test(path)
    ) return matched({});
    return { matched: false };
  }
  if (path === '/settings') return matched({ ...settings, mode: theme, ui_density: density });
  if (path === '/system/auth-mode') return matched({ mode: 'open', forward_auth: false });
  if (path === '/auth/status') return matched({ authenticated: false, connected: false });
  if (path === '/auth/session') {
    return matched({ mode: 'open', authenticated: false, expires_at: null, expires_in: null, renewable: false });
  }
  if (path === '/onboarding/status') return matched({});
  if (path === '/admin/rbac/matrix') return matched({ roles: [], permissions: [] });
  if (path === '/system/update-check') return matched({ update_available: false });
  if (path === '/export/jobs') return matched([]);
  if (path === '/admin/impersonate') return matched({ mode: 'inactive' });
  if (path === '/push/public-key') return matched({ public_key: '' });
  if (path === '/saved-views' || path.startsWith('/saved-views?')) return matched([]);
  if (path.startsWith('/search?')) {
    const query = new URLSearchParams(path.split('?')[1]).get('q') ?? '';
    return matched({ hits: [], query });
  }
  if (path === '/settings/dashboard-layouts') return matched({ layouts: [], active_layout_id: null });
  if (path.startsWith('/user-preferences/latest?')) return matched(null);
  if (/^\/signals\/7\/live/.test(path)) return matched({});
  if (path === '/vehicles') {
    if (scenario === 'large-fleet') return matched(largeFleetVehicles());
    return matched(listFor(scenario, scenario === 'partial' ? { ...vehicle, model: '', trim_badging: '' } : vehicle));
  }
  if (/^\/vehicles\/states\?/.test(path)) {
    if (scenario === 'large-fleet') {
      const liveObservedAt = new Date().toISOString();
      const vehicles = largeFleetStates(liveObservedAt);
      const operational = vehicles.reduce<Record<string, number>>((counts, item) => {
        const status = item.state.state;
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      }, {});
      return matched({
        data: {
          now: liveObservedAt,
          total: LARGE_FLEET_SIZE,
          limit: 500,
          offset: 0,
          counts: {
            resolved: LARGE_FLEET_SIZE,
            missing: 0,
            failed: 0,
          },
          summary: {
            counted: LARGE_FLEET_SIZE,
            verified_count: LARGE_FLEET_SIZE,
            attention_count: 0,
            operational: {
              charging: operational.charging ?? 0,
              driving: operational.driving ?? 0,
              parked: operational.parked ?? 0,
              asleep: operational.asleep ?? 0,
              online: operational.online ?? 0,
              offline: operational.offline ?? 0,
              other: 0,
            },
            attention: {
              unverified: 0,
              stale: 0,
              unknown: 0,
              missing: 0,
              failed: 0,
            },
            oldest_observed_at: liveObservedAt,
            newest_observed_at: liveObservedAt,
            observed_count: LARGE_FLEET_SIZE,
          },
          vehicles,
        },
      });
    }
    const hasState = scenario !== 'empty';
    const outcome = hasState ? 'resolved' : 'missing';
    return matched({
      data: {
        now: NOW,
        total: 1,
        limit: 500,
        offset: 0,
        counts: {
          resolved: hasState ? 1 : 0,
          missing: hasState ? 0 : 1,
          failed: 0,
        },
        vehicles: [{
          vehicle_id: 7,
          outcome,
          state: hasState ? {
            vehicle_id: 7,
            state: 'online',
            latitude: 37.4,
            longitude: -122.1,
            speed: 0,
            power: 0,
            battery_level: 72,
            rated_range: 410000,
            ideal_range: 430000,
            odometer: 32100000,
            inside_temp: 21,
            outside_temp: 18,
            is_climate_on: false,
            is_charging: false,
            locked: true,
            sentry_mode: false,
            plugged_in: false,
            charge_port_door_open: false,
            timestamp: observedAt,
          } : null,
          live: hasState && scenario !== 'stale',
          data_source: hasState ? 'signal_store' : 'unavailable',
          observed_at: hasState ? observedAt : null,
          freshness: hasState ? (scenario === 'stale' ? 'stale' : 'fresh') : 'unknown',
          verified_fields: hasState
            ? ['state', 'battery_level', 'speed', 'is_charging', 'timestamp']
            : [],
        }],
      },
    });
  }
  if (/^\/vehicles\/7\/state/.test(path)) {
    return matched({ live: scenario !== 'stale', state: {
      vehicle_id: 7, state: 'online', latitude: 37.4, longitude: -122.1,
      speed: 0, power: 0, battery_level: 72, rated_range: 410000,
      ideal_range: 430000, odometer: 32100000, inside_temp: 21,
      outside_temp: 18, is_climate_on: false, is_charging: false,
      charger_power: 0, charge_rate: 0, time_to_full_charge: 0,
      is_locked: true, sentry_mode: false, software_version: '2026.26.3',
      updated_at: observedAt,
    }});
  }
  if (/^\/drives(?:\?|$)/.test(path)) {
    const value = scenario === 'partial'
      ? { ...drive, end_ts: null, end_address: null, energy_used_wh: null, score: null, live: true }
      : { ...drive, updated_at: observedAt };
    return matched(listFor(scenario, value));
  }
  if (path.startsWith('/charging?') || path === '/charging') {
    const value = scenario === 'partial'
      ? { ...charging, ended_at: null, end_soc_pct: null, avg_power_w: null, live: true }
      : { ...charging, started_at: scenario === 'stale' ? STALE : charging.started_at };
    return matched(listFor(scenario, value));
  }
  if (path.startsWith('/analytics/fsd')) {
    return matched(fsdInsightsFixture(scenario));
  }
  if (path.startsWith('/analytics/charging-optimizer')) {
    return matched({ recommended_start_hour: 1, estimated_savings: 4.2, confidence: 0.84 });
  }
  if (path.startsWith('/analytics/battery-health')) {
    return matched({
      vehicle_id: 7, current_soh: 94, estimated_capacity_wh: 74200,
      original_capacity_wh: 79000, degradation_rate_pct_per_year: 1.4,
      battery_age_months: 36, total_cycles: 184, avg_depth_of_discharge_pct: 34,
      fast_charge_pct: 18, full_charge_pct: 9, charge_habits_score: 88,
      stress_level: 'Low', temp_exposure_score: 91, temp_exposure_reason: null,
      capacity_source: 'fleet_telemetry', charging_analysis: {
        charge_level_distribution: [
          { min_soc_pct: 20, max_soc_pct: 40, start_count: 24, end_count: 2 },
          { min_soc_pct: 70, max_soc_pct: 90, start_count: 2, end_count: 35 },
        ],
        avg_start_soc_pct: 28, avg_end_soc_pct: 78, ac_session_count: 34,
        dc_session_count: 8, supercharger_count: 6, dc_fast_count: 8,
        deep_discharge_count: 2, ac_energy_wh: 1_200_000, dc_energy_wh: 310_000,
        total_sessions: 42,
      },
      prediction: {
        has_enough_data: true, slope_per_year: -1.4, years_to_80_pct: 9.8,
        predicted_date: '2036-06-01', projection_points: [
          { month: '2026-08', health: 94 }, { month: '2027-08', health: 92.6 },
        ],
      },
      projections: [
        { date: '2026-08-01', health_pct: 94, confidence_low: 92, confidence_high: 96 },
        { date: '2027-08-01', health_pct: 92.6, confidence_low: 89, confidence_high: 95 },
      ],
      history: scenario === 'partial' ? [] : [
        { date: '2026-06-01', odometer_m: 30_500_000, soh_pct: 95, capacity_wh: 75000, range_m: 445000 },
        { date: '2026-08-01', odometer_m: 32_100_000, soh_pct: 94, capacity_wh: 74200, range_m: 438000 },
      ],
      charging_habits: {
        fast_charge_count: 8, slow_charge_count: 34, deep_discharge_count: 2,
        charge_to_full_count: 4, high_soc_count: 6, avg_energy_per_session: 35952,
        total_count: 42,
      },
      risk_factors: [
        { name: 'Fast charging', score: 18, label: 'Low', detail: 'Most sessions use AC charging.' },
      ],
      recommendations: ['Continue daily charging below 80% when practical.'],
    });
  }
  if (path.startsWith('/charging-telemetry/latest')) return matched(null);
  if (path.startsWith('/data-repair/cases/stats')) {
    return matched({ open: 1, in_review: 0, quarantined: 0, resolved: 0, total: 1, updated_at: observedAt });
  }
  if (/^\/data-repair\/cases\/301$/.test(path)) {
    return matched({ case: repairCase, comments: [], quarantine: null });
  }
  if (path.startsWith('/data-repair/cases')) {
    return matched({ cases: listFor(scenario, { ...repairCase, last_seen_at: observedAt }), has_more: false, next_cursor: null });
  }
  if (path.startsWith('/data-repair/quarantine')) return matched({ quarantines: [], has_more: false, next_cursor: null });
  if (path.startsWith('/data-repair/stale-sessions')) return matched({ stale_charging: [], stale_drives: [] });
  if (path.startsWith('/data-repair/suggestions')) return matched({ suggestions: [], generated_at: observedAt });
  if (path.startsWith('/fleet-ops/work-orders')) return matched({ items: [], total: 0, limit: 100, offset: 0 });
  if (path.startsWith('/pinned')) return matched([]);
  if (/^\/(?:alerts|notifications)(?:\/|\?|$)/.test(path)) return matched([]);
  if (path.startsWith('/system/health')) return matched({ status: 'healthy', timestamp: observedAt, checks: {} });
  if (path.startsWith('/system/version')) return matched({ version: 'e2e', commit: 'fixture', build_time: NOW });
  if (path.startsWith('/status/')) return matched({ status: 'healthy', updated_at: observedAt });
  return { matched: false };
}

export interface MockApiController {
  readonly unmatched: Set<string>;
  readonly seen: Set<string>;
  readonly sse: Set<string>;
  readonly delayed: Set<string>;
  sseRequests: number;
  pending: number;
  lastActivityAt: number;
  readonly requests: ApiRequestRecord[];
  readonly requestIndex: WeakMap<PlaywrightRequest, ApiRequestRecord>;
  readonly invalidRum: Array<{
    path: string;
    size: number;
    contentType: string;
    violations: string[];
  }>;
}

export interface CapturedBeacon {
  method: 'POST';
  sameOrigin: boolean;
  path: string;
  hasSearch: boolean;
  hasHash: boolean;
  size: number;
  contentType: string;
  body: unknown;
  accepted: boolean;
  violations: string[];
}

export interface ApiRequestRecord {
  method: string;
  origin: string;
  path: string;
  resourceType: string;
  disposition: 'pending' | 'fulfilled' | 'continued' | 'aborted';
}

const ALLOWED_BEACON_PATHS = ['/api/v1/web-vitals', '/api/v1/web-errors'] as const;
const MAX_BEACON_BYTES = 64 * 1024;

function requestRecord(
  controller: MockApiController,
  request: PlaywrightRequest,
): ApiRequestRecord | null {
  const url = new URL(request.url());
  if (!url.pathname.startsWith('/api/')) return null;
  const existing = controller.requestIndex.get(request);
  if (existing) return existing;
  const record: ApiRequestRecord = {
    method: request.method(),
    origin: url.origin,
    path: url.pathname,
    resourceType: request.resourceType(),
    disposition: 'pending',
  };
  controller.requestIndex.set(request, record);
  controller.requests.push(record);
  return record;
}

function isSseRequest(route: Route, path: string): boolean {
  const request = route.request();
  const accept = request.headers()['accept'] ?? '';
  return request.resourceType() === 'eventsource'
    || accept.includes('text/event-stream')
    || isSsePath(path);
}

export function isSsePath(path: string): boolean {
  return path === '/events' || /\/stream(?:\?|$)/.test(path);
}

async function fulfillSse(
  route: Route,
  path: string,
  controller: MockApiController,
  sseOrigin: string,
): Promise<void> {
  controller.sse.add(path);
  controller.sseRequests += 1;
  const record = requestRecord(controller, route.request());
  if (record) record.disposition = 'continued';
  await route.continue({ url: `${sseOrigin}/api/v1/events` });
}

async function fulfill(
  route: Route,
  scenario: DataScenario,
  controller: MockApiController,
  theme: 'dark' | 'light',
  density: E2EUIDensity,
  sseOrigin: string,
): Promise<void> {
  controller.pending += 1;
  controller.lastActivityAt = Date.now();
  const request = route.request();
  const url = new URL(request.url());
  const record = requestRecord(controller, request);
  if (!url.pathname.startsWith('/api/v1/')) {
    controller.unmatched.add(`${request.method()} ${url.pathname}`);
    if (record) record.disposition = 'aborted';
    await route.abort('blockedbyclient');
    controller.pending -= 1;
    controller.lastActivityAt = Date.now();
    return;
  }
  const path = `${url.pathname.replace(/^\/api\/v1/, '')}${url.search}`;
  controller.seen.add(`${request.method()} ${path}`);
  try {
    if (isSseRequest(route, path)) {
      await fulfillSse(route, path, controller, sseOrigin);
      return;
    }
    const resolution = resolveApiFixture(path, request.method(), scenario, theme, density);
    if (!resolution.matched) {
      controller.unmatched.add(
        `${request.method()} ${url.pathname}${url.search ? '?<redacted>' : ''}`,
      );
      if (record) record.disposition = 'fulfilled';
      await route.fulfill({
        status: 599,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Unmatched E2E API fixture: ${request.method()} ${path}` }),
      });
      return;
    }
    const requiredShellFixture =
      path === '/vehicles' ||
      path === '/auth/status' ||
      path === '/auth/session' ||
      path.startsWith('/system/auth-mode');
    if (request.method() === 'POST' && (path === '/web-vitals' || path === '/web-errors')) {
      const contentType = request.headers()['content-type'] ?? '';
      const body = request.postData();
      const violations = validateRumBody(path, contentType, body);
      if (violations.length > 0) {
        controller.invalidRum.push({
          path,
          size: body == null ? 0 : Buffer.byteLength(body),
          contentType,
          violations,
        });
        if (record) record.disposition = 'fulfilled';
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid E2E RUM payload' }),
        });
        return;
      }
    }
    if (scenario === 'loading' && request.method() === 'GET' && !requiredShellFixture) {
      controller.delayed.add(path);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (scenario === 'error' && request.method() === 'GET' && !requiredShellFixture) {
      if (record) record.disposition = 'fulfilled';
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Deterministic E2E upstream failure', code: 'E2E_FAILURE' }),
      });
      return;
    }
    const status = resolution.status ?? 200;
    if (record) record.disposition = 'fulfilled';
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 204 ? '' : JSON.stringify(resolution.body),
    });
  } finally {
    controller.pending -= 1;
    controller.lastActivityAt = Date.now();
  }
}

export async function installApiMocks(
  page: Page,
  scenario: DataScenario = 'populated',
  theme: 'dark' | 'light' = 'dark',
  density: E2EUIDensity = 'comfortable',
): Promise<MockApiController | null> {
  if (process.env.E2E_MOCKS === '0') return null;
  const sseServer = await ensureMockSseServer();
  const controller: MockApiController = {
    unmatched: new Set(),
    seen: new Set(),
    sse: new Set(),
    delayed: new Set(),
    sseRequests: 0,
    pending: 0,
    lastActivityAt: Date.now(),
    requests: [],
    requestIndex: new WeakMap(),
    invalidRum: [],
  };
  page.on('request', (request) => {
    requestRecord(controller, request);
  });
  await page.route('**/api/**', (route) =>
    fulfill(route, scenario, controller, theme, density, sseServer.origin));
  return controller;
}

export async function waitForHarnessReady(
  page: Page,
  controller: MockApiController | null,
): Promise<void> {
  await expect(page.locator('main')).toBeVisible();
  if (controller) {
    await expect.poll(() => ({
      pending: controller.pending,
      quiet: Date.now() - controller.lastActivityAt >= 750,
    }), {
      message: 'mock API requests did not settle',
      timeout: 10_000,
    }).toEqual({ pending: 0, quiet: true });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await waitForNoVisibleActivity(page);
  await page.evaluate(() => {
    (window as Window & { __TESLASYNC_E2E_READY__?: boolean }).__TESLASYNC_E2E_READY__ = true;
  });
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __TESLASYNC_E2E_READY__?: boolean }).__TESLASYNC_E2E_READY__)),
  ).toBe(true);
  let previous = '';
  let stableSamples = 0;
  await expect.poll(async () => {
    const signature = await page.evaluate(() => {
      const main = document.querySelector('main');
      return `${main?.innerHTML.length ?? 0}:${main?.scrollHeight ?? 0}`;
    });
    stableSamples = signature === previous ? stableSamples + 1 : 0;
    previous = signature;
    return stableSamples;
  }, {
    message: 'application DOM did not settle after mocked requests completed',
    intervals: [150, 150, 150, 150, 150, 150, 150, 150],
  }).toBeGreaterThanOrEqual(5);
}

export async function waitForNoVisibleActivity(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const activity = document.querySelectorAll<HTMLElement>(
      '[aria-busy="true"], [data-testid*="skeleton"], [role="progressbar"][aria-label*="loading" i]',
    );
    return [...activity].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < innerHeight;
    }).map((element) => ({
      tag: element.tagName.toLowerCase(),
      testId: element.dataset.testid ?? '',
      label: element.getAttribute('aria-label') ?? '',
      className: element.className,
    }));
  }), {
    message: 'visible busy, skeleton, or progress activity did not finish',
    timeout: 30_000,
  }).toEqual([]);
}

export async function expectThemeApplied(page: Page, theme: 'dark' | 'light'): Promise<void> {
  const state = await page.evaluate(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    return {
      dark: root.classList.contains('dark'),
      light: root.classList.contains('light-mode'),
      colorScheme: style.colorScheme,
      appBackground: style.getPropertyValue('--bg-app').trim().toLowerCase(),
    };
  });
  expect(state.dark).toBe(theme === 'dark');
  expect(state.light).toBe(theme === 'light');
  expect(state.colorScheme).toContain(theme);
  expect(state.appBackground).toBe(theme === 'light' ? '#f8fafc' : '#0b0d12');
}

export async function assertMockApiComplete(
  page: Page,
  controller: MockApiController | null,
): Promise<void> {
  if (!controller) return;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
  await page.waitForTimeout(50);
  await expect.poll(() => ({
    pending: controller.pending,
    quiet: Date.now() - controller.lastActivityAt >= 150,
  }), {
    message: 'late API activity did not settle before mock completion',
    timeout: 5_000,
  }).toEqual({ pending: 0, quiet: true });
  expect([...controller.unmatched], 'unmatched E2E API requests').toEqual([]);
  expect(controller.invalidRum, 'invalid fetch/xhr RUM payloads').toEqual([]);
  const beacons = await readCapturedBeacons(page);
  const beaconViolations = beacons
    .filter((beacon) => !beacon.accepted)
    .map((beacon) => ({
      method: beacon.method,
      origin: beacon.sameOrigin ? 'same-origin' : 'off-origin',
      path: beacon.path,
      hasSearch: beacon.hasSearch,
      hasHash: beacon.hasHash,
      size: beacon.size,
      contentType: beacon.contentType,
      violations: beacon.violations,
    }));
  expect(beaconViolations, 'invalid or unreviewed navigator.sendBeacon requests').toEqual([]);
  const incompleteRequests = controller.requests
    .filter((request) => request.disposition === 'pending' || request.disposition === 'aborted')
    .map((request) => ({
      method: request.method,
      origin: request.origin === new URL(page.url()).origin ? 'same-origin' : 'off-origin',
      path: request.path,
      resourceType: request.resourceType,
      disposition: request.disposition,
    }));
  expect(incompleteRequests, 'API requests escaped or were blocked by Playwright routing').toEqual([]);
  await cleanupServiceWorkers(page);
}

export async function readCapturedBeacons(page: Page): Promise<CapturedBeacon[]> {
  return page.evaluate(() => (
    window as Window & { __TESLASYNC_E2E_BEACONS__?: CapturedBeacon[] }
  ).__TESLASYNC_E2E_BEACONS__ ?? []);
}

export async function cleanupServiceWorkers(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  });
}

export async function seedBrowserState(
  page: Page,
  theme: 'dark' | 'light',
  routePath = '/',
  options: BrowserSeedOptions = {},
): Promise<void> {
  const density = options.density ?? 'comfortable';
  await page.addInitScript(({ selectedTheme, selectedDensity, activePath, allowedBeaconPaths, maxBeaconBytes }) => {
    const beaconRecords: CapturedBeacon[] = [];
    const NativeBlob = Blob;
    const blobBodies = new WeakMap<Blob, string | null>();
    const decodeBytes = (buffer: ArrayBuffer, byteOffset = 0, byteLength = buffer.byteLength) =>
      new TextDecoder().decode(new Uint8Array(buffer, byteOffset, byteLength));
    class CapturedBlob extends NativeBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        super(parts, options);
        const content: string[] = [];
        let serializable = true;
        for (const part of parts) {
          if (typeof part === 'string') {
            content.push(part);
          } else if (part instanceof ArrayBuffer) {
            content.push(decodeBytes(part));
          } else if (ArrayBuffer.isView(part)) {
            content.push(decodeBytes(part.buffer as ArrayBuffer, part.byteOffset, part.byteLength));
          } else if (part instanceof NativeBlob) {
            const nested = blobBodies.get(part);
            if (nested == null) serializable = false;
            else content.push(nested);
          } else {
            serializable = false;
          }
        }
        blobBodies.set(this, serializable ? content.join('') : null);
      }
    }
    Object.defineProperty(window, 'Blob', {
      configurable: true,
      value: CapturedBlob,
      writable: true,
    });
    const isObject = (value: unknown): value is Record<string, unknown> =>
      value != null && typeof value === 'object' && !Array.isArray(value);
    const isMetric = (value: unknown) =>
      isObject(value) && typeof value.name === 'string'
      && typeof value.value === 'number' && Number.isFinite(value.value);
    const isUxEvent = (value: unknown) =>
      isObject(value) && typeof value.kind === 'string' && typeof value.outcome === 'string';
    const validVitals = (value: unknown) => {
      if (!isObject(value) || !Array.isArray(value.metrics)) return false;
      if (!value.metrics.every(isMetric)) return false;
      if (value.events != null && (!Array.isArray(value.events) || !value.events.every(isUxEvent))) {
        return false;
      }
      if (value.context != null && !isObject(value.context)) return false;
      const eventCount = Array.isArray(value.events) ? value.events.length : 0;
      // The context-less metrics-only form is the reviewed legacy payload.
      return value.metrics.length + eventCount > 0;
    };
    const validWebError = (value: unknown) =>
      isObject(value)
      && typeof value.name === 'string' && value.name.trim().length > 0
      && typeof value.message === 'string' && value.message.trim().length > 0
      && typeof value.route === 'string' && value.route.length > 0
      && typeof value.userAgent === 'string' && value.userAgent.length > 0
      && typeof value.occurredAt === 'string' && !Number.isNaN(Date.parse(value.occurredAt))
      && (value.stack == null || typeof value.stack === 'string');
    const sanitize = (value: unknown, depth = 0): unknown => {
      if (depth > 5) return '[truncated]';
      if (typeof value === 'string') return value.length > 256 ? `${value.slice(0, 256)}…` : value;
      if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
      if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitize(item, depth + 1));
      if (!isObject(value)) return `[${typeof value}]`;
      return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
        key,
        /token|secret|password|authorization|cookie|email|vin|route|url|path|location|message|stack|useragent/i.test(key)
          ? '[redacted]'
          : sanitize(item, depth + 1),
      ]));
    };
    const serializeBody = (data?: BodyInit | null) => {
      if (data == null) return { text: null, contentType: '', size: 0, kind: 'empty' };
      if (data instanceof NativeBlob) {
        return {
          text: blobBodies.get(data) ?? null,
          contentType: data.type,
          size: data.size,
          kind: 'blob',
        };
      }
      if (typeof data === 'string') {
        return {
          text: data,
          contentType: 'text/plain;charset=UTF-8',
          size: new TextEncoder().encode(data).byteLength,
          kind: 'string',
        };
      }
      if (data instanceof ArrayBuffer) {
        return {
          text: decodeBytes(data),
          contentType: 'application/octet-stream',
          size: data.byteLength,
          kind: 'arraybuffer',
        };
      }
      if (ArrayBuffer.isView(data)) {
        return {
          text: decodeBytes(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength),
          contentType: 'application/octet-stream',
          size: data.byteLength,
          kind: 'arraybuffer-view',
        };
      }
      if (data instanceof FormData) {
        return { text: null, contentType: 'multipart/form-data', size: 0, kind: 'formdata' };
      }
      if (data instanceof URLSearchParams) {
        const text = data.toString();
        return {
          text,
          contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
          size: new TextEncoder().encode(text).byteLength,
          kind: 'url-search-params',
        };
      }
      return { text: null, contentType: '', size: 0, kind: 'unsupported' };
    };
    Object.defineProperty(window, '__TESLASYNC_E2E_BEACONS__', {
      configurable: false,
      value: beaconRecords,
      writable: false,
    });
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (rawUrl: string | URL, data?: BodyInit | null): boolean => {
        let resolved: URL;
        try {
          resolved = new URL(String(rawUrl), location.href);
        } catch {
          beaconRecords.push({
            method: 'POST',
            sameOrigin: false,
            path: '[invalid-url]',
            hasSearch: false,
            hasHash: false,
            size: 0,
            contentType: '',
            body: null,
            accepted: false,
            violations: ['invalid-url'],
          });
          return false;
        }
        const serialized = serializeBody(data);
        const violations: string[] = [];
        if (resolved.origin !== location.origin) violations.push('off-origin');
        if (!allowedBeaconPaths.some((path) => path === resolved.pathname)) violations.push('path');
        if (resolved.search !== '') violations.push('search');
        if (resolved.hash !== '') violations.push('hash');
        if (serialized.size === 0 || serialized.text == null || serialized.text.trim() === '') {
          violations.push('empty-or-unserializable-body');
        }
        if (serialized.size > maxBeaconBytes) violations.push('payload-too-large');
        if (serialized.contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          violations.push('content-type');
        }
        let parsed: unknown = null;
        if (serialized.text != null && serialized.text.trim() !== '') {
          try {
            parsed = JSON.parse(serialized.text);
          } catch {
            violations.push('malformed-json');
          }
        }
        if (parsed != null && resolved.pathname === '/api/v1/web-vitals' && !validVitals(parsed)) {
          violations.push('web-vitals-schema');
        }
        if (parsed != null && resolved.pathname === '/api/v1/web-errors' && !validWebError(parsed)) {
          violations.push('web-errors-schema');
        }
        const accepted = violations.length === 0;
        beaconRecords.push({
          method: 'POST',
          sameOrigin: resolved.origin === location.origin,
          path: resolved.pathname,
          hasSearch: resolved.search !== '',
          hasHash: resolved.hash !== '',
          size: serialized.size,
          contentType: serialized.contentType,
          body: parsed == null ? null : sanitize(parsed),
          accepted,
          violations,
        });
        return accepted;
      },
    });
    localStorage.setItem('teslasync-onboarded', 'true');
    localStorage.setItem('teslasync:onboarding:skipped:v1', '1');
    localStorage.setItem('teslasync-theme', 'neon-cyan');
    localStorage.setItem('teslasync-mode', selectedTheme);
    localStorage.setItem('teslasync-density', selectedDensity);
    localStorage.setItem('teslasync:themeFirstRunDismissed:v1', '1');
    localStorage.setItem('teslasync-font-family', 'system');
    localStorage.setItem('teslasync-font-mono', 'system');
    localStorage.setItem('teslasync-font-custom-sans', '');
    localStorage.setItem('teslasync-font-custom-mono', '');
    localStorage.setItem('teslasync-font-scale', '1');
    localStorage.setItem('teslasync-font-leading', '1.5');
    localStorage.setItem('teslasync-font-tracking', '0em');
    localStorage.setItem('teslasync-font-heading-weight', '700');
    localStorage.setItem('teslasync:dashboard:customizeHintDismissed:v1', '1');
    localStorage.setItem('teslasync:whats-new:dismissed', '1');
    localStorage.setItem('teslasync:dev-banner:dismissed', '1');
    localStorage.setItem('teslasync:changelog:seen-version', '99.0.0');
    localStorage.setItem('teslasync:changelog:last-shown', '1787760000000');
    localStorage.setItem('teslasync:checklist:dismissed', '1');
    const sidebarSection =
      activePath.startsWith('/settings') ? 'Settings'
        : activePath.startsWith('/data-repair') ? 'Data'
          : activePath.startsWith('/vehicles') ? 'Vehicles'
            : activePath.startsWith('/drives') ? 'Driving'
              : activePath.startsWith('/charging') ? 'Charging'
                : activePath.startsWith('/battery') ? 'Battery'
                  : activePath.startsWith('/notifications') ? 'Notifications'
                    : 'Home';
    localStorage.setItem('teslasync-expanded-nav-sections', JSON.stringify([sidebarSection]));
    for (const tourId of ['main', 'alerts', 'charging', 'drives', 'vehicles', 'automations', 'settings', 'debugger']) {
      for (let version = 1; version <= 5; version += 1) {
        localStorage.setItem(`teslasync:tour:v${version}:${tourId}`, 'completed');
      }
    }
    localStorage.setItem('teslasync-tour-completed', 'true');
    localStorage.setItem('teslasync:tour:list-seen', '1');
    const dashboard = [{
      id: 'e2e', name: 'E2E', widgets: [{ id: 'e2e-quick-nav', widgetId: 'quick-nav' }],
      layouts: {}, createdAt: '2026-08-26T16:00:00.000Z',
      updatedAt: '2026-08-26T16:00:00.000Z', isDefault: true,
    }];
    localStorage.setItem('teslasync-dashboards', JSON.stringify(dashboard));
    localStorage.setItem('teslasync-active-dashboard', 'e2e');
  }, {
    selectedTheme: theme,
    selectedDensity: density,
    activePath: routePath,
    allowedBeaconPaths: [...ALLOWED_BEACON_PATHS],
    maxBeaconBytes: MAX_BEACON_BYTES,
  });
}
