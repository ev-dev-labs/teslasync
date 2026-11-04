import type { ChargeTelemetryReading, GasPriceHistory, GasPriceStatus, GeofenceRate, PhysicsLedger, VisitedPlaceCandidate } from '../src/api/types';
import type { PollingConfig } from '../src/api/hooks/useSettings';
import type { WaitOracleForecast } from '../src/api/hooks/useCharging';
import type { FsdHeartbeat, PhysicsCockpit } from '../src/types/teslaPhysics';
import { measuredSession, unavailableChargePhysics, unavailableChargeLedger } from './operationalbrief-contracts/charging.fixtures';
import { tireForecast } from './operationalbrief-contracts/specialized.fixtures';
import { passportVerification, park, solarAdvice } from './operationalbrief-contracts/battery.fixtures';
import { journeyReport, checklist } from './operationalbrief-contracts/trips.fixtures';
import { fleetOpsFixtures } from './operationalbrief-contracts/fleet-ops.fixtures';
import { maintenanceItems, serviceRecords } from './operationalbrief-contracts/vehicle-systems.fixtures';
import { resaleCertificate } from './operationalbrief-contracts/specialized-resale.supported.fixtures';
import { catalogueLiveStatus } from './dashboardWidgetFixtures';
import { catalogueWire } from './dashboardCatalogueRemainingSources';

const now = '2026-08-26T16:00:00.000Z';
const earlier = '2026-08-26T15:00:00.000Z';
const honesty = 'Synthetic bounded local observations; missing measurements remain unknown.';
const fleet = fleetOpsFixtures();
const gas = {
  enabled: false, poll_interval: '24h', last_poll_time: now,
  current_price: 4, current_price_kwh_eq: 0.3, current_price_unit: 'gallon',
} satisfies GasPriceStatus;
const gasHistory = [{
  id: 1, price_per_unit: 4, unit: 'gallon', efficiency_mpg: 25,
  effective_from: earlier, effective_to: null, created_at: earlier,
}] satisfies GasPriceHistory[];
const candidates = [{
  id: 1, name: 'Synthetic local charger', latitude: 0, longitude: 0,
  visit_count: 1, charge_count: 1, last_visited: now, first_charge_at: earlier,
}] satisfies VisitedPlaceCandidate[];
const rates = [{
  id: 1, geofence_id: 1, rate_per_wh: 0.00016, currency: 'USD',
  effective_from: earlier, effective_to: null, created_at: earlier,
}] satisfies GeofenceRate[];
const polling = {
  auto_polling_enabled: false, fleet_endpoints: {}, auto_endpoints: {}, endpoint_catalog: [],
  vehicle_discovery: false, charge_state: false, climate_state: false,
  drive_state: false, location_data: false, vehicle_state: false, vehicle_config: false,
  on_demand_vehicle_discovery: false, on_demand_charge_state: false,
  on_demand_climate_state: false, on_demand_drive_state: false, on_demand_location_data: false,
  on_demand_vehicle_state: false, on_demand_vehicle_config: false,
  nearby_charging_sites: false, release_notes: false, recent_alerts: false,
  service_data: false, wake_up: false, commands: false, telemetry_capture: false,
  telemetry_capture_retention_days: 7,
} satisfies PollingConfig;
const forecast = {
  site: 'Synthetic local charger', arrive_at: now, expected_wait_s: 0,
  wait_probability_pct: 0, busyness: 0, verdict: 'quiet', confidence: 'low',
  stalls_estimated: 1, best_hour: 1, best_wait_s: 0, save_s: 0,
  hours: Array.from({ length: 24 }, (_, hour) => ({ hour, expected_wait_s: 0, busyness: 0 })),
  evidence: ['Synthetic forecast from a single recorded session.'],
} satisfies WaitOracleForecast;
const heartbeat = {
  vehicle_id: 7, fsd_distance_m: 0, driving_distance_m: 12000,
  last_tick_at: now, gear: 'P', speed_mps: 0, valet_mode: false, service_mode: false,
  firmware_version: '2026.26.3', label: 'Synthetic bounded counter observation', honesty,
} satisfies FsdHeartbeat;
const cockpit = {
  vehicle_id: 7, gear: 'P', charge_state: 'Disconnected', detailed_charge_state: 'Disconnected',
  charge_port_latch: 'Disengaged', charge_port_door_open: false,
  battery_level_pct: 70, energy_remaining_wh: 60000, pack_current_a: 0, pack_voltage_v: 400,
  fsd_distance_m: 0, driving_distance_m: 12000, speed_mps: 0,
  sentry_mode: 'Off', valet_mode: false, service_mode: false, park, honesty,
} satisfies PhysicsCockpit;
const ledger = {
  vehicle_id: 7, kind: 'drive', start: earlier, end: now, dynamics: null,
  drive: null, charge: null, park: null, thermal: null,
  range: {
    rated_m: 400000, est_m: 380000, ideal_m: 420000, energy_wh: 60000,
    implied_wh_per_m: null, spread_m: 40000, disagree: true, unknown: false, honesty,
  },
  tires: { fl_kpa: 285, fr_kpa: 286, rl_kpa: 287, rr_kpa: 288, imbalance_kpa: 3, unknown: false, honesty },
  epochs: [], unknown_intervals: [], unknown_hours: 0, black_box: [],
  truncated: false, missing_signals: ['PackPower'], honesty,
} satisfies PhysicsLedger;
const live = { ...catalogueLiveStatus(now), energy_site_id: 1 };

export const cardLayoutDownstreamSources: Record<string, unknown> = {
  '/vehicles/7/rul/tires': tireForecast,
  '/charging/201': catalogueWire(measuredSession),
  '/charging/201/telemetry': [] satisfies ChargeTelemetryReading[],
  '/charging/201/shares': [],
  '/physics/charging/201': unavailableChargePhysics,
  '/physics/charging/201/ledger': unavailableChargeLedger,
  '/journey/sessions/701/report': journeyReport,
  '/journey/sessions/701/checklist': checklist,
  '/waitoracle/forecast': forecast,
  '/vehicles/7/battery-passport/verify': passportVerification,
  '/settings/polling-config': polling,
  '/fleet-ops/drivers': fleet.drivers,
  '/fleet-ops/assignments': fleet.assignments,
  '/fleet-ops/reservations': fleet.reservations,
  '/fleet-ops/cost-centers': fleet.costCenters,
  '/fleet-ops/charging-policies': fleet.policies,
  '/fleet-ops/utilization-forecast': fleet.forecast,
  '/gas-price/status': gas,
  '/gas-price/history': gasHistory,
  '/physics/cockpit': cockpit,
  '/physics/heartbeat': heartbeat,
  '/geofences/visited-candidates': candidates,
  '/geofences/needs-review': [],
  '/geofences/rates/current': rates,
  '/tesla/energy-sites/1/charge-advice': solarAdvice,
  '/tesla/energy-sites/1/live-status': live,
  '/tesla/energy-sites/1/live-status/history': [{ ...live, timestamp: earlier }, live],
  '/physics/ledger': ledger,
  '/maintenance': maintenanceItems,
  '/maintenance/records': serviceRecords,
  '/analytics/battery-health/certificate': resaleCertificate,
};
