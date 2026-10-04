import { describe, expect, it } from 'vitest';
import type { ChargingSession } from '@/api/types';
import { computeAcDcBreakdown, computeStats } from './helpers';

function session(id: number, chargerType: string | null, peakPowerW = 11_000): ChargingSession {
  return {
    id,
    vehicle_id: 1,
    started_at: '2026-10-02T08:00:00Z',
    ended_at: '2026-10-02T09:00:00Z',
    start_soc_pct: 45,
    end_soc_pct: 80,
    delta_soc_pct: 35,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 26_250,
    peak_power_w: peakPowerW,
    avg_power_w: 11_000,
    cost_decimal: 3,
    cost_currency: 'USD',
    charger_type: chargerType,
    cable_type: null,
    startedAt: '2026-10-02T08:00:00Z',
    duration_min: 60,
  };
}

describe('charging insight charger classification', () => {
  it.each(['ac', 'AC', 'Home', 'Wall connector'])('keeps explicit %s sessions in AC', (type) => {
    const breakdown = computeAcDcBreakdown([session(1, type)]);
    expect(breakdown.ac.count).toBe(1);
    expect(breakdown.dc.count).toBe(0);
    expect(breakdown.ac.energy).toBe(26.25);
  });

  it.each(['Supercharger', 'CCS', 'CHAdeMO', 'DC Fast'])('keeps explicit %s sessions in DC', (type) => {
    const breakdown = computeAcDcBreakdown([session(1, type, 150_000)]);
    expect(breakdown.dc.count).toBe(1);
    expect(breakdown.ac.count).toBe(0);
  });

  it('agrees with the overview for the seeded mixed AC and Supercharger history', () => {
    const sessions = Array.from({ length: 31 }, (_, index) =>
      session(index + 1, index < 21 ? 'ac' : 'supercharger', index < 21 ? 11_000 : 150_000),
    );
    const overview = computeStats(sessions);
    const breakdown = computeAcDcBreakdown(sessions);
    expect(breakdown.ac.count).toBe(overview.homeCount);
    expect(breakdown.dc.count).toBe(overview.scCount + overview.dcCount);
    expect(breakdown.ac.count).toBe(21);
    expect(breakdown.dc.count).toBe(10);
    expect(breakdown.total.energy).toBe(813.75);
    expect(breakdown.ac.energy).toBe(551.25);
    expect(breakdown.dc.energy).toBe(262.5);
  });

  it('preserves power evidence when the charger type is absent', () => {
    const breakdown = computeAcDcBreakdown([
      session(1, null, 11_000),
      session(2, null, 150_000),
    ]);
    expect(breakdown.ac.count).toBe(1);
    expect(breakdown.dc.count).toBe(1);
  });

  it('does not classify unrecorded costs as free or dilute a type cost rate', () => {
    const known = session(1, 'ac');
    const unpriced = { ...session(2, 'ac'), cost_decimal: null };
    const breakdown = computeAcDcBreakdown([known, unpriced]);
    expect(breakdown.ac.cost).toBeNull();
    expect(breakdown.total.cost).toBeNull();
    expect(breakdown.ac.freeCount).toBe(0);
    expect(breakdown.ac.freeEnergy).toBe(0);
    expect(breakdown.ac.energy).toBe(52.5);
  });

  it('retains explicitly measured zero-cost charging as free', () => {
    const breakdown = computeAcDcBreakdown([{ ...session(1, 'ac'), cost_decimal: 0 }]);
    expect(breakdown.ac.cost).toBe(0);
    expect(breakdown.total.cost).toBe(0);
    expect(breakdown.ac.freeCount).toBe(1);
    expect(breakdown.ac.freeEnergy).toBe(26.25);
  });
});
