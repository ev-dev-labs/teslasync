import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import {
  analyzeChargeDepartureAlignment,
  pairChargesWithNextDrive,
  firstDriveAfter,
} from './chargeDepartureAlignment';

const ANCHOR = Date.UTC(2026, 0, 1);
let nextChargeId = 1;
let nextDriveId = 1;

function charge(spec: {
  endDay: number;
  endHour?: number;
  endSoc?: number | null;
  noEnd?: boolean;
}): ChargingSession {
  const endedMs = ANCHOR + spec.endDay * 86_400_000 + (spec.endHour ?? 8) * 3_600_000;
  const startedMs = endedMs - 3 * 3_600_000;
  return {
    id: `c${nextChargeId++}`,
    vehicle_id: '1',
    charger_type: null,
    start_soc_pct: 30,
    end_soc_pct: spec.endSoc === undefined ? 80 : spec.endSoc,
    total_energy_added_wh: 20_000,
    peak_power_w: 7000,
    cost_decimal: null,
    started_at: new Date(startedMs).toISOString(),
    ended_at: spec.noEnd ? null : new Date(endedMs).toISOString(),
    start_ts: new Date(startedMs).toISOString(),
    startedAt: new Date(startedMs).toISOString(),
    duration_min: 180,
    start_place: 'Home',
    start_lat: null,
    start_lng: null,
  };
}

function drive(spec: {
  startDay: number;
  startHour?: number;
  durationH?: number;
  startSoc?: number | null;
  endSoc?: number | null;
}): Drive {
  const startMs = ANCHOR + spec.startDay * 86_400_000 + (spec.startHour ?? 9) * 3_600_000;
  const endMs = startMs + (spec.durationH ?? 1) * 3_600_000;
  return {
    id: nextDriveId++,
    vehicleId: 1,
    startTs: new Date(startMs).toISOString(),
    endTs: new Date(endMs).toISOString(),
    durationS: (spec.durationH ?? 1) * 3600,
    distanceM: 20_000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: spec.startSoc === undefined ? 80 : spec.startSoc,
    endBatteryPct: spec.endSoc === undefined ? 60 : spec.endSoc,
    energyUsedWh: 5000,
    regenEnergyWh: null,
    avgSpeedMps: null,
    maxSpeedMps: null,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: new Date(startMs).toISOString(),
    updatedAt: new Date(startMs).toISOString(),
  };
}

describe('firstDriveAfter', () => {
  it('finds the first drive strictly after a timestamp', () => {
    const drives = [drive({ startDay: 0 }), drive({ startDay: 1 }), drive({ startDay: 2 })];
    const idx = firstDriveAfter(drives, drives[0]!.startTs ? new Date(drives[0]!.startTs).getTime() : 0);
    expect(idx).toBe(1);
  });

  it('returns length when nothing qualifies', () => {
    const drives = [drive({ startDay: 0 })];
    const idx = firstDriveAfter(drives, new Date(drives[0]!.startTs).getTime() + 1_000_000_000);
    expect(idx).toBe(1);
  });
});

describe('pairChargesWithNextDrive', () => {
  it('pairs a charge with the next drive inside the window', () => {
    const c = charge({ endDay: 0, endHour: 8 });
    const d = drive({ startDay: 0, startHour: 9 });
    const { pairs, unpairedCount } = pairChargesWithNextDrive([c], [d], 24);
    expect(pairs).toHaveLength(1);
    expect(unpairedCount).toBe(0);
  });

  it('leaves a charge unpaired when the next drive is outside the window', () => {
    const c = charge({ endDay: 0, endHour: 8 });
    const d = drive({ startDay: 3, startHour: 9 }); // 3 days later
    const { pairs, unpairedCount } = pairChargesWithNextDrive([c], [d], 24);
    expect(pairs).toHaveLength(0);
    expect(unpairedCount).toBe(1);
  });

  it('ignores drives that started before the charge ended', () => {
    const c = charge({ endDay: 1, endHour: 8 });
    const dBefore = drive({ startDay: 0, startHour: 9 });
    const dAfter = drive({ startDay: 1, startHour: 10 });
    const { pairs } = pairChargesWithNextDrive([c], [dBefore, dAfter], 24);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.drive.id).toBe(dAfter.id);
  });

  it('pairs a shared departure only with the latest preceding split session', () => {
    const earlier = charge({ endDay: 0, endHour: 8 });
    const latest = charge({ endDay: 0, endHour: 9 });
    const departure = drive({ startDay: 0, startHour: 10 });
    const { pairs, unpairedCount } = pairChargesWithNextDrive(
      [earlier, latest],
      [departure],
      24,
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.session.id).toBe(latest.id);
    expect(unpairedCount).toBe(1);

    const summary = analyzeChargeDepartureAlignment([earlier, latest], [departure]);
    expect(summary.pairedCount).toBe(1);
    expect(summary.avgDwellS).toBe(3600);
    expect(summary.pairs[0]!.flags).not.toContain('long_dwell');
  });
});

