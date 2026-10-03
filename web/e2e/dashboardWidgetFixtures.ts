import type { Page } from '@playwright/test';
import type { GuardConfig, GuardEventsResponse } from '../src/api/hooks/useGuard';
import type { FleetTelemetryError, FleetTelemetryErrorVIN } from '../src/api/hooks/useTelemetry';
import type { SecurityEvent, VehicleDriver, VehicleInvitation } from '../src/api/types';
import type { APICallLogStats, ConnectionPool, DBStats, SystemHealth } from '../src/types/admin';
import type { CostBreakdown } from '../src/types/analytics';
import type { CostForecastData } from '../src/types/charging';
import type {
  EnergyStats, TeslaEnergyHistoryEntry, TeslaEnergyLiveStatus, TeslaEnergySite,
  TeslaEnergySiteInfoResponse, TeslaWCChargingEntry,
} from '../src/types/energy';
import type { SignalCatalogEntry } from '../src/types/signals';
import type { TelemetryStatus } from '../src/types/telemetry';
import type { SafetySnapshot } from '../src/types/vehicle-systems';
import { fulfillApiFixture, mockVehicle, type MockApiController } from './mockApi';

export async function installDashboardWidgetSources(page: Page, mocks: MockApiController) {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 3_600_000).toISOString();
  const day = now.slice(0, 10);
  const previousDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const security: SecurityEvent = {
    vehicle_id: 7, ts: now, created_at: now, event_type: 'sentry_mode',
    doors_open: '[]', windows_open: '[]', locked: true, sentry_mode: true,
    user_present: false, detail: 'Sentry armed', source: 'telemetry',
    door_state: 'AllClosed', fd_window: 'Closed', fp_window: 'Closed',
    rd_window: 'Closed', rp_window: 'Closed',
  };
  const safety: SafetySnapshot = {
    id: 1, vehicle_id: 7, created_at: now, automatic_blind_spot_camera: true,
    automatic_emergency_braking_off: false, blind_spot_collision_warning: true,
    emergency_lane_departure_avoidance: true, forward_collision_warning: 'Medium',
    lane_departure_avoidance: 'Assist', speed_limit_warning: 'Chime',
    pin_to_drive_enabled: true, cruise_follow_distance: 3,
  };
  const site: TeslaEnergySite = {
    id: 1, energy_site_id: 42, resource_type: 'battery', site_name: 'Review home',
    gateway_id: 'review-gateway', total_pack_energy: 13_500, percentage_charged: 78,
    battery_type: 'powerwall', backup_capable: true, storm_mode_enabled: false,
    has_solar: true, has_battery: true, has_grid: true, has_load_meter: true,
    tou_capable: true, storm_mode_capable: true, fetched_at: now,
    created_at: earlier, updated_at: now, site_info_fetched_at: now,
  };
  const live: TeslaEnergyLiveStatus = {
    id: 1, energy_site_id: 42, solar_power: 4200, battery_power: -1000,
    load_power: 2500, grid_power: -700, grid_services_power: 0,
    energy_left: 10_530, total_pack_energy: 13_500, percentage_charged: 78,
    grid_status: 'Active', backup_capable: true, storm_mode_active: false,
    timestamp: now, fetched_at: now,
  };
  const fixtures: Record<string, unknown> = {
    '/security/latest': security,
    '/security': [security],
    '/safety/latest': safety,
    '/safety': [safety],
    '/vehicles/7/guard': {
      vehicle_id: 7, enabled: true, home_geofence_id: null, sensitivity: 'medium',
      auto_panic: false, created_at: earlier, updated_at: now,
    } satisfies GuardConfig,
    '/vehicles/7/guard/events': {
      vehicle_id: 7, events: [{
        id: 1, vehicle_id: 7, ts: now, event_type: 'sentry_mode',
        from_state: 'off', to_state: 'armed', details: null,
        acknowledged_at: null, acknowledged_by: null,
      }],
    } satisfies GuardEventsResponse,
    '/vehicles/7/drivers': [{
      id: 1, vehicle_id: 7, share_user_id: 10, driver_email: 'review@example.invalid',
      driver_name: 'Review driver', role: 'owner', fetched_at: now,
    }] satisfies VehicleDriver[],
    '/vehicles/7/invitations': [{
      id: 1, vehicle_id: 7, invitation_id: 'review-invite', invite_url: null,
      status: 'pending', expires_at: null, created_by: 'Review owner',
      fetched_at: now, created_at: now,
    }] satisfies VehicleInvitation[],
    '/vehicles/7/mobile-enabled': { data: { enabled: true }, fetched_at: now },
    '/vehicles/7/state': {
      vehicle: mockVehicle, live: true, observed_at: now, freshness: 'fresh',
      verified_fields: ['state', 'power', 'battery_level', 'is_charging', 'charger_power', 'timestamp'],
      state: {
        vehicle_id: 7, state: 'driving', power: 14_000, battery_level: 72,
        is_charging: false, charger_power: 0, updated_at: now,
      },
    },
    '/vehicles/7/energy': {
      vehicle_id: 7, period_days: 30, total_energy_used_wh: 12_000,
      total_energy_charged_wh: 15_000, total_wh: 15_000, total_cost: 4.5,
      total_distance_m: 100_000, avg_efficiency_wh_per_m: 0.12, co2_saved_kg: 3.2,
      daily_breakdown: [
        { date: previousDay, energy_wh: 5000, cost: 1.5, distance_m: 30_000, efficiency_wh_per_m: 5000 / 30_000 },
        { date: day, energy_wh: 7000, cost: 3, distance_m: 70_000, efficiency_wh_per_m: 0.1 },
      ],
    } satisfies EnergyStats,
    '/tesla/energy-sites': [site],
    '/tesla/energy-sites/42/site-info': {
      data: {
        site_name: site.site_name, installation_time_zone: 'UTC',
        backup_reserve_percent: 20, default_real_mode: 'self_consumption',
        version: '25.14',
        battery_count: 1, nameplate_power: 5000, nameplate_energy: 13_500,
        components: { solar: true, battery: true, grid: true, load_meter: true },
      },
      fetched_at: now,
    } satisfies TeslaEnergySiteInfoResponse,
    '/tesla/energy-sites/42/live-status/history': [
      { ...live, id: 2, timestamp: earlier, solar_power: 3500, load_power: 2100 },
      live,
    ] satisfies TeslaEnergyLiveStatus[],
    '/tesla/energy-sites/42/energy-history': [10_000, 9000, 12_000].map((solar, index) => ({
      id: index + 1, energy_site_id: 42, period: 'day',
      timestamp: new Date(Date.now() - (2 - index) * 86_400_000).toISOString(),
      solar_energy_wh: solar, battery_energy_in_wh: 2000, battery_energy_out_wh: 1000,
      grid_energy_in_wh: 3000, grid_energy_out_wh: 1500, consumer_energy_wh: solar - 1500,
      fetched_at: now,
    } satisfies TeslaEnergyHistoryEntry)),
    '/tesla/energy-sites/42/charging-history': [{
      id: 1, energy_site_id: 42, din: 'review-connector', timestamp: now,
      energy_wh: 14_000, fetched_at: now,
    }] satisfies TeslaWCChargingEntry[],
    '/analytics/tco': {
      vehicle_id: 7, total_charging_cost: 110, total_wh: 520_000, total_sessions: 11,
      total_km: 1000, first_date: earlier, last_date: now, equivalent_gas_cost: 150,
      total_savings: 40, monthly_savings: 40, cost_per_km_ev: 0.11, cost_per_km_ice: 0.15,
      maintenance_savings_estimate: 20, months_of_ownership: 1, gas_price: 4,
      gas_unit: 'gallon', gas_efficiency_mpg: 25, base_cost_per_kwh: 0.16,
      monthly_breakdown: [{
        month: day.slice(0, 7), ev_cost: 110, equiv_gas_cost: 150,
        savings: 40, cumulative_savings: 40, energy_wh: 520_000,
      }],
    } satisfies CostBreakdown,
    '/analytics/cost-forecast': {
      historical: [
        { month: '2026-07', cost: 100, kwh: 500, sessions: 10, cost_per_kwh: 0.2 },
        { month: '2026-08', cost: 110, kwh: 520, sessions: 11, cost_per_kwh: 0.21 },
      ],
      forecast: [
        { month: '2026-09', cost: 120, cost_low: 100, cost_high: 140, kwh: 560 },
        { month: '2026-10', cost: 130, cost_low: 110, cost_high: 150, kwh: 580 },
      ],
      breakdown: {
        home: { pct: 80, avg_cost_per_kwh: 0.16, monthly_avg: 88 },
        supercharger: { pct: 20, avg_cost_per_kwh: 0.35, monthly_avg: 22 },
      },
      gas_comparison: {
        avg_km_per_month: 1000, gas_cost_per_month: 150, ev_cost_per_month: 110,
        monthly_savings: 40, annual_savings: 480, lifetime_savings: 80,
      },
      insights: ['Home charging accounts for most observed savings.'],
    } satisfies CostForecastData,
    '/api-logs/stats': {
      totalCalls: 1200, errorRate: 0.5, avgDurationMs: 82, last24h: 180, errorCount: 6,
    } satisfies APICallLogStats,
    '/system/health': {
      status: 'healthy', databaseSize: '2.4 GB', tableCount: 42,
      components: Object.fromEntries(['database', 'mqtt', 'tesla_api', 'fleet_telemetry'].map(key => [
        key, { status: 'healthy' as const, consecutiveFailures: 0, lastError: null, details: {} },
      ])),
    } satisfies SystemHealth,
    '/dev-tools/db-stats': {
      tables: [], tableCount: 42, databaseSize: '2.4 GB',
    } satisfies DBStats,
    '/dev-tools/runtime-info': {
      maxOpen: 25, open: 10, inUse: 5, idle: 5, waitCount: 0, waitDurationMs: 0,
    } satisfies ConnectionPool,
    '/telemetry': {
      connected: true, broker: 'mqtt://review-broker:1883', uptime_seconds: 7200,
      topics: ['telemetry/+/v/+'], vehicles: [{
        vin: mockVehicle.vin, vehicle_id: 7, signalCount: 1200, batchCount: 200,
        signalsPerSecond: 3.5, lastReceived: now, is_streaming: true,
      }],
    } satisfies TelemetryStatus,
    '/signals/7/stats': { vehicle_id: 7, count: 1200, oldest: earlier, newest: now },
    '/signals/7/available': { signals: [{ name: 'Soc', unit: '%', type: 'float' }], count: 1 },
    '/signals/7/live': { vehicle_id: 7, signals: { Soc: { value: 72, timestamp: now } }, count: 1 },
    '/signals/catalog': [{
      name: 'Soc', value_type: 'numeric', source_module: 'tesla', unit: '%',
      description: 'Battery state of charge', first_seen_at: earlier, last_seen_at: now,
    }] satisfies SignalCatalogEntry[],
    '/signals/observations': {
      count: 2, total: 2, observations: [
        { vehicle_id: 7, ts: now, field: 'Soc', value_kind: 'ValueKindFloat', value: 72 },
        { vehicle_id: 7, ts: earlier, field: 'Soc', value_kind: 'ValueKindFloat', value: 71 },
      ],
    },
    '/tesla/fleet-telemetry/error-vins': [{
      id: 1, vin: mockVehicle.vin, active: false, first_seen_at: earlier,
      last_seen_at: earlier, resolved_at: now,
    }] satisfies FleetTelemetryErrorVIN[],
    '/tesla/fleet-telemetry/errors': [{
      id: 1, vin: mockVehicle.vin, error_code: 'review_resolved',
      error_message: 'Recovered historical connection interruption',
      reported_at: earlier, tesla_updated_at: now, fetched_at: now,
    }] satisfies FleetTelemetryError[],
  };
  for (const [path, json] of Object.entries(fixtures)) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, mocks, { json });
    });
  }
}
