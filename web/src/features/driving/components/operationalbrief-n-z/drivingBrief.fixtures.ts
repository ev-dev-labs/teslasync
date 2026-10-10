import type { Drive } from '@/types/driving';

export function makeBriefDrive(id: number, distanceM = 1000, overrides: Partial<Drive> = {}): Drive {
  return {
    id, vehicleId: 7, startTs: '2026-07-01T08:00:00Z', endTs: '2026-07-01T08:30:00Z',
    durationS: 1800, distanceM, startAddress: 'Home', endAddress: 'Office',
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 80, endBatteryPct: 75, energyUsedWh: 200, regenEnergyWh: 30,
    avgSpeedMps: 15, maxSpeedMps: 30, avgPowerW: 1000,
    outsideTempAvgC: 18, insideTempAvgC: 21, score: null, endedStatus: null,
    createdAt: '2026-07-01T08:30:00Z', updatedAt: '2026-07-01T08:30:00Z',
    ...overrides,
  };
}
