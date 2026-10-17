import type { Vehicle } from '../../src/types/vehicle';
import type { VehicleState } from '../../src/api/types';
import type {
  TeslaEnergyHistoryEntry, TeslaEnergyLiveStatus, TeslaEnergySite, TeslaEnergySiteInfoResponse,
} from '../../src/types/energy';
import type { OrchestrationScenario } from '../../src/features/home-energy/hooks/useOrchestrationScenario';
import type { OrchestrationInput } from '../../src/features/home-energy/lib/types';
import {
  DEFAULT_GRID_SCENARIO, DEFAULT_POWERWALL_SCENARIO, DEFAULT_TARIFF_SCENARIO,
  DEFAULT_VEHICLE_ASSUMPTION, buildTariffSeries, defaultDepartureSlot,
} from '../../src/features/home-energy/lib/scenarioDefaults';
import { buildLoadForecast, buildSolarForecast } from '../../src/features/home-energy/lib/forecastAdapters';
import { optimizeHomeEnergy } from '../../src/features/home-energy/lib/optimizer';

export const HOME_ANCHOR = '2026-06-02T12:00:00.000Z';
export const HOME_REANCHOR = '2026-06-02T12:15:00.000Z';
export const HOME_SCENARIO_KEY = 'teslasync:home-energy-orchestrator:scenario:v1';
export const HOME_SITE_ID = 42;

export const homeVehicles: Vehicle[] = [{
  id: 7, vehicle_id: 7, vin: '5YJMOCK0000000001', display_name: 'Aurora',
  model: 'Model Y', trim_badging: 'Long Range', exterior_color: 'Pearl White',
  wheel_type: 'Gemini', state: 'online', healthy: true, timezone: 'UTC',
  battery_level: 50, created_at: HOME_ANCHOR, updated_at: HOME_ANCHOR,
}];

export const homeVehicleState: VehicleState = {
  vehicle_id: 7, state: 'online', latitude: 37.4, longitude: -122.1,
  speed: 0, power: 0, battery_level: 30, rated_range: 180_000, ideal_range: 190_000,
  odometer: 32_100_000, inside_temp: 21, outside_temp: 18,
  is_climate_on: false, is_charging: false, charger_power: 0, charge_rate: 0,
  time_to_full_charge: 0, is_locked: true, sentry_mode: false, software_version: 'fixture',
};

// useFleetStates now reads the authoritative batch, not one request per vehicle.
export const homeFleetStates = {
  data: {
    now: HOME_ANCHOR, total: 1, limit: 500, offset: 0,
    counts: { resolved: 1, missing: 0, failed: 0 },
    vehicles: [{
      vehicle_id: 7, outcome: 'resolved', state: homeVehicleState,
      live: true, data_source: 'signal_store', observed_at: HOME_ANCHOR,
      freshness: 'fresh', verified_fields: ['state', 'battery_level'],
    }],
  },
};

const selectedSite: TeslaEnergySite = {
  id: 2, energy_site_id: HOME_SITE_ID, resource_type: 'battery',
  site_name: 'Supported solar home', gateway_id: null, total_pack_energy: 13_500,
  percentage_charged: 50, battery_type: 'ac_powerwall', backup_capable: true,
  storm_mode_enabled: false, has_solar: true, has_battery: true, has_grid: true,
  has_load_meter: true, tou_capable: true, storm_mode_capable: true,
  fetched_at: HOME_ANCHOR, created_at: HOME_ANCHOR, updated_at: HOME_ANCHOR,
  site_info_fetched_at: HOME_ANCHOR,
};
export const homeSites: TeslaEnergySite[] = [
  { ...selectedSite, id: 1, energy_site_id: 41, site_name: 'Grid-only sibling',
    has_solar: false, has_battery: false },
  selectedSite,
];
export const homeSiteInfo: TeslaEnergySiteInfoResponse = {
  data: { site_name: selectedSite.site_name, installation_time_zone: 'UTC',
    time_zone_offset: 0, battery_count: 1, nameplate_energy: 13_500,
    nameplate_power: 5_000, components: { solar: true, battery: true, grid: true } },
  fetched_at: HOME_ANCHOR,
};
export const homeLiveStatus: TeslaEnergyLiveStatus = {
  id: 1, energy_site_id: HOME_SITE_ID, solar_power: 6_000, battery_power: 0,
  load_power: 200, grid_power: -5_800, grid_services_power: 0,
  energy_left: 8_100, total_pack_energy: 13_500, percentage_charged: 60,
  grid_status: 'Active', backup_capable: true, storm_mode_active: false,
  timestamp: HOME_ANCHOR, fetched_at: HOME_ANCHOR,
};

