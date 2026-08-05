import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/types/charging';
import {
  buildCapacityObservations,
  kalmanFilterCapacity,
  summarizePackCapacity,
  type CapacityObservation,
} from './packCapacity';

let nextId = 1;

/** A charging session that adds `socDelta` points to a pack of `capacityWh`. */
function session(dayOffset: number, socDelta: number, capacityWh: number): ChargingSession {
  const started = new Date(Date.UTC(2026, 0, 1 + dayOffset, 20)).toISOString();
  const startSoc = 30;
  return {
    id: String(nextId++),
    vehicle_id: '1',
    charger_type: 'ac',
    start_soc_pct: startSoc,
    end_soc_pct: startSoc + socDelta,
    total_energy_added_wh: capacityWh * (socDelta / 100),
    peak_power_w: 11_000,
    cost_decimal: null,
    started_at: started,
    ended_at: null,
    start_ts: started,
    startedAt: started,
    duration_min: 120,
  };
}

function observation(dayOffset: number, capacityWh: number, sigmaWh: number): CapacityObservation {
  const ts = new Date(Date.UTC(2026, 0, 1 + dayOffset)).toISOString();
  return {
    sessionId: `o${dayOffset}`,
    ts,
    tsMs: Date.parse(ts),
    capacityWh,
    socDeltaPct: 40,
    energyAddedWh: capacityWh * 0.4,
    sigmaWh,
  };
}

describe('buildCapacityObservations', () => {
  it('derives capacity from energy added and the SoC window', () => {
    const { observations } = buildCapacityObservations([session(0, 50, 75_000)]);
    expect(observations).toHaveLength(1);
    expect(observations[0]!.capacityWh).toBe(75_000);
    expect(observations[0]!.socDeltaPct).toBe(50);
  });

  it('scales measurement sigma inversely with the SoC window', () => {
    const wide = buildCapacityObservations([session(0, 60, 75_000)]).observations[0]!;
    const narrow = buildCapacityObservations([session(1, 6, 75_000)]).observations[0]!;
    // Same pack, same physics — a 6 % top-up is far less informative.
    expect(narrow.capacityWh).toBe(wide.capacityWh);
    expect(narrow.sigmaWh).toBeGreaterThan(wide.sigmaWh * 5);
  });

  it('rejects narrow windows, missing energy and non-increasing SoC', () => {
    const narrow = session(0, 2, 75_000);
    const noEnergy = { ...session(1, 40, 75_000), total_energy_added_wh: 0 };
    const backwards = { ...session(2, 40, 75_000), end_soc_pct: 10 };
    const missing = { ...session(3, 40, 75_000), end_soc_pct: null };
    const bogusTs = { ...session(4, 40, 75_000), started_at: 'not-a-date', startedAt: 'not-a-date', start_ts: 'not-a-date' };

    const { observations, rejected } = buildCapacityObservations([
      narrow, noEnergy, backwards, missing, bogusTs,
    ]);

    expect(observations).toHaveLength(0);
    expect(rejected.narrowWindow).toBe(1);
    expect(rejected.missingEnergy).toBe(1);
    expect(rejected.missingSoc).toBe(2);
    expect(rejected.badTimestamp).toBe(1);
  });

  it('returns observations in ascending time order regardless of input order', () => {
    const { observations } = buildCapacityObservations([
      session(9, 40, 75_000),
      session(1, 40, 74_000),
      session(5, 40, 74_500),
    ]);
    const times = observations.map((o) => o.tsMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('discards physically implausible capacities', () => {
    // 40 % window that somehow added 400 kWh — a data-quality artefact.
    const absurd = { ...session(0, 40, 75_000), total_energy_added_wh: 400_000 };
    expect(buildCapacityObservations([absurd]).observations).toHaveLength(0);
  });
});

describe('kalmanFilterCapacity', () => {
  it('returns an empty series for no observations', () => {
    expect(kalmanFilterCapacity([])).toEqual([]);
  });

  it('converges toward the truth and shrinks its uncertainty', () => {
    const obs = Array.from({ length: 12 }, (_, i) =>
      observation(i * 3, 75_000 + (i % 2 === 0 ? 900 : -900), 1_200),
    );
    const states = kalmanFilterCapacity(obs);
    const last = states[states.length - 1]!;

    expect(last.capacityWh).toBeGreaterThan(74_000);
    expect(last.capacityWh).toBeLessThan(76_000);
    expect(last.sigmaWh).toBeLessThan(states[0]!.sigmaWh);
  });

  it('trusts a precise measurement more than a noisy one', () => {
    const precise = kalmanFilterCapacity([
      observation(0, 75_000, 1_000),
      observation(1, 60_000, 200),
    ]);
    const noisy = kalmanFilterCapacity([
      observation(0, 75_000, 1_000),
      observation(1, 60_000, 20_000),
    ]);

    expect(precise[1]!.gain).toBeGreaterThan(noisy[1]!.gain);
    expect(precise[1]!.capacityWh).toBeLessThan(noisy[1]!.capacityWh);
  });

  it('reopens to new evidence after a long calendar gap', () => {
    const tight = kalmanFilterCapacity([
      observation(0, 75_000, 500),
      observation(1, 70_000, 500),
    ]);
    const afterGap = kalmanFilterCapacity([
      observation(0, 75_000, 500),
      observation(400, 70_000, 500),
    ]);

    // Same measurements; the gap inflates process variance, so the filter
    // lets the newer observation pull harder.
    expect(afterGap[1]!.gain).toBeGreaterThan(tight[1]!.gain);
  });
});

describe('summarizePackCapacity', () => {
  it('is empty and null-safe with no usable sessions', () => {
    const summary = summarizePackCapacity([]);
    expect(summary.currentWh).toBeNull();
    expect(summary.stateOfHealth).toBeNull();
    expect(summary.fadeWhPerYear).toBeNull();
    expect(summary.spanDays).toBe(0);
  });

  it('detects a fading pack over a long span', () => {
    // 2 % loss across a year, sampled fortnightly.
    const sessions = Array.from({ length: 26 }, (_, i) =>
      session(i * 14, 45, 75_000 - i * 58),
    );
    const summary = summarizePackCapacity(sessions);

    expect(summary.fadeWhPerYear).not.toBeNull();
    expect(summary.fadeWhPerYear!).toBeGreaterThan(500);
    expect(summary.stateOfHealth!).toBeLessThan(1);
    expect(summary.stateOfHealth!).toBeGreaterThan(0.9);
    expect(summary.spanDays).toBeGreaterThan(300);
  });

  it('withholds a fade rate on a short span', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => session(i * 2, 45, 75_000));
    expect(summarizePackCapacity(sessions).fadeWhPerYear).toBeNull();
  });

  it('reports a healthy pack as state-of-health 1', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => session(i * 20, 45, 75_000));
    const summary = summarizePackCapacity(sessions);
    expect(summary.stateOfHealth).toBe(1);
    expect(summary.currentSigmaWh!).toBeGreaterThan(0);
  });
});
