import { describe, it, expect } from 'vitest';
import {
  normalizeVehicleIdentity,
  normalizeBattery,
  normalizeMaintenance,
  normalizeSoftwareUpdates,
  normalizeWarranty,
  normalizeDrivingHistory,
  normalizeChargingHistory,
  normalizeSecurityIncidents,
} from './evidenceNormalizers';
import type { Vehicle } from '@/types/vehicle';
import type { BatteryPassport } from '@/api/hooks/useBatteryPassport';
import type { MaintenanceItem, ServiceRecord, SoftwareUpdate } from '@/types/vehicle-systems';
import type { Drive, DriveScore, DrivingStats } from '@/types/driving';
import type { ChargingSession } from '@/types/charging';
import type { GuardEvent } from '@/api/hooks/useGuard';

const vehicle: Vehicle = {
  id: 1,
  vehicle_id: 1,
  vin: '5YJ3E1EA7KF123456',
  display_name: 'My Model 3',
  model: 'Model 3',
  trim_badging: 'Long Range',
  exterior_color: 'White',
  wheel_type: 'Aero',
  state: 'online',
  healthy: true,
  created_at: '2022-01-01T00:00:00Z',
  updated_at: '2022-01-01T00:00:00Z',
  latitude: 37.7,
  longitude: -122.4,
};

describe('normalizeVehicleIdentity', () => {
  it('returns null for missing vehicle', () => {
    expect(normalizeVehicleIdentity(null, 'excluded')).toBeNull();
    expect(normalizeVehicleIdentity(undefined, 'excluded')).toBeNull();
  });

  it('never includes latitude/longitude/location fields, even though they exist on Vehicle', () => {
    const evidence = normalizeVehicleIdentity(vehicle, 'full');
    expect(evidence).not.toHaveProperty('latitude');
    expect(evidence).not.toHaveProperty('longitude');
    expect(JSON.stringify(evidence)).not.toContain('37.7');
  });

  it('defaults to VIN excluded, and full/masked only when explicitly selected', () => {
    expect(normalizeVehicleIdentity(vehicle, 'excluded')).toMatchObject({ vin_full: null, vin_masked: null });
    const masked = normalizeVehicleIdentity(vehicle, 'masked');
    expect(masked?.vin_full).toBeNull();
    expect(masked?.vin_masked).not.toBeNull();
    const full = normalizeVehicleIdentity(vehicle, 'full');
    expect(full?.vin_full).toBe(vehicle.vin);
  });

  it('reads the non-sensitive identity fields', () => {
    const evidence = normalizeVehicleIdentity(vehicle, 'excluded');
    expect(evidence).toMatchObject({
      display_name: 'My Model 3',
      model: 'Model 3',
      trim_badging: 'Long Range',
      exterior_color: 'White',
      wheel_type: 'Aero',
    });
  });
});

const passport: BatteryPassport = {
  vehicle_id: 1,
  vin_masked: '5YJ•••••••••3456',
  issued_at: '2024-01-15T10:30:00Z',
  first_observed_at: '2022-06-01T08:00:00Z',
  soh_pct: 94.2,
  capacity_kwh: 72.1,
  original_capacity_kwh: 75,
  equivalent_full_cycles: 210,
  fast_charge_ratio: 0.18,
  avg_charge_limit_pct: 80,
  thermal_exposure: { cold_pct: 10, nominal_pct: 80, hot_pct: 10 },
  health_grade: 'B',
  degradation_trend: [{ date: '2023-01-01', soh_pct: 97 }],
  recommendations: ['Avoid frequent DC fast charging above 80% SoC.'],
  provenance_hash: 'deadbeef',
};

describe('normalizeBattery', () => {
  it('returns null for missing passport', () => {
    expect(normalizeBattery(null, 'day')).toBeNull();
  });

  it('converts kWh to true SI watt-hours by an exact ×1000 multiplication', () => {
    const evidence = normalizeBattery(passport, 'day')!;
    expect(evidence.capacity_wh).toBeCloseTo(72100);
    expect(evidence.original_capacity_wh).toBeCloseTo(75000);
  });

  it('applies date precision to issued_at/first_observed_at/degradation_trend dates', () => {
    const day = normalizeBattery(passport, 'day')!;
    expect(day.issued_at).toBe('2024-01-15');
    expect(day.first_observed_at).toBe('2022-06-01');

    const exact = normalizeBattery(passport, 'exact')!;
    expect(exact.issued_at).toBe('2024-01-15T10:30:00Z');
  });

  it('carries through the provenance hash unchanged (supplementary evidence, not something we redact)', () => {
    expect(normalizeBattery(passport, 'day')!.source_provenance_hash).toBe('deadbeef');
  });
});

