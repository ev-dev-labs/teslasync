import type { DriveDetail } from '@/types/driving';
import type { ChartDataPoint, DriveStats } from './types';

export function driveFixture(over: Partial<DriveDetail> = {}): DriveDetail {
  return {
    id: 412, vehicleId: 7, startTs: '2026-09-01T10:00:00Z', endTs: '2026-09-01T10:30:00Z',
    durationS: 1800, distanceM: 40000, startAddress: 'Home', endAddress: 'Office',
    startLat: 0, startLon: 10, endLat: 1, endLon: 11, startBatteryPct: 80, endBatteryPct: 70,
    energyUsedWh: 8000, regenEnergyWh: 1000, avgSpeedMps: 20, maxSpeedMps: 30,
    avgPowerW: 16000, outsideTempAvgC: null, insideTempAvgC: null,
    score: null, endedStatus: 'parked', createdAt: '', updatedAt: '', telemetry: [], positions: [], ...over,
  };
}

export function statsFixture(over: Partial<DriveStats> = {}): DriveStats {
  return {
    maxSpd: 108, avgSpd: 72, minSpd: 12, powerMax: 100, powerMin: -20, avgPower: 16,
    energyWh: 8000, regenWh: 1000, consumptionWhKm: 200, elevGain: 20, elevLoss: 10,
    avgOutsideTemp: null, avgInsideTemp: null, hasAnyTemp: false,
    insideTemps: [], outsideTemps: [], driverTemps: [], passengerTemps: [],
    climateStatus: null, avgFanSpeed: null, maxFanSpeed: null, startRange: 300, endRange: 250,
    odometerStart: 10000, odometerEnd: 10040, hasTirePressure: false, efficiencyPctPer100: 25, ...over,
  };
}

export function pointFixture(over: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return {
    time: '10:00', speed: 72, battery: 80, elevation: 10, power: 100,
    outsideTemp: null, insideTemp: null, driverTemp: null, passengerTemp: null,
    idealRange: null, ratedRange: null, estRange: null, odometer: null, soc: null, usableSoc: null,
    tireFl: null, tireFr: null, tireRl: null, tireRr: null, climateOn: null, fanStatus: null, ...over,
  };
}
