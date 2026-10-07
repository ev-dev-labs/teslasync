import type { DriveReportContentProps } from './DriveReportContent';

/** Strict presentation fixture; does not invent a production data source. */
export function reportFixture(): DriveReportContentProps {
  return {
    id: '42',
    meaningful: true,
    sections: [
      { id: 'journey', label: 'Journey details' },
      { id: 'overview', label: 'Overview' },
      { id: 'route', label: 'Route' },
      { id: 'telemetry', label: 'Telemetry' },
      { id: 'energy', label: 'Energy and cost' },
      { id: 'supervised', label: 'Supervised driving' },
      { id: 'physics', label: 'Post-drive physics' },
      { id: 'diagnostics', label: 'Diagnostics' },
    ],
    fsdLoading: false,
    fsdError: null,
    fsdInsight: {
      drive_id: 42, started_at: '2026-10-01T10:00:00Z', ended_at: '2026-10-01T10:45:00Z',
      start_place: 'Origin', end_place: 'Destination', distance_m: 32000, energy_used_wh: 7200,
      fsd_distance_m: 12000, fsd_share_pct: 37.5, confidence: 'estimated', reset_affected: false,
      firmware_version: null, evidence_truncated: false,
      evidence: [{
        start_at: '2026-10-01T10:05:00Z', end_at: '2026-10-01T10:25:00Z',
        fsd_distance_m: 12000, confidence: 'estimated', approximate: true,
      }],
    },
    speedInsights: null,
    coaching: null,
    data: {
      drive: {
        id: 42, vehicleId: 1, startTs: '2026-10-01T10:00:00Z', endTs: '2026-10-01T10:45:00Z',
        durationS: 2700, distanceM: 32000, startAddress: 'Origin', endAddress: 'Destination',
        startLat: 47.6, startLon: -122.33, endLat: 47.44, endLon: -122.3,
        startBatteryPct: 82, endBatteryPct: 68, energyUsedWh: 7200, regenEnergyWh: 900,
        avgSpeedMps: 20, maxSpeedMps: 31, avgPowerW: 15000, outsideTempAvgC: 14,
        insideTempAvgC: 21, score: 88, endedStatus: 'parked',
        createdAt: '2026-10-01T10:45:05Z', updatedAt: '2026-10-01T10:45:05Z',
        positions: [], telemetry: [],
      },
      stats: {
        maxSpd: 112, avgSpd: 72, minSpd: 8, powerMax: 120, powerMin: -40, avgPower: 15,
        energyWh: 7200, regenWh: 900, consumptionWhKm: 225, elevGain: 120, elevLoss: 90,
        avgOutsideTemp: 14, avgInsideTemp: 21, hasAnyTemp: true, insideTemps: [21],
        outsideTemps: [14], driverTemps: [], passengerTemps: [], climateStatus: 'On',
        avgFanSpeed: 3, maxFanSpeed: 6, startRange: 410, endRange: 365,
        odometerStart: 10000, odometerEnd: 10032, hasTirePressure: false, efficiencyPctPer100: 43.75,
      },
      chartData: [{
        time: '10:00', speed: 72, battery: 82, elevation: 100, power: -40,
        outsideTemp: 14, insideTemp: 21, driverTemp: null, passengerTemp: null,
        idealRange: 410, ratedRange: 400, estRange: null, odometer: 10000, soc: 82, usableSoc: null,
        tireFl: null, tireFr: null, tireRl: null, tireRr: null, climateOn: true, fanStatus: 3,
      }],
      routeSource: [{ lat: 47.6, lng: -122.33, speed: 20, timestamp: '2026-10-01T10:00:00Z' }],
      trail: [[47.6, -122.33]],
      startPos: [47.6, -122.33],
      endPos: [47.44, -122.3],
      centerPos: [47.6, -122.33],
      speedSegments: [{ positions: [[47.6, -122.33], [47.44, -122.3]], color: 'var(--theme-primary)' }],
      speedHistData: [{ range: '60–80', pct: 100 }],
    },
  };
}
