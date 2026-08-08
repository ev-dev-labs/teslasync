import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/types/charging';
import {
  analyzeChargeInterruptions,
  groupSiteKey,
  evaluateSessionSignal,
  betaPosterior,
  betaQuantile,
  regularizedIncompleteBeta,
} from './chargeInterruption';

const ANCHOR = Date.UTC(2026, 0, 1);
let nextId = 1;

interface SessionSpec {
  day: number;
  hours?: number;
  place?: string;
  lat?: number;
  lng?: number;
  startSoc?: number | null;
  endSoc?: number | null;
  powerW?: number;
  peakPowerW?: number;
  energyWh?: number;
  noEnd?: boolean;
}

function session(spec: SessionSpec): ChargingSession {
  const hours = spec.hours ?? 2;
  const startedMs = ANCHOR + spec.day * 86_400_000;
  const started = new Date(startedMs).toISOString();
  const ended = new Date(startedMs + hours * 3_600_000).toISOString();
  const energyWh = spec.energyWh ?? (spec.powerW ?? 7000) * hours;
  return {
    id: `s${nextId++}`,
    vehicle_id: '1',
    charger_type: null,
    start_soc_pct: spec.startSoc === undefined ? 30 : (spec.startSoc as number),
    end_soc_pct: spec.endSoc === undefined ? 70 : spec.endSoc,
    total_energy_added_wh: energyWh,
    peak_power_w: spec.peakPowerW ?? spec.powerW ?? 7000,
    avg_power_w: spec.powerW ?? 7000,
    cost_decimal: null,
    started_at: started,
    ended_at: spec.noEnd ? null : ended,
    start_ts: started,
    startedAt: started,
    duration_min: hours * 60,
    start_place: spec.place ?? null,
    start_lat: spec.lat ?? null,
    start_lng: spec.lng ?? null,
  };
}

describe('groupSiteKey', () => {
  it('prefers place name, case-insensitively', () => {
    const a = groupSiteKey(session({ day: 0, place: 'Home' }))!;
    const b = groupSiteKey(session({ day: 1, place: 'home' }))!;
    expect(a.key).toBe(b.key);
  });

  it('falls back to a geo cell, and returns null with neither', () => {
    const a = groupSiteKey(session({ day: 0, lat: 51.5, lng: -0.14 }))!;
    expect(a.key).toMatch(/^geo:/);
    expect(groupSiteKey(session({ day: 0 }))).toBeNull();
  });
});

describe('beta posterior math', () => {
  it('the CDF is 0 at x=0 and 1 at x=1', () => {
    expect(regularizedIncompleteBeta(0, 2, 2)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 2)).toBe(1);
  });

  it('Beta(1,1) (uniform) has median 0.5', () => {
    const q = betaQuantile(0.5, 1, 1);
    expect(q).toBeCloseTo(0.5, 2);
  });

  it('a symmetric Beta(a,a) has median 0.5', () => {
    expect(betaQuantile(0.5, 5, 5)).toBeCloseTo(0.5, 2);
  });

  it('more trials with the same rate narrows the credible interval', () => {
    const sparse = betaPosterior(1, 2); // 1 suspect out of 2
    const rich = betaPosterior(50, 100); // same 50% rate, much more evidence
    expect(rich.mean).toBeCloseTo(sparse.mean, 1);
    expect(rich.high - rich.low).toBeLessThan(sparse.high - sparse.low);
  });

  it('zero evidence yields the prior itself — wide, uncommitted interval', () => {
    const p = betaPosterior(0, 0);
    expect(p.mean).toBeCloseTo(0.5, 5);
    expect(p.low).toBeLessThan(0.2);
    expect(p.high).toBeGreaterThan(0.8);
  });

  it('one suspect out of one trial does not claim near-certain risk', () => {
    // Jeffreys prior keeps a single data point from reading as "100% risk".
    const p = betaPosterior(1, 1);
    expect(p.mean).toBeLessThan(0.85);
    expect(p.low).toBeLessThan(0.3);
  });
});