// forecastAdapters.test.ts:22–31: interval Wh = average W × five minutes.
export const homeHistory: TeslaEnergyHistoryEntry[] = Array.from({ length: 288 }, (_, index) => {
  const minute = index * 5;
  const hour = minute / 60;
  const solarW = hour >= 6 && hour <= 18
    ? Math.max(0, 6_000 * Math.sin(((hour - 6) / 12) * Math.PI)) : 0;
  const timestamp = new Date(Date.parse('2026-06-01T00:00:00.000Z') + minute * 60_000).toISOString();
  return {
    id: index + 1, energy_site_id: HOME_SITE_ID, period: 'day', timestamp,
    solar_energy_wh: solarW * (5 / 60), consumer_energy_wh: 200 * (5 / 60),
    battery_energy_in_wh: null, battery_energy_out_wh: null,
    grid_energy_in_wh: null, grid_energy_out_wh: null, fetched_at: HOME_ANCHOR,
  };
});

export function homeScenario(): OrchestrationScenario {
  return {
    slotMinutes: 15, horizonHours: 24, tariff: { ...DEFAULT_TARIFF_SCENARIO },
    grid: { ...DEFAULT_GRID_SCENARIO },
    powerwall: { ...DEFAULT_POWERWALL_SCENARIO, enabled: true },
    vehicleAssumptions: {}, weights: {}, previousPlan: {},
  };
}

/** Exact public producer expectations; neither golden invented values nor UI-string parsing. */
export function expectedHomePlan(
  scenario: OrchestrationScenario,
  startTimeIso = HOME_ANCHOR,
  history: TeslaEnergyHistoryEntry[] = homeHistory,
) {
  const horizonSlots = Math.max(1, Math.round(scenario.horizonHours * 60 / scenario.slotMinutes));
  const options = { startTimeIso, slotMinutes: scenario.slotMinutes, horizonSlots };
  const solar = buildSolarForecast(history, options);
  const load = buildLoadForecast(history, options);
  const assumption = scenario.vehicleAssumptions['7'] ?? DEFAULT_VEHICLE_ASSUMPTION;
  const input: OrchestrationInput = {
    ...options,
    vehicles: [{
      id: '7', name: homeVehicles[0].display_name, currentSocPct: homeVehicleState.battery_level,
      targetSocPct: assumption.targetSocPct, usableCapacityWh: assumption.usableCapacityWh,
      maxChargePowerW: assumption.maxChargePowerW, priority: assumption.priority,
      departureSlot: assumption.hasDeadline
        ? defaultDepartureSlot(assumption.departureHour, startTimeIso, scenario.slotMinutes, horizonSlots) : null,
    }],
    solarForecastW: solar.seriesW, loadForecastW: load.seriesW,
    tariff: buildTariffSeries(scenario.tariff, startTimeIso, scenario.slotMinutes, horizonSlots),
    powerwall: scenario.powerwall.enabled ? {
      capacityWh: scenario.powerwall.capacityWh,
      currentSocPct: homeLiveStatus.percentage_charged ?? 50,
      reservePct: scenario.powerwall.reservePct,
      maxChargePowerW: scenario.powerwall.maxChargePowerW,
      maxDischargePowerW: scenario.powerwall.maxDischargePowerW,
      roundTripEfficiency: scenario.powerwall.roundTripEfficiency,
    } : null,
    grid: { ...scenario.grid }, weights: scenario.weights, previousPlan: scenario.previousPlan,
  };
  return { input, result: optimizeHomeEnergy(input), solar, load };
}
