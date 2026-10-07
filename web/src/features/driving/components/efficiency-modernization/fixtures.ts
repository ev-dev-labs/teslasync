import type { Drive, DrivingStats } from '@/types/driving';
import type { UseUnitsResult } from '@/hooks/useUnits';
import type { DataStateSource } from '@/api/dataState';
import {
  formatDistance, formatSpeed, formatTemperature, formatPressure,
  formatEnergy, formatDuration, formatPower,
} from '@/lib/unitConversion';

/** Typed source fixtures for parent-run regressions, not production fallback data. */
export function fakeQuery<T>(data?: T, overrides: Partial<DataStateSource<T>> = {}): DataStateSource<T> {
  return { data, error: null, isLoading: false, isSuccess: data !== undefined,
    isFetching: false, isStale: false, fetchStatus: 'idle', dataUpdatedAt: 1,
    refetch: () => undefined, ...overrides };
}
export function fakeStats(overrides: Partial<DrivingStats> = {}): DrivingStats {
  return { totalDrives: 42, totalDistanceKm: 5000, totalDurationS: 360000,
    avgEfficiencyWhKm: 200, avgSpeedKmh: 60, topSpeedKmh: 120, regenRatio: 0.5,
    regenEnergyWh: 12000, co2SavedKg: 300, ...overrides };
}
export function fakeDrive(overrides: Partial<Drive> = {}): Drive {
  const date = '2026-10-02T12:00:00Z';
  return { id: 1, vehicleId: 1, startTs: date, endTs: date, durationS: 3600,
    distanceM: 50000, startAddress: null, endAddress: null,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 60, endBatteryPct: 50, energyUsedWh: 7500, regenEnergyWh: 500,
    avgSpeedMps: 20, maxSpeedMps: 30, avgPowerW: 12000,
    outsideTempAvgC: 25, insideTempAvgC: 21, score: 90, endedStatus: 'parked',
    createdAt: date, updatedAt: date, ...overrides };
}
export function fakeUnits(miles = false, precision = 2, locale = 'en-US'): UseUnitsResult {
  const unitPrefs: UseUnitsResult['unitPrefs'] = {
    distance: miles ? 'mi' : 'km', speed: miles ? 'mph' : 'km/h',
    temperature: miles ? '°F' : '°C', pressure: 'bar', energy: 'kWh',
    duration: 'h', power: 'kW', precision, locale,
  };
  return { unitPrefs,
    formatDistance: (v, o) => formatDistance(v, unitPrefs, o),
    formatSpeed: (v, o) => formatSpeed(v, unitPrefs, o),
    formatTemperature: (v, o) => formatTemperature(v, unitPrefs, o),
    formatPressure: (v, o) => formatPressure(v, unitPrefs, o),
    formatEnergy: (v, o) => formatEnergy(v, unitPrefs, o),
    formatDuration: (v, o) => formatDuration(v, unitPrefs, o),
    formatPower: (v, o) => formatPower(v, unitPrefs, o),
  };
}
