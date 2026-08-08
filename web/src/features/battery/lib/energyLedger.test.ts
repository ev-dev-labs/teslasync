import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import { buildEnergyLedger, buildTimeline, estimatePackCapacityWh } from './energyLedger';

// Mid-month, midday UTC so no local timezone offset can shift a fixture into
// an adjacent calendar month (the ledger buckets by local month, as users do).
const ANCHOR = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 3_600_000;

let nextId = 1;

interface ChargeSpec {
  /** Hours after the anchor. */
  at: number;
  hours?: number;
  startSoc: number;
  endSoc: number;
  /** Defaults to a consistent 75 kWh pack. */
  energyWh?: number;
}

function charge(spec: ChargeSpec): ChargingSession {
  const startMs = ANCHOR + spec.at * HOUR;
  const hours = spec.hours ?? 2;
  const energy = spec.energyWh ?? ((spec.endSoc - spec.startSoc) / 100) * 75_000;
  return {
    id: `c${nextId++}`,
    vehicle_id: '1',
    charger_type: null,
    start_soc_pct: spec.startSoc,
    end_soc_pct: spec.endSoc,
    total_energy_added_wh: energy,
    peak_power_w: null,
    cost_decimal: null,
    started_at: new Date(startMs).toISOString(),
    ended_at: new Date(startMs + hours * HOUR).toISOString(),
    start_ts: new Date(startMs).toISOString(),
    startedAt: new Date(startMs).toISOString(),
    duration_min: hours * 60,
  };
}

interface DriveSpec {
  at: number;
  hours?: number;
  startSoc: number;
  endSoc: number;
  energyWh?: number;
  km?: number;
}