describe('normalizeMaintenance', () => {
  const items: MaintenanceItem[] = [
    { id: 'tire-rotation', name: 'Tire Rotation', description: '', intervalKm: 10000, intervalMonths: 12, category: 'tires', estimatedCostUsd: 50 },
  ];
  const records: ServiceRecord[] = [
    { itemId: 'tire-rotation', date: '2023-06-15T00:00:00Z', odometerKm: 15.5, notes: 'Rotated all four tires' },
  ];

  it('returns null when there is no maintenance data at all', () => {
    expect(normalizeMaintenance(undefined, undefined, 'day')).toBeNull();
    expect(normalizeMaintenance([], [], 'day')).toBeNull();
  });

  it('converts odometer km to SI meters by an exact ×1000 multiplication', () => {
    const evidence = normalizeMaintenance(items, records, 'day')!;
    expect(evidence.service_records[0]?.odometer_m).toBeCloseTo(15500);
  });

  it('applies date precision to service record dates', () => {
    const evidence = normalizeMaintenance(items, records, 'day')!;
    expect(evidence.service_records[0]?.date).toBe('2023-06-15');
  });

  it('collects unique, sorted categories from the maintenance schedule', () => {
    const evidence = normalizeMaintenance(items, records, 'day')!;
    expect(evidence.categories).toEqual(['tires']);
  });
});

describe('normalizeSoftwareUpdates', () => {
  const updates: SoftwareUpdate[] = [
    { id: '1', vehicleId: '1', version: '2024.2.1', status: 'installed', installedAt: '2024-02-01T00:00:00Z', scheduledAt: null, createdAt: '2024-02-01T00:00:00Z' },
    { id: '2', vehicleId: '1', version: '2024.5.3', status: 'installed', installedAt: '2024-05-10T00:00:00Z', scheduledAt: null, createdAt: '2024-05-10T00:00:00Z' },
    { id: '3', vehicleId: '1', version: '2024.8.9', status: 'available', installedAt: null, scheduledAt: null, createdAt: '2024-08-01T00:00:00Z' },
  ];

  it('returns null for an empty/missing update list', () => {
    expect(normalizeSoftwareUpdates(undefined)).toBeNull();
    expect(normalizeSoftwareUpdates([])).toBeNull();
  });

  it('identifies the most recently installed version', () => {
    const evidence = normalizeSoftwareUpdates(updates)!;
    expect(evidence.latest_version).toBe('2024.5.3');
    expect(evidence.update_count).toBe(3);
    expect(evidence.installed_versions).toHaveLength(2);
  });
});

describe('normalizeWarranty', () => {
  it('returns null when there is no warranty payload', () => {
    expect(normalizeWarranty(null, 'day')).toBeNull();
    expect(normalizeWarranty({ data: null, fetched_at: null }, 'day')).toBeNull();
  });

  it('scrubs sensitive keys from the opaque warranty payload', () => {
    const evidence = normalizeWarranty(
      { data: { plan: 'Basic', vin: 'should-be-dropped', owner_email: 'x@example.com' }, fetched_at: '2024-01-01T00:00:00Z' },
      'day',
    )!;
    expect(evidence.data).not.toHaveProperty('vin');
    expect(evidence.data).not.toHaveProperty('owner_email');
    expect(evidence.data?.plan).toBe('Basic');
    expect(evidence.fetched_at).toBe('2024-01-01');
  });
});

const drives: Drive[] = [
  {
    id: 1, vehicleId: 1, startTs: '2024-01-05T08:00:00Z', endTs: '2024-01-05T08:30:00Z', durationS: 1800,
    distanceM: 20000, startAddress: '123 Main St', endAddress: '456 Oak Ave', startLat: 37.1, startLon: -122.1,
    endLat: 37.2, endLon: -122.2, startBatteryPct: 80, endBatteryPct: 70, energyUsedWh: 3000, regenEnergyWh: 200,
    avgSpeedMps: 15, maxSpeedMps: 30, avgPowerW: 6000, outsideTempAvgC: 10, insideTempAvgC: 21, score: 85,
    endedStatus: 'completed', createdAt: '2024-01-05T08:30:00Z', updatedAt: '2024-01-05T08:30:00Z',
  },
];
const stats: DrivingStats = {
  totalDrives: 42, totalDistanceKm: 500, totalDurationS: 36000, avgEfficiencyWhKm: 150, avgSpeedKmh: 40,
  topSpeedKmh: 110, regenRatio: 0.12, regenEnergyWh: 9000, co2SavedKg: 120,
};
const score: DriveScore = { overall: 88, efficiency: 90, smoothness: 85, speedDiscipline: 89, grade: 'A', totalDrives: 42, trend: 'up' };