describe('analyzeChargeDepartureAlignment', () => {
  it('is empty and safe with no data', () => {
    const summary = analyzeChargeDepartureAlignment([], []);
    expect(summary.pairs).toEqual([]);
    expect(summary.pairedCount).toBe(0);
    expect(summary.avgReadinessMarginPct).toBeNull();
  });

  it('excludes charges that never closed out (still in progress)', () => {
    const c = charge({ endDay: 0, noEnd: true });
    const d = drive({ startDay: 0, startHour: 9 });
    const summary = analyzeChargeDepartureAlignment([c], [d]);
    expect(summary.totalEndedCharges).toBe(0);
    expect(summary.pairedCount).toBe(0);
  });

  it('flags a tight readiness margin when the drive ends with very little charge left', () => {
    const c = charge({ endDay: 0, endHour: 8, endSoc: 60 });
    const d = drive({ startDay: 0, startHour: 9, startSoc: 58, endSoc: 8 });
    const summary = analyzeChargeDepartureAlignment([c], [d]);
    expect(summary.pairs[0]!.flags).toContain('tight_margin');
    expect(summary.tightMarginCount).toBe(1);
  });

  it('flags excess buffer when far more was charged than the trip used', () => {
    const c = charge({ endDay: 0, endHour: 8, endSoc: 90 });
    const d = drive({ startDay: 0, startHour: 9, startSoc: 88, endSoc: 80 }); // used only ~8-10 pts
    const summary = analyzeChargeDepartureAlignment([c], [d]);
    expect(summary.pairs[0]!.flags).toContain('excess_buffer');
    expect(summary.excessBufferCount).toBe(1);
  });

  it('flags early-full dwell when the charge finished full and sat a long time before departure', () => {
    const c = charge({ endDay: 0, endHour: 8, endSoc: 100 });
    const d = drive({ startDay: 0, startHour: 14, startSoc: 96, endSoc: 60 }); // 6h dwell
    const summary = analyzeChargeDepartureAlignment([c], [d]);
    expect(summary.pairs[0]!.flags).toContain('early_full_dwell');
    expect(summary.totalEarlyFullDwellS).toBeGreaterThan(0);
  });

  it('flags a generic long dwell when the gap is large but the charge was not full', () => {
    const c = charge({ endDay: 0, endHour: 8, endSoc: 55 });
    const d = drive({ startDay: 0, startHour: 14, startSoc: 53, endSoc: 40 });
    const summary = analyzeChargeDepartureAlignment([c], [d]);
    expect(summary.pairs[0]!.flags).toContain('long_dwell');
    expect(summary.pairs[0]!.flags).not.toContain('early_full_dwell');
  });

  it('flags a SoC mismatch when drive-start SoC reads well above the recorded charge-end SoC', () => {
    const c = charge({ endDay: 0, endHour: 8, endSoc: 60 });
    const d = drive({ startDay: 0, startHour: 9, startSoc: 75, endSoc: 50 }); // +15 pts, no charging in between
    const summary = analyzeChargeDepartureAlignment([c], [d]);
    expect(summary.pairs[0]!.flags).toContain('soc_mismatch');
  });

  it('does not flag a clean, well-matched handoff', () => {
    const c = charge({ endDay: 0, endHour: 8, endSoc: 65 });
    const d = drive({ startDay: 0, startHour: 9, startSoc: 64, endSoc: 40 });
    const summary = analyzeChargeDepartureAlignment([c], [d]);
    expect(summary.pairs[0]!.flags).toEqual([]);
    expect(summary.misalignedCount).toBe(0);
  });

  it('computes averages and the misaligned rate across multiple pairs', () => {
    const sessions = [
      charge({ endDay: 0, endHour: 8, endSoc: 65 }),
      charge({ endDay: 1, endHour: 8, endSoc: 60 }),
    ];
    const drives = [
      drive({ startDay: 0, startHour: 9, startSoc: 64, endSoc: 5 }), // tight margin
      drive({ startDay: 1, startHour: 9, startSoc: 59, endSoc: 40 }), // clean
    ];
    const summary = analyzeChargeDepartureAlignment(sessions, drives);
    expect(summary.pairedCount).toBe(2);
    expect(summary.misalignedCount).toBe(1);
    expect(summary.misalignedRatePct).toBe(50);
    expect(summary.avgReadinessMarginPct).not.toBeNull();
  });
});
