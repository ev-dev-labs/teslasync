import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/types/charging';
import {
  analyzeChargerResilience,
  resolveResilienceSite,
  computeHHI,
  computeResilienceScore,
  type ResilienceSite,
} from './chargerResilience';

const ANCHOR = Date.UTC(2026, 0, 1);
let nextId = 1;

interface SessionSpec {
  day: number;
  energyWh: number;
  place?: string | null;
  lat?: number | null;
  lng?: number | null;
  chargerType?: string | null;
}

function session(spec: SessionSpec): ChargingSession {
  const startedMs = ANCHOR + spec.day * 86_400_000;
  const started = new Date(startedMs).toISOString();
  return {
    id: `s${nextId++}`,
    vehicle_id: '1',
    charger_type: spec.chargerType ?? null,
    start_soc_pct: 30,
    end_soc_pct: 70,
    total_energy_added_wh: spec.energyWh,
    peak_power_w: 7000,
    cost_decimal: null,
    started_at: started,
    ended_at: new Date(startedMs + 2 * 3_600_000).toISOString(),
    start_ts: started,
    startedAt: started,
    duration_min: 120,
    start_place: spec.place ?? null,
    start_lat: spec.lat ?? null,
    start_lng: spec.lng ?? null,
  };
}

describe('resolveResilienceSite', () => {
  it('prefers start_place', () => {
    const r = resolveResilienceSite(session({ day: 0, energyWh: 1000, place: 'Home' }));
    expect(r.groupedBy).toBe('place');
    expect(r.key).toBe('place:home');
  });

  it('falls back to a rounded geo cell when place is missing', () => {
    const r = resolveResilienceSite(session({ day: 0, energyWh: 1000, lat: 51.5007, lng: -0.1246 }));
    expect(r.groupedBy).toBe('geo');
    expect(r.key).toMatch(/^geo:/);
  });

  it('falls back to charger_type when neither place nor coords are known', () => {
    const r = resolveResilienceSite(session({ day: 0, energyWh: 1000, chargerType: 'supercharger' }));
    expect(r.groupedBy).toBe('charger_type');
    expect(r.key).toBe('type:supercharger');
    expect(r.label).toBe('Supercharger');
  });

  it('buckets a session with no location signal at all into "Unknown location" rather than dropping it', () => {
    const r = resolveResilienceSite(session({ day: 0, energyWh: 1000 }));
    expect(r.key).toBe('type:unknown');
  });
});

describe('computeHHI', () => {
  it('is 1 for a single site', () => {
    const sites: ResilienceSite[] = [
      { key: 'a', label: 'A', groupedBy: 'place', sessions: 1, totalEnergyWh: 100, energyShare: 1 },
    ];
    expect(computeHHI(sites)).toBe(1);
  });

  it('is low for many equally-sized sites', () => {
    const sites: ResilienceSite[] = Array.from({ length: 10 }, (_, i) => ({
      key: `s${i}`,
      label: `S${i}`,
      groupedBy: 'place' as const,
      sessions: 1,
      totalEnergyWh: 100,
      energyShare: 0.1,
    }));
    expect(computeHHI(sites)).toBeCloseTo(0.1, 5);
  });

  it('is 0 for no sites', () => {
    expect(computeHHI([])).toBe(0);
  });
});

describe('computeResilienceScore', () => {
  it('scores a single-site, no-fallback portfolio near the bottom', () => {
    const score = computeResilienceScore(1, 0, 1, 5);
    expect(score).toBe(0);
  });

  it('scores a perfectly diversified portfolio near the top', () => {
    const score = computeResilienceScore(0.2, 0.8, 5, 5);
    expect(score).toBeGreaterThan(80);
  });

  it('is monotonic in top-share: less dependency never scores worse', () => {
    const worse = computeResilienceScore(0.9, 0.1, 1.1, 5);
    const better = computeResilienceScore(0.5, 0.1, 1.1, 5);
    expect(better).toBeGreaterThan(worse);
  });
});