function drive(spec: DriveSpec): Drive {
  const startMs = ANCHOR + spec.at * HOUR;
  const hours = spec.hours ?? 1;
  const energy = spec.energyWh ?? ((spec.startSoc - spec.endSoc) / 100) * 75_000;
  return {
    id: nextId++,
    vehicleId: 1,
    startTs: new Date(startMs).toISOString(),
    endTs: new Date(startMs + hours * HOUR).toISOString(),
    durationS: hours * 3600,
    distanceM: (spec.km ?? 60) * 1000,
    startAddress: null,
    endAddress: null,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: spec.startSoc,
    endBatteryPct: spec.endSoc,
    energyUsedWh: energy,
    regenEnergyWh: null,
    avgSpeedMps: 20,
    maxSpeedMps: 35,
    avgPowerW: null,
    outsideTempAvgC: 10,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('estimatePackCapacityWh', () => {
  it('derives capacity from energy added per point of SoC', () => {
    const sessions = [
      charge({ at: 0, startSoc: 20, endSoc: 80 }),
      charge({ at: 48, startSoc: 30, endSoc: 90 }),
      charge({ at: 96, startSoc: 10, endSoc: 60 }),
    ];
    const { capacityWh, samples } = estimatePackCapacityWh(sessions);
    expect(capacityWh).toBe(75_000);
    expect(samples).toBe(3);
  });

  it('ignores narrow top-ups where rounding dominates', () => {
    const sessions = [
      charge({ at: 0, startSoc: 78, endSoc: 80 }),
      charge({ at: 24, startSoc: 20, endSoc: 80 }),
    ];
    expect(estimatePackCapacityWh(sessions).samples).toBe(1);
  });

  it('uses the median so one corrupt session cannot skew it', () => {
    const sessions = [
      charge({ at: 0, startSoc: 20, endSoc: 80 }),
      charge({ at: 24, startSoc: 20, endSoc: 80 }),
      // Energy recorded but SoC barely moved: implies a 200 kWh pack.
      charge({ at: 48, startSoc: 20, endSoc: 45, energyWh: 50_000 }),
    ];
    expect(estimatePackCapacityWh(sessions).capacityWh).toBe(75_000);
  });

  it('rejects physically impossible capacities outright', () => {
    const sessions = [charge({ at: 0, startSoc: 10, endSoc: 90, energyWh: 500 })];
    expect(estimatePackCapacityWh(sessions)).toEqual({ capacityWh: null, samples: 0 });
  });

  it('prefers an explicit delta_soc_pct when the API supplies one', () => {
    const s = { ...charge({ at: 0, startSoc: 0, endSoc: 0, energyWh: 40_000 }), delta_soc_pct: 50 };
    expect(estimatePackCapacityWh([s]).capacityWh).toBe(80_000);
  });

  it('returns null with nothing usable', () => {
    expect(estimatePackCapacityWh([])).toEqual({ capacityWh: null, samples: 0 });
  });
});

describe('buildTimeline', () => {
  it('interleaves charges and drives chronologically', () => {
    const timeline = buildTimeline(
      [charge({ at: 10, startSoc: 40, endSoc: 80 })],
      [drive({ at: 2, startSoc: 60, endSoc: 40 }), drive({ at: 20, startSoc: 80, endSoc: 70 })],
    );
    expect(timeline.map((e) => e.kind)).toEqual(['drive', 'charge', 'drive']);
  });

  it('signs charging positive and driving negative', () => {
    const timeline = buildTimeline(
      [charge({ at: 0, startSoc: 20, endSoc: 60, energyWh: 30_000 })],
      [drive({ at: 10, startSoc: 60, endSoc: 40, energyWh: 15_000 })],
    );
    expect(timeline[0]!.energyWh).toBe(30_000);
    expect(timeline[1]!.energyWh).toBe(-15_000);
  });

  it('falls back to the duration when an end timestamp is missing', () => {
    const d = { ...drive({ at: 0, startSoc: 60, endSoc: 50, hours: 3 }), endTs: null };
    expect(buildTimeline([], [d])[0]!.endMs).toBe(ANCHOR + 3 * HOUR);
  });

  it('skips events with unparseable start times', () => {
    const broken = { ...drive({ at: 0, startSoc: 60, endSoc: 50 }), startTs: 'nope' };
    expect(buildTimeline([], [broken, drive({ at: 5, startSoc: 50, endSoc: 40 })])).toHaveLength(1);
  });
});

describe('buildEnergyLedger', () => {
  it('is empty and safe with no data', () => {
    const l = buildEnergyLedger([], []);
    expect(l.months).toEqual([]);
    expect(l.packCapacityWh).toBeNull();
    expect(l.gaps).toEqual([]);
    expect(l.closureRate).toBe(0);
  });

  it('recovers idle drain from the SoC lost between events', () => {
    const sessions = [charge({ at: 0, startSoc: 20, endSoc: 80 })];
    // Charge ends at 80 % (t=2 h); the next drive starts at 76 % a day later.
    const drives = [drive({ at: 26, startSoc: 76, endSoc: 60 })];
    const l = buildEnergyLedger(sessions, drives);
    expect(l.packCapacityWh).toBe(75_000);
    expect(l.gaps).toHaveLength(1);
    // 4 % of 75 kWh = 3 kWh over 24 h = 125 W.
    expect(l.gaps[0]!.wh).toBe(3000);
    expect(l.gaps[0]!.powerW).toBe(125);
    expect(l.totalStandbyWh).toBe(3000);
  });

  it('closes the books when nothing is missing', () => {
    // 20 → 80 charge (45 kWh in), drive 80 → 50 (22.5 kWh out), idle 50 → 48
    // (1.5 kWh standby), ending 28 points above where it opened.
    const sessions = [charge({ at: 0, startSoc: 20, endSoc: 80 })];
    const drives = [
      drive({ at: 4, startSoc: 80, endSoc: 50 }),
      drive({ at: 30, startSoc: 48, endSoc: 40 }),
    ];
    const l = buildEnergyLedger(sessions, drives);
    const month = l.months[0]!;
    expect(month.chargedWh).toBe(45_000);
    expect(month.standbyWh).toBe(1500);
    expect(Math.abs(month.residualWh)).toBeLessThan(500);
    expect(month.closureRate).toBeGreaterThan(0.98);
  });

  it('exposes a large residual when charges are missing from the data', () => {
    // The car drives far more than it was ever recorded charging.
    const sessions = [charge({ at: 0, startSoc: 20, endSoc: 40 })];
    const drives = Array.from({ length: 10 }, (_, i) =>
      drive({ at: 10 + i * 24, startSoc: 80, endSoc: 40, energyWh: 30_000 }),
    );
    const l = buildEnergyLedger(sessions, drives);
    expect(l.months[0]!.residualWh).toBeLessThan(-100_000);
    expect(l.months[0]!.closureRate).toBe(0);
  });

  it('does not read an SoC rise across a gap as negative drain', () => {
    const sessions = [charge({ at: 0, startSoc: 20, endSoc: 60 })];
    // Next event starts higher than the last one ended: an unrecorded charge.
    const drives = [drive({ at: 30, startSoc: 90, endSoc: 70 })];
    const l = buildEnergyLedger(sessions, drives);
    expect(l.gaps).toEqual([]);
    expect(l.totalStandbyWh).toBe(0);
  });

  it('ignores gaps that are too brief or implausibly hungry', () => {
    const sessions = [charge({ at: 0, startSoc: 20, endSoc: 80 })];
    // 15 minutes later, 6 % gone — that is a data glitch, not sentry mode.
    const drives = [drive({ at: 2.25, startSoc: 74, endSoc: 60 })];
    expect(buildEnergyLedger(sessions, drives).gaps).toEqual([]);
  });

  it('treats a multi-week silence as an outage rather than standing drain', () => {
    const sessions = [charge({ at: 0, startSoc: 20, endSoc: 90 })];
    const drives = [drive({ at: 24 * 30, startSoc: 40, endSoc: 30 })];
    expect(buildEnergyLedger(sessions, drives).gaps).toEqual([]);
  });

  it('cannot compute standby without a capacity estimate', () => {
    // Only narrow top-ups: capacity is unknowable, so SoC cannot become Wh.
    const sessions = [
      charge({ at: 0, startSoc: 78, endSoc: 80 }),
      charge({ at: 48, startSoc: 79, endSoc: 81 }),
    ];
    const drives = [drive({ at: 24, startSoc: 70, endSoc: 60 })];
    const l = buildEnergyLedger(sessions, drives);
    expect(l.packCapacityWh).toBeNull();
    expect(l.totalStandbyWh).toBe(0);
    expect(l.gaps).toEqual([]);
  });

  it('buckets activity into calendar months in ascending order', () => {
    const sessions = [
      charge({ at: 0, startSoc: 20, endSoc: 80 }),
      charge({ at: 24 * 40, startSoc: 20, endSoc: 80 }),
      charge({ at: 24 * 75, startSoc: 20, endSoc: 80 }),
    ];
    const l = buildEnergyLedger(sessions, []);
    expect(l.months).toHaveLength(3);
    expect(l.months.map((m) => m.month)).toEqual([...l.months.map((m) => m.month)].sort());
    expect(l.months[0]!.chargeSessions).toBe(1);
  });

  it('reports vampire drain per parked day and the driving share', () => {
    const sessions = [charge({ at: 0, startSoc: 20, endSoc: 80 })];
    const drives = [
      drive({ at: 26, startSoc: 76, endSoc: 56, energyWh: 15_000 }),
      drive({ at: 52, startSoc: 52, endSoc: 40, energyWh: 9000 }),
    ];
    const l = buildEnergyLedger(sessions, drives);
    expect(l.vampireWhPerDay).toBeGreaterThan(0);
    expect(l.meanStandbyPowerW).toBeGreaterThan(0);
    expect(l.drivingShare).toBeCloseTo(24_000 / 45_000, 2);
    expect(l.standbyShare).toBeGreaterThan(0);
  });

  it('accumulates distance alongside energy', () => {
    const l = buildEnergyLedger(
      [charge({ at: 0, startSoc: 20, endSoc: 80 })],
      [
        drive({ at: 4, startSoc: 80, endSoc: 60, km: 100 }),
        drive({ at: 30, startSoc: 58, endSoc: 40, km: 50 }),
      ],
    );
    expect(l.months[0]!.distanceM).toBe(150_000);
    expect(l.months[0]!.drives).toBe(2);
  });

  it('ranks the hungriest idle gaps first', () => {
    const sessions = [charge({ at: 0, startSoc: 20, endSoc: 90 })];
    const drives = [
      // Small gap: 1 point.
      drive({ at: 26, startSoc: 89, endSoc: 80 }),
      // Big gap: 12 points over four days (sentry mode left on).
      drive({ at: 24 * 5, startSoc: 68, endSoc: 60 }),
    ];
    const l = buildEnergyLedger(sessions, drives);
    expect(l.gaps).toHaveLength(2);
    expect(l.gaps[0]!.wh).toBeGreaterThan(l.gaps[1]!.wh);
    expect(l.gaps[0]!.socDropPct).toBe(12);
  });
});
