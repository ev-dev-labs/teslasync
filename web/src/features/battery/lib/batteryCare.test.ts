import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import { computeBatteryCare, isDcSession } from './batteryCare';

let nextId = 1;

function session(over: Partial<ChargingSession>): ChargingSession {
  const id = nextId++;
  return {
    id: String(id),
    vehicle_id: '1',
    charger_type: 'AC',
    start_soc_pct: 40,
    end_soc_pct: 70,
    total_energy_added_wh: 10_000,
    peak_power_w: 11_000,
    cost_decimal: null,
    started_at: '2026-07-01T20:00:00Z',
    ended_at: null,
    start_ts: '2026-07-01T20:00:00Z',
    startedAt: '2026-07-01T20:00:00Z',
    duration_min: 120,
    ...over,
  };
}

function drive(endBatteryPct: number | null): Drive {
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: '2026-07-01T08:00:00Z',
    endTs: null,
    durationS: 1800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct,
    energyUsedWh: 2000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('isDcSession', () => {
  it('recognises DC fast charger labels', () => {
    expect(isDcSession('DC')).toBe(true);
    expect(isDcSession('Supercharger')).toBe(true);
    expect(isDcSession('ccs-combo')).toBe(true);
    expect(isDcSession('fast')).toBe(true);
  });

  it('treats AC / wall / null as not DC', () => {
    expect(isDcSession('AC')).toBe(false);
    expect(isDcSession('wall_connector')).toBe(false);
    expect(isDcSession(null)).toBe(false);
  });
});

describe('computeBatteryCare', () => {
  const fiveDrives = [60, 50, 40, 55, 45].map(drive);

  it('scores 100 for immaculate habits', () => {
    const sessions = Array.from({ length: 5 }, () => session({ end_soc_pct: 75 }));
    const r = computeBatteryCare(sessions, fiveDrives);
    expect(r.fullChargeShare).toBe(0);
    expect(r.deepDischargeShare).toBe(0);
    expect(r.dcEnergyShare).toBe(0);
    expect(r.bandFinishShare).toBe(1);
    expect(r.score).toBe(100);
  });

  it('penalizes full charges, deep discharges, and DC energy', () => {
    const sessions = [
      session({ end_soc_pct: 100 }), // full charge, outside band
      session({ end_soc_pct: 70 }),
      session({ end_soc_pct: 70 }),
      session({ end_soc_pct: 70 }),
      session({ end_soc_pct: 70, charger_type: 'Supercharger' }),
    ];
    const drives = [5, 50, 50, 50, 50].map(drive); // one deep discharge
    const r = computeBatteryCare(sessions, drives);
    // full 1/5 → −6; deep 1/5 → −6; DC 10k/50k → −4; band 4/5 → −4.
    expect(r.score).toBe(100 - 6 - 6 - 4 - 4);
  });

  it('withholds the score below 5 sessions or 5 drives', () => {
    const sessions = Array.from({ length: 4 }, () => session({}));
    expect(computeBatteryCare(sessions, fiveDrives).score).toBeNull();
    const five = Array.from({ length: 5 }, () => session({}));
    expect(computeBatteryCare(five, [drive(50)]).score).toBeNull();
  });

  it('ignores sessions without an end SoC and drives without arrival SoC', () => {
    const sessions = [session({ end_soc_pct: null }), session({ end_soc_pct: 70 })];
    const r = computeBatteryCare(sessions, [drive(null), drive(50)]);
    expect(r.sessionsAnalyzed).toBe(1);
    expect(r.drivesAnalyzed).toBe(1);
  });

  it('weights DC share by energy, not session count', () => {
    const sessions = [
      session({ charger_type: 'Supercharger', total_energy_added_wh: 30_000 }),
      session({ total_energy_added_wh: 10_000 }),
    ];
    expect(computeBatteryCare(sessions, fiveDrives).dcEnergyShare).toBeCloseTo(0.75);
  });

  it('handles empty inputs', () => {
    const r = computeBatteryCare([], []);
    expect(r.score).toBeNull();
    expect(r.fullChargeShare).toBeNull();
    expect(r.dcEnergyShare).toBeNull();
  });
});