describe('analyzeChargerResilience', () => {
  it('is empty and safe with no sessions', () => {
    const summary = analyzeChargerResilience([]);
    expect(summary.sites).toEqual([]);
    expect(summary.topSite).toBeNull();
    expect(summary.whatIfTopSiteLoss).toBeNull();
    expect(summary.resilienceScore).toBe(0);
  });

  it('flags total dependency on a single home charger', () => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      session({ day: i, energyWh: 10_000, place: 'Home' }),
    );
    const summary = analyzeChargerResilience(sessions);
    expect(summary.sites).toHaveLength(1);
    expect(summary.topSiteDependencyPct).toBe(100);
    expect(summary.hhi).toBe(1);
    expect(summary.effectiveSiteCount).toBeCloseTo(1, 5);
    expect(summary.fallbackCoveragePct).toBe(0);
    expect(summary.resilienceScore).toBeLessThan(20);
    // Losing the only site leaves nothing behind.
    expect(summary.whatIfTopSiteLoss?.newTopSiteLabel).toBeNull();
    expect(summary.whatIfTopSiteLoss?.resilienceScoreAfter).toBe(0);
  });

  it('rewards a well-spread portfolio with a higher score and lower HHI', () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, i) => session({ day: i, energyWh: 5000, place: 'Home' })),
      ...Array.from({ length: 10 }, (_, i) => session({ day: 20 + i, energyWh: 5000, place: 'Work' })),
      ...Array.from({ length: 10 }, (_, i) => session({ day: 40 + i, energyWh: 5000, place: 'Supercharger' })),
    ];
    const summary = analyzeChargerResilience(sessions);
    expect(summary.sites).toHaveLength(3);
    expect(summary.topSiteDependencyPct).toBeCloseTo(33.3, 0);
    expect(summary.hhi).toBeLessThan(0.4);
    expect(summary.effectiveSiteCount).toBeGreaterThan(2.5);
    expect(summary.resilienceScore).toBeGreaterThan(60);
  });

  it('computes a sensible what-if loss for the top site, promoting the runner-up', () => {
    const sessions = [
      ...Array.from({ length: 20 }, (_, i) => session({ day: i, energyWh: 8000, place: 'Home' })),
      ...Array.from({ length: 10 }, (_, i) => session({ day: 30 + i, energyWh: 4000, place: 'Work' })),
    ];
    const summary = analyzeChargerResilience(sessions);
    const whatIf = summary.whatIfTopSiteLoss!;
    expect(whatIf.topSiteLabel).toBe('Home');
    expect(whatIf.newTopSiteLabel).toBe('Work');
    expect(whatIf.newTopSiteShare).toBeCloseTo(1, 5); // only site left
    expect(whatIf.resilienceScoreAfter).toBeLessThanOrEqual(whatIf.resilienceScoreBefore);
  });

  it('still counts energy from sessions with no location data via the Unknown bucket', () => {
    const sessions = [
      session({ day: 0, energyWh: 5000, place: 'Home' }),
      session({ day: 1, energyWh: 5000 }), // no place, no coords, no charger_type
    ];
    const summary = analyzeChargerResilience(sessions);
    expect(summary.totalEnergyWh).toBe(10_000);
    expect(summary.sites.some((s) => s.key === 'type:unknown')).toBe(true);
  });

  it('measures fallback coverage by session frequency, not energy share', () => {
    // Top site dominates energy, but sessions are split evenly — showing
    // repeated real use of the alternate site.
    const sessions = [
      ...Array.from({ length: 5 }, (_, i) => session({ day: i, energyWh: 50_000, place: 'Supercharger' })),
      ...Array.from({ length: 5 }, (_, i) => session({ day: 20 + i, energyWh: 1000, place: 'Home' })),
    ];
    const summary = analyzeChargerResilience(sessions);
    expect(summary.topSiteDependencyPct).toBeGreaterThan(90); // energy dominated
    expect(summary.fallbackCoveragePct).toBeCloseTo(50, 0); // but half the visits were elsewhere
  });
});
