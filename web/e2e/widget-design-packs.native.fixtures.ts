import type { MaintenanceItem } from '../src/api/hooks/useMaintenance';
import type { LifetimeStats } from '../src/api/hooks/useAnalytics';
import type { VehicleStateReadings } from '../src/api/types';
import type { OrchestrationScenario } from '../src/features/home-energy/hooks/useOrchestrationScenario';
import { maintenanceItems } from './operationalbrief-contracts/vehicle-systems.fixtures';
import { mockDrive, mockVehicle } from './mockApi';
import { specializedDrives, specializedHistory } from './widget-design-packs.specialized.fixtures';

// Explicitly synthetic acceptance inputs. No achieved/readiness/trust result is
// injected: the real source adapters, optimizer and milestone model derive it.
export const nativeReviewClock = '2026-11-10T18:00:00.000Z';
export const nativeWidgets = [
  ['mileage-stats', 'Mileage stats'], ['onboarding-checklist', 'Get started'],
  ['signal-health', 'Signal source coverage'],
] as const;
export const nativeVehicles = [
  { ...mockVehicle, display_name: 'Synthetic ready vehicle', battery_level: 90 },
  { ...mockVehicle, id: 8, vehicle_id: 8, vin: '5YJMOCK0000000002',
    display_name: 'Synthetic deadline vehicle', battery_level: 25.5 },
];
// Exact existing driveDetailFixtures aggregate wire shape and SI boundaries.
export const nativeDrivingStats = {
  total_drives: 1, total_distance_km: mockDrive.distance_m / 1000,
  total_duration_s: mockDrive.duration_s,
  avg_efficiency_wh_km: mockDrive.energy_used_wh / (mockDrive.distance_m / 1000),
  avg_speed_kmh: mockDrive.avg_speed_mps * 3.6,
  top_speed_kmh: mockDrive.max_speed_mps * 3.6,
  regen_ratio: mockDrive.regen_energy_wh / mockDrive.energy_used_wh,
  regen_energy_wh: mockDrive.regen_energy_wh, co2_saved_kg: 0,
};

export function nativeState(
  vehicleId: number, batteryLevel: number | null,
): Partial<VehicleStateReadings> & { timestamp: string } {
  return {
    vehicle_id: vehicleId, state: 'parked', battery_level: batteryLevel,
    rated_range: 180_000, ideal_range: 200_000, odometer: 12_000_000,
    speed: 0, power: 0, inside_temp: 20, outside_temp: 0,
    is_charging: false, is_locked: true, timestamp: nativeReviewClock,
  };
}

export const nativeScenario: OrchestrationScenario = {
  slotMinutes: 15, horizonHours: 2,
  tariff: { importPeakPerKwh: 0.42, importOffPeakPerKwh: 0.14,
    exportPerKwh: 0.08, peakStartHour: 16, peakEndHour: 21 },
  grid: { maxImportW: 11_500, maxExportW: 0 },
  powerwall: { enabled: false, capacityWh: 13_500, reservePct: 20,
    maxChargePowerW: 5000, maxDischargePowerW: 5000, roundTripEfficiency: 0.9 },
  vehicleAssumptions: {
    '7': { targetSocPct: 80, usableCapacityWh: 75_000, maxChargePowerW: 7400,
      departureHour: 18, hasDeadline: false, priority: 'medium' },
    // At the frozen clock this is slot ZERO, not a null/no-deadline value.
    '8': { targetSocPct: 90, usableCapacityWh: 75_000, maxChargePowerW: 7400,
      departureHour: 18, hasDeadline: true, priority: 'high' },
  },
  weights: {}, previousPlan: {},
};

// Preserve the raw legacy field names and their SI-metre meanings. The
// reviewed full schedule is extended, not replaced with a reduced second DTO.
const serviceBase = maintenanceItems[0];
export const nativeMaintenance: MaintenanceItem[] = [
  ...maintenanceItems,
  { ...serviceBase, id: 803, name: 'Synthetic zero service',
    current_mileage: 0, last_service_mileage: 0, interval_miles: 1_000_000 },
  { ...serviceBase, id: 804, name: 'Synthetic middle service',
    current_mileage: 500_000, last_service_mileage: 0, interval_miles: 1_000_000 },
  { ...serviceBase, id: 805, name: 'Synthetic overdue service',
    current_mileage: 1_500_000, last_service_mileage: 0, interval_miles: 1_000_000 },
  { ...serviceBase, id: 806, name: 'Synthetic completed service',
    status: 'completed', current_mileage: 500_000, last_service_mileage: 0,
    interval_miles: 1_000_000 },
];
export const nativeMilestoneDrives = Array.from({ length: 5 }, (_, index) => {
  const start = `2026-11-${String(1 + index * 2).padStart(2, '0')}T12:00:00.000Z`;
  return { ...specializedDrives[0], id: 901 + index, start_ts: start,
    end_ts: start.replace('12:00', '12:30'), distance_m: 25_000,
    duration_s: 1800, created_at: start, updated_at: start };
});
export const nativeCalibrationKey = `teslasync:milestones-base-km:v2:vehicle:7:origin:${Date.parse(nativeMilestoneDrives[0].start_ts)}:901`;