describe('evaluateSessionSignal', () => {
  const opts = {
    taperSocPct: 80,
    minBaselineSessions: 4,
    minDurationForRateCheckS: 300,
    rateShortfallRatio: 0.5,
    powerCollapseRatio: 0.35,
    minDurationForPowerCheckS: 300,
    minMeaningfulEnergyWh: 300,
    minMeaningfulDurationS: 180,
    minSessionsForTrend: 4,
    trendShiftThreshold: 0.2,
  };

  it('flags a missing end timestamp and missing end SoC, unless it is the latest session', () => {
    const s = session({ day: 0, noEnd: true, endSoc: null });
    const flagged = evaluateSessionSignal(s, 'site', null, false, opts);
    expect(flagged.causes).toContain('no_end_timestamp');
    expect(flagged.causes).toContain('no_end_soc');
    expect(flagged.suspect).toBe(true);

    const exempt = evaluateSessionSignal(s, 'site', null, true, opts);
    expect(exempt.causes).not.toContain('no_end_timestamp');
    expect(exempt.causes).not.toContain('no_end_soc');
  });

  it('flags a stalled SoC gain rate well below the site baseline', () => {
    // Baseline established elsewhere at ~20 pct/hour == ~0.333 pct/min.
    const baselineRatePerMin = 20 / 60;
    const stalled = session({ day: 5, startSoc: 30, endSoc: 35, hours: 3 }); // 5pct/3h ~ 0.028/min
    const signal = evaluateSessionSignal(stalled, 'site', baselineRatePerMin, false, opts);
    expect(signal.causes).toContain('stalled_soc_gain');
  });

  it('does not flag a slow rate when it started deep in the taper band', () => {
    const baselineRatePerMin = 20 / 60;
    const taperSession = session({ day: 5, startSoc: 85, endSoc: 95, hours: 3 });
    const signal = evaluateSessionSignal(taperSession, 'site', baselineRatePerMin, false, opts);
    expect(signal.causes).not.toContain('stalled_soc_gain');
  });

  it('flags a power collapse when average power sits far below the peak', () => {
    const s = session({ day: 0, hours: 2, startSoc: 20, endSoc: 40 });
    const collapsed: ChargingSession = { ...s, peak_power_w: 100_000, avg_power_w: 15_000 };
    const signal = evaluateSessionSignal(collapsed, 'site', null, false, opts);
    expect(signal.causes).toContain('power_collapse');
  });

  it('flags an early abort — real power reached, almost nothing delivered, almost no time', () => {
    const s = session({ day: 0, hours: 0.02, energyWh: 50, peakPowerW: 11_000, startSoc: 30, endSoc: 30 });
    const signal = evaluateSessionSignal(s, 'site', null, false, opts);
    expect(signal.causes).toContain('aborted_early');
  });

  it('does not flag a clean, complete session', () => {
    const s = session({ day: 0, hours: 4, startSoc: 20, endSoc: 80, powerW: 7000 });
    const signal = evaluateSessionSignal(s, 'site', 15 / 60, false, opts);
    expect(signal.suspect).toBe(false);
    expect(signal.causes).toEqual([]);
  });
});

describe('analyzeChargeInterruptions', () => {
  it('is empty and safe with no sessions', () => {
    const summary = analyzeChargeInterruptions([]);
    expect(summary.sites).toEqual([]);
    expect(summary.totalSessions).toBe(0);
    expect(summary.highestRiskSite).toBeNull();
  });

  it('ignores sessions with no location signal at all', () => {
    const summary = analyzeChargeInterruptions([
      session({ day: 0 }),
      session({ day: 1, place: 'Home' }),
    ]);
    expect(summary.sites).toHaveLength(1);
    expect(summary.evaluableSessions).toBe(1);
    expect(summary.totalSessions).toBe(2);
  });

  it('never lets a single-sample site claim outright certainty', () => {
    const summary = analyzeChargeInterruptions([
      session({ day: 0, place: 'Rare Stop', noEnd: true, endSoc: null }),
      // Keep this from being the "latest overall" exemption.
      session({ day: 10, place: 'Rare Stop', noEnd: false }),
    ]);
    const site = summary.sites.find((s) => s.label === 'Rare Stop')!;
    // One clearly-suspect session amid the evidence should not push the
    // mean anywhere near 100% thanks to the Jeffreys prior.
    expect(site.posteriorMean).toBeLessThan(0.9);
    expect(site.posteriorLow).toBeLessThan(0.5);
  });

  it('gives a well-evidenced healthy site both a high mean and a tight interval', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      session({ day: i * 2, place: 'Home', startSoc: 20, endSoc: 80, hours: 4, powerW: 7000 }),
    );
    const summary = analyzeChargeInterruptions(sessions);
    const site = summary.sites[0]!;
    expect(site.posteriorMean).toBeLessThan(0.2);
    expect(site.posteriorHigh - site.posteriorLow).toBeLessThan(0.3);
  });

  it('identifies the highest-risk site by the conservative bound, not raw mean', () => {
    // Site A: one suspicious sample only (wide interval, higher raw mean).
    const siteA = [session({ day: 0, place: 'A', noEnd: true, endSoc: null })];
    // Site B: consistently ~40% suspect over many sessions (tighter, real risk).
    const siteB = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0
        ? session({ day: 20 + i, place: 'B', noEnd: true, endSoc: null })
        : session({ day: 20 + i, place: 'B', startSoc: 20, endSoc: 80, hours: 4 }),
    );
    // Anchor "latest overall" far in the future so neither site's most
    // recent sample is silently exempted from the missing-field checks.
    const anchor = session({ day: 200, place: 'Anchor' });
    const summary = analyzeChargeInterruptions([...siteA, ...siteB, anchor]);
    expect(summary.highestRiskSite?.label).toBe('B');
  });

  it('detects a rising trend within a site history', () => {
    const clean = Array.from({ length: 5 }, (_, i) =>
      session({ day: i * 2, place: 'Drifting', startSoc: 20, endSoc: 80, hours: 4 }),
    );
    const broken = Array.from({ length: 5 }, (_, i) =>
      session({ day: 40 + i * 2, place: 'Drifting', noEnd: true, endSoc: null }),
    );
    const anchor = session({ day: 200, place: 'Anchor' });
    const summary = analyzeChargeInterruptions([...clean, ...broken, anchor]);
    const site = summary.sites.find((s) => s.label === 'Drifting')!;
    expect(site.recentTrend).toBe('rising');
    expect(site.topCauses.length).toBeGreaterThan(0);
  });

  it('reports insufficient_data trend for a thin history', () => {
    const summary = analyzeChargeInterruptions([
      session({ day: 0, place: 'New Spot' }),
      session({ day: 300, place: 'Anchor' }),
    ]);
    const site = summary.sites.find((s) => s.label === 'New Spot')!;
    expect(site.recentTrend).toBe('insufficient_data');
  });
});