describe('normalizeDrivingHistory', () => {
  it('returns null when there is no driving data', () => {
    expect(normalizeDrivingHistory(undefined, null, null, 'day')).toBeNull();
  });

  it('never includes raw addresses/coordinates/trip paths from Drive[]', () => {
    const evidence = normalizeDrivingHistory(drives, stats, score, 'day');
    const json = JSON.stringify(evidence);
    expect(json).not.toContain('Main St');
    expect(json).not.toContain('Oak Ave');
    expect(json).not.toContain('37.1');
    expect(json).not.toContain('-122.1');
  });

  it('converts total distance km → SI meters by an exact ×1000 multiplication', () => {
    const evidence = normalizeDrivingHistory(drives, stats, score, 'day')!;
    expect(evidence.total_distance_m).toBeCloseTo(500_000);
  });

  it('passes total_duration_s through unchanged (already SI seconds)', () => {
    const evidence = normalizeDrivingHistory(drives, stats, score, 'day')!;
    expect(evidence.total_duration_s).toBe(36000);
  });

  it('derives earliest/latest drive dates from the fetched Drive[] window, at the selected precision', () => {
    const evidence = normalizeDrivingHistory(drives, stats, score, 'day')!;
    expect(evidence.earliest_drive_at).toBe('2024-01-05');
    expect(evidence.latest_drive_at).toBe('2024-01-05');
  });
});

const sessions: ChargingSession[] = [
  {
    id: 's1', vehicle_id: '1', charger_type: 'Tesla Supercharger', start_soc_pct: 20, end_soc_pct: 80,
    total_energy_added_wh: 40000, peak_power_w: 120000, cost_decimal: 12.5, started_at: '2024-02-01T10:00:00Z',
    start_ts: '2024-02-01T10:00:00Z', startedAt: '2024-02-01T10:00:00Z', duration_min: 25, cost: 12.5,
    start_lat: 37.1, start_lng: -122.1, start_place: 'Some Supercharger Site',
  },
  {
    id: 's2', vehicle_id: '1', charger_type: 'AC', start_soc_pct: 40, end_soc_pct: 90,
    total_energy_added_wh: 25000, peak_power_w: 7000, cost_decimal: 3.0, started_at: '2024-03-01T20:00:00Z',
    start_ts: '2024-03-01T20:00:00Z', startedAt: '2024-03-01T20:00:00Z', duration_min: 240, cost: 3.0,
  },
];

describe('normalizeChargingHistory', () => {
  it('returns null for an empty/missing session list', () => {
    expect(normalizeChargingHistory(undefined, 'day')).toBeNull();
    expect(normalizeChargingHistory([], 'day')).toBeNull();
  });

  it('never includes charge-location coordinates or place names', () => {
    const evidence = normalizeChargingHistory(sessions, 'day');
    const json = JSON.stringify(evidence);
    expect(json).not.toContain('37.1');
    expect(json).not.toContain('Some Supercharger Site');
  });

  it('sums total_energy_added_wh directly (already SI watt-hours, no conversion)', () => {
    const evidence = normalizeChargingHistory(sessions, 'day')!;
    expect(evidence.total_energy_added_wh).toBe(65000);
  });

  it('classifies fast-charge sessions from charger_type, not an arbitrary power threshold', () => {
    const evidence = normalizeChargingHistory(sessions, 'day')!;
    expect(evidence.fast_charge_session_count).toBe(1);
  });

  it('averages peak power directly in watts (already SI)', () => {
    const evidence = normalizeChargingHistory(sessions, 'day')!;
    expect(evidence.avg_peak_power_w).toBeCloseTo((120000 + 7000) / 2);
  });
});

const guardEvents: GuardEvent[] = [
  { id: 1, vehicle_id: 1, ts: '2024-04-01T00:00:00Z', event_type: 'geofence_exit', from_state: 'home', to_state: 'away', details: { note: 'left home' }, acknowledged_at: '2024-04-01T01:00:00Z', acknowledged_by: 'user_42' },
  { id: 2, vehicle_id: 1, ts: '2024-05-01T00:00:00Z', event_type: 'geofence_exit', from_state: 'home', to_state: 'away', details: null, acknowledged_at: null, acknowledged_by: null },
];

describe('normalizeSecurityIncidents', () => {
  it('returns null for an empty/missing event list', () => {
    expect(normalizeSecurityIncidents(undefined, 'day')).toBeNull();
    expect(normalizeSecurityIncidents([], 'day')).toBeNull();
  });

  it('never includes the free-form details blob or acknowledged_by identity field', () => {
    const evidence = normalizeSecurityIncidents(guardEvents, 'day');
    const json = JSON.stringify(evidence);
    expect(json).not.toContain('left home');
    expect(json).not.toContain('user_42');
  });

  it('aggregates counts by event type', () => {
    const evidence = normalizeSecurityIncidents(guardEvents, 'day')!;
    expect(evidence.by_type).toEqual([{ event_type: 'geofence_exit', count: 2 }]);
    expect(evidence.observed_event_count).toBe(2);
    expect(evidence.acknowledged_count).toBe(1);
  });
});