type AchievementWire = Omit<LifetimeStats['achievements'][number], 'progress'> & {
  progress: number | null;
};
export const nativeAchievements: AchievementWire[] = [
  { id: 'first-drive', name: 'First drive', description: 'Synthetic unlocked record',
    icon: '🚗', unlocked: true, unlocked_at: nativeReviewClock, progress: 1, target: 1, current: 1 },
  { id: 'native-half', name: 'Synthetic half achievement', description: 'Synthetic locked record',
    icon: '◐', unlocked: false, unlocked_at: null, progress: 0.5, target: 10, current: 5 },
  { id: 'native-near', name: 'Synthetic near achievement', description: 'Synthetic near-complete record',
    icon: '◕', unlocked: false, unlocked_at: null, progress: 0.85, target: 100, current: 85 },
  { id: 'native-negative', name: 'Synthetic negative achievement', description: 'Synthetic defensive input',
    icon: '○', unlocked: false, unlocked_at: null, progress: -0.5, target: 100, current: 0 },
  { id: 'native-over', name: 'Synthetic over-range achievement', description: 'Synthetic defensive input',
    icon: '●', unlocked: false, unlocked_at: null, progress: 1.4, target: 100, current: 140 },
  { id: 'native-null', name: '', description: 'Synthetic missing achievement name and progress',
    icon: '', unlocked: false, unlocked_at: null, progress: null, target: 100, current: 0 },
];

export const nativeSignalNames = { numeric: 'BatteryLevel', boolean: 'IsLocked', text: 'VehicleName' } as const;
export const nativeAvailable = {
  vehicle_id: 7, count: 3, source: 'protomodel',
  signals: Object.entries(nativeSignalNames).map(([type, name]) => ({
    name, category: 'Vehicle', value_kind: type === 'numeric'
      ? 'ValueKindDouble' : type === 'boolean' ? 'ValueKindBool' : 'ValueKindString',
    unit_kind: 'UnitKindNone', is_compound: false, is_setting_unit: false,
  })),
};
export function nativeSignalHistory(name: string, count = 4) {
  const original = specializedHistory(name);
  return { ...original, from: '2026-11-10T17:00:00.000Z', to: nativeReviewClock, count,
    data: original.data.slice(0, count).map((point, index) => ({
      ...point, ts: new Date(Date.parse(nativeReviewClock) - (4 - index) * 60_000).toISOString(),
      kind: name === nativeSignalNames.boolean ? 'ValueKindBool' : 'ValueKindDouble',
      value: name === nativeSignalNames.boolean ? index % 2 === 0 : [50, 52, 49, 55][index],
    })) };
}

export type NativeLiveMode = 'stale' | 'fresh' | 'empty' | 'zero' | 'missing-timestamp';
export function nativeLive(mode: NativeLiveMode = 'stale') {
  const entry = (ageMs: number, value: number | boolean = 0) => {
    const timestamp = new Date(Date.parse(nativeReviewClock) - ageMs).toISOString();
    return { kind: typeof value === 'boolean' ? 'ValueKindBool' : 'ValueKindDouble',
      value, ts: timestamp, timestamp, source: ageMs < 30_000 ? 'l1' : 'stale', age_ms: ageMs };
  };
  // Both timestamp aliases are emitted by signalinspect.buildLiveEntry.
  // The missing-timestamp case is an explicit defensive/partial wire input,
  // not a claim that the current Go producer emits nullable timestamps.
  const signals: Record<string, unknown> = mode === 'empty' ? {}
    : mode === 'fresh'
      ? { BatteryLevel: entry(1000, 90), IsLocked: entry(2000, true) }
      : mode === 'zero'
        ? { BatteryLevel: entry(3_600_000, 0) }
        : mode === 'missing-timestamp'
          ? { BatteryLevel: entry(1000, 90), SyntheticMissingTimestamp: { value: null } }
          : { BatteryLevel: entry(1000, 90), ...Object.fromEntries(
            Array.from({ length: 6 }, (_, index) => [
              `SyntheticLongStaleSignalForRankedRecordAcceptance${index + 1}`,
              entry((index + 1) * 3_600_000, index),
            ])) };
  return { vehicle_id: 7, at: nativeReviewClock, count: Object.keys(signals).length, signals };
}
