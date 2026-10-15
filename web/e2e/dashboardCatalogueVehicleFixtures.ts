import type { Page } from '@playwright/test';
import type {
  ChargingTelemetry, MotorSnapshot, VehicleConfigSnapshot, VehicleInfoEnvelope, VehicleState,
} from '../src/api/types';
import type { WatchComplication, WatchSummary } from '../src/api/hooks/useWatch';
import type { DrivetrainHealthData, DrivingStats } from '../src/types/driving';
import type { MaintenanceForecast, MaintenanceItem, ServiceRecord, SoftwareUpdate } from '../src/types/vehicle-systems';
import { fulfillApiFixture, type MockApiController } from './mockApi';

export const compactVehicleReadings: Record<string, RegExp> = {
  // Compact contracts expose counts, not the product names shown in expanded cards.
  subscriptions: /active\s*1/,
  'vehicle-upgrades': /available\s*1/,
};

export const vehicleReadings: Record<string, RegExp> = {
  'vehicle-hero': /72/,
  'vehicle-hero-card': /72/,
  'vehicle-twin': /Locked/,
  'digital-twin-mini': /Locked/,
  'software-update-status': /2026\.26\.3/,
  'software-update-history': /2026\.26\.3/,
  'odometer-counter': /32,100/,
  'drivetrain-health': /(?:Healthy|65)/,
  'motor-performance': /240/,
  'motor-history': /240/,
  'vehicle-specs': /Long Range/,
  'watch-summary': /72/,
  'maintenance-tracker': /Review tire rotation/,
  'warranty-status': /Active/,
  subscriptions: /Premium Connectivity/,
  'vehicle-upgrades': /Acceleration Boost/,
};

export async function installCatalogueVehicleSources(page: Page, mocks: MockApiController, chargingMode = false) {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 3_600_000).toISOString();
  const motor: MotorSnapshot = {
    id: 1, vehicle_id: 7, ts: now, created_at: now, di_torque: 240, di_stator_temp: 65,
    torque_nm_front: 100, torque_nm_rear: 140, motor_rpm_front: 3200, motor_rpm_rear: 3200,
    motor_temp_c_front: 65, motor_temp_c_rear: 60, inverter_temp_c: 45, inverter_temp_rear: 44,
    heatsink_temp_front: 42, heatsink_temp_rear: 41, motor_current_front: 100,
    motor_current_rear: 120, state_front: 'Drive', state_rear: 'Drive',
    shift_state: 'D', gear: 'D', vbat_front: 390, vbat_rear: 390,
  };
  const charging: ChargingTelemetry = {
    vehicle_id: 7, session_id: 201, ts: now, source: 'telemetry', battery_level: 72,
    battery_range_mi: null, charging_state: chargingMode ? 'Charging' : 'Disconnected', charger_voltage: 240,
    charger_actual_current: 32, charger_power_w: 7680, charger_phases: 1,
    charge_energy_added_wh: 12_000, range_added_meters: 50_000,
    range_added_meters_per_hour: 30_000, charger_pilot_current: 32, scheduled_charging_at: null,
  };
  const config: VehicleConfigSnapshot = {
    id: 1, vehicle_id: 7, created_at: now, car_type: 'Model Y', trim: 'Long Range',
    exterior_color: 'Pearl White', wheel_type: 'Gemini', version: '2026.26.3',
    software_update_version: '2026.32.1', software_update_download_pct: 45,
    software_update_install_pct: 0,
  };
  const envelope = (data: Record<string, unknown>): VehicleInfoEnvelope<Record<string, unknown>> => ({
    data, fetched_at: now,
  });
  const fixtures: Record<string, unknown> = {
    '/motor/latest': motor,
    '/motor': [{ ...motor, ts: earlier, created_at: earlier, di_torque: 180 }, motor],
    '/charging-telemetry/latest': charging,
    '/vehicle-config/latest': config,
    '/software-updates': [{
      id: '1', vehicleId: '7', version: '2026.26.3', status: 'installed',
      installedAt: now, scheduledAt: null, createdAt: earlier,
    }] satisfies SoftwareUpdate[],
    '/drivetrain/health': {
      frontMotorTempC: 65, rearMotorTempC: 60, inverterTempC: 45,
      batteryTempC: 28, motorStatus: 'Drive', overallHealth: 'good',
    } satisfies DrivetrainHealthData,
    '/drives/stats': {
      totalDrives: 20, totalDistanceKm: 600, totalDurationS: 36_000,
      avgEfficiencyWhKm: 160, avgSpeedKmh: 60, topSpeedKmh: 100,
      regenRatio: 0.2, regenEnergyWh: 12_000, co2SavedKg: 42,
    } satisfies DrivingStats,
    '/vehicles/7/specs': envelope({
      car_type: 'Model Y', trim_badging: 'Long Range', exterior_color: 'Pearl White',
      wheel_type: 'Gemini', interior: 'All Black', aux_battery_type: 'Li-Ion',
    }),
    '/vehicles/7/options': envelope({ options: [{ code: 'AD15', name: 'Autopilot' }] }),
    '/vehicles/7/subscriptions': envelope({
      subscriptions: [{ name: 'Premium Connectivity', active: true, expiry_date: '2027-12-31' }],
    }),
    '/vehicles/7/upgrades': envelope({
      upgrades: [{ name: 'Acceleration Boost', price: 2000, description: 'Performance upgrade', eligible: true }],
    }),
    '/vehicles/7/warranty': envelope({
      warranty_expiry_date: '2028-12-31', basic: { expiry_date: '2028-12-31' },
      battery_drive_unit: { expiry_date: '2032-12-31' },
    }),
    // No share links were created for this synthetic drive; this is the actual empty-list contract.
    '/drives/101/shares': [],
    '/watch/summary': {
      vehicle_name: 'Aurora', state: 'online', battery_level: 72, range_km: 410,
      is_charging: false, charge_rate: 0, time_to_full: 0, is_locked: true,
      sentry_mode: true, inside_temp_c: 21, outside_temp_c: 18, is_climate_on: false,
      last_updated: now,
    } satisfies WatchSummary,
    '/watch/complication': {
      battery: '72%', range: '410 km', state: 'online', charging: false,
    } satisfies WatchComplication,
    '/maintenance': [{
      id: 'rotation', name: 'Review tire rotation', description: 'Rotate tires',
      intervalKm: 10_000, intervalMonths: 6, category: 'tires', estimatedCostUsd: 60,
    }] satisfies MaintenanceItem[],
    '/maintenance/records': [{
      itemId: 'rotation', date: earlier, odometerKm: 30_000, notes: 'Rotation completed',
    }] satisfies ServiceRecord[],
    '/maintenance/forecast': {
      vehicle_id: 7, odometer_km: 32_100, km_per_day: 40,
      due_soon_count: 1, overdue_count: 0, items: [{
        name: 'Review tire rotation', category: 'tires', description: 'Rotate tires',
        due_date: '2026-11-01', km_remaining: 2000, status: 'due_soon', basis: 'observed mileage',
      }],
    } satisfies MaintenanceForecast,
  };
  if (chargingMode) {
    const state: VehicleState = {
      vehicle_id: 7, state: 'charging', latitude: 37.4, longitude: -122.1, speed: 0,
      power: -7680, battery_level: 72, rated_range: 410_000, ideal_range: 430_000,
      odometer: 32_100_000, inside_temp: 21, outside_temp: 18, is_climate_on: false,
      is_charging: true, charger_power: 7680, charge_rate: 30_000, time_to_full_charge: 3600,
      is_locked: true, sentry_mode: true, software_version: '2026.26.3',
    };
    fixtures['/vehicles/7/state'] = {
      state: { ...state, timestamp: now, updated_at: now }, live: true,
      observed_at: now, freshness: 'fresh', verified_fields: Object.keys(state),
    };
  }
  for (const [path, json] of Object.entries(fixtures)) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, mocks, { json });
    });
  }
}
