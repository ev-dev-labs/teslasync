import { describe, it, expect } from 'vitest';
import type { ChargingSession } from '@/types/charging';
import { analyzeChargerHealth, siteKeyOf, toSessionMetric } from './chargerHealth';

const ANCHOR = Date.UTC(2026, 0, 1);

let nextId = 1;

interface SessionSpec {
  day: number;
  /** Mean power the plug delivered, W. */
  powerW: number;
  /** Session length in hours. */
  hours?: number;
  place?: string;
  lat?: number;
  lng?: number;
  startSoc?: number;
  endSoc?: number;
}

function session(spec: SessionSpec): ChargingSession {
  const hours = spec.hours ?? 2;
  const startedMs = ANCHOR + spec.day * 86_400_000;
  const started = new Date(startedMs).toISOString();
  const ended = new Date(startedMs + hours * 3_600_000).toISOString();
  return {
    id: `s${nextId++}`,
    vehicle_id: '1',
    charger_type: null,
    start_soc_pct: spec.startSoc ?? 30,
    end_soc_pct: spec.endSoc ?? 70,
    total_energy_added_wh: spec.powerW * hours,
    peak_power_w: spec.powerW,
    cost_decimal: null,
    started_at: started,
    ended_at: ended,
    start_ts: started,
    startedAt: started,
    duration_min: hours * 60,
    start_place: spec.place ?? null,
    start_lat: spec.lat ?? null,
    start_lng: spec.lng ?? null,
  };
}

describe('siteKeyOf', () => {
  it('prefers the place name and normalises case', () => {
    const a = siteKeyOf(session({ day: 0, powerW: 7000, place: 'Home Garage' }))!;
    const b = siteKeyOf(session({ day: 1, powerW: 7000, place: 'home garage' }))!;
    expect(a.key).toBe(b.key);
    expect(a.label).toBe('Home Garage');
  });

  it('falls back to a ~1 km geo cell', () => {
    const a = siteKeyOf(session({ day: 0, powerW: 7000, lat: 51.50131, lng: -0.14201 }))!;
    const b = siteKeyOf(session({ day: 1, powerW: 7000, lat: 51.50249, lng: -0.13884 }))!;
    expect(a.key).toBe(b.key);
    expect(a.key).toMatch(/^geo:/);
  });

  it('keeps genuinely different locations apart', () => {
    const a = siteKeyOf(session({ day: 0, powerW: 7000, lat: 51.5, lng: -0.14 }))!;
    const b = siteKeyOf(session({ day: 1, powerW: 7000, lat: 52.2, lng: -0.14 }))!;
    expect(a.key).not.toBe(b.key);
  });

  it('returns null when neither place nor coordinates are known', () => {
    expect(siteKeyOf(session({ day: 0, powerW: 7000 }))).toBeNull();
  });
});

describe('toSessionMetric', () => {
  it('derives power from energy and elapsed time', () => {
    const m = toSessionMetric(session({ day: 0, powerW: 11_000, hours: 3 }), 80, 600, 2000)!;
    expect(m.powerW).toBe(11_000);
    expect(m.durationS).toBe(10_800);
  });

  it('falls back to duration_min when ended_at is missing', () => {
    const s = session({ day: 0, powerW: 7000, hours: 2 });
    const m = toSessionMetric({ ...s, ended_at: null }, 80, 600, 2000)!;
    expect(m.powerW).toBe(7000);
  });

  it('rejects short, tiny and malformed sessions', () => {
    expect(toSessionMetric(session({ day: 0, powerW: 7000, hours: 0.05 }), 80, 600, 2000)).toBeNull();
    const tiny = { ...session({ day: 0, powerW: 7000 }), total_energy_added_wh: 100 };
    expect(toSessionMetric(tiny, 80, 600, 2000)).toBeNull();
    const broken = { ...session({ day: 0, powerW: 7000 }), started_at: 'nope', start_ts: 'nope' };
    expect(toSessionMetric(broken, 80, 600, 2000)).toBeNull();
  });

  it('flags sessions that mostly sat in the taper band', () => {
    const tapered = toSessionMetric(
      session({ day: 0, powerW: 20_000, startSoc: 78, endSoc: 100 }),
      80,
      600,
      2000,
    )!;
    expect(tapered.tapered).toBe(true);

    const clean = toSessionMetric(
      session({ day: 0, powerW: 20_000, startSoc: 20, endSoc: 70 }),
      80,
      600,
      2000,
    )!;
    expect(clean.tapered).toBe(false);
  });

  it('treats a session starting inside the taper band as tapered', () => {
    const s = { ...session({ day: 0, powerW: 9000, startSoc: 85 }), end_soc_pct: null };
    expect(toSessionMetric(s, 80, 600, 2000)!.tapered).toBe(true);
  });
});

describe('analyzeChargerHealth', () => {
  it('is empty and safe with no data', () => {
    const s = analyzeChargerHealth([]);
    expect(s.sites).toEqual([]);
    expect(s.degradedCount).toBe(0);
    expect(s.fastestSite).toBeNull();
    expect(s.primarySite).toBeNull();
  });

  it('calls a consistently performing site healthy', () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session({ day: i * 3, powerW: 11_000 + (i % 3) * 100, place: 'Home' }),
    );
    const site = analyzeChargerHealth(sessions).sites[0]!;
    expect(site.status).toBe('healthy');
    expect(site.performanceRatio).toBeGreaterThan(0.9);
    // "Time lost" is only meaningful for a site in trouble.
    expect(site.hoursLostPerYear).toBe(0);
  });

  it('flags a plug that fell from 11 kW to 7 kW', () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, i) => session({ day: i * 3, powerW: 11_000, place: 'Home' })),
      ...Array.from({ length: 5 }, (_, i) =>
        session({ day: 40 + i * 3, powerW: 7000, place: 'Home' }),
      ),
    ];
    const summary = analyzeChargerHealth(sessions);
    const site = summary.sites[0]!;
    expect(site.status).toBe('degraded');
    expect(site.performanceRatio).toBeLessThan(0.75);
    expect(site.hoursLostPerYear).toBeGreaterThan(0);
    expect(summary.degradedCount).toBe(1);
  });

  it('separates a mild slide from an outright failure', () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, i) => session({ day: i * 3, powerW: 11_000, place: 'Home' })),
      ...Array.from({ length: 5 }, (_, i) =>
        session({ day: 40 + i * 3, powerW: 9500, place: 'Home' }),
      ),
    ];
    expect(analyzeChargerHealth(sessions).sites[0]!.status).toBe('degrading');
  });

  it('does not punish a site that was always slow', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session({ day: i * 3, powerW: 2300, place: 'Granny Socket' }),
    );
    const site = analyzeChargerHealth(sessions).sites[0]!;
    expect(site.status).toBe('healthy');
    expect(site.kind).toBe('ac');
  });

  it('does not let tapered full charges set the benchmark', () => {
    const sessions = [
      ...Array.from({ length: 6 }, (_, i) =>
        session({ day: i * 2, powerW: 120_000, startSoc: 20, endSoc: 60 }),
      ),
      // Slow only because they ran to 100 %.
      ...Array.from({ length: 6 }, (_, i) =>
        session({ day: 20 + i * 2, powerW: 30_000, startSoc: 82, endSoc: 100 }),
      ),
    ].map((s) => ({ ...s, start_place: 'Supercharger' }));
    const site = analyzeChargerHealth(sessions).sites[0]!;
    expect(site.status).toBe('healthy');
    expect(site.ratedSessions).toBe(6);
    expect(site.sessions).toBe(12);
    expect(site.kind).toBe('dc');
  });

  it('withholds judgement until a site has enough clean sessions', () => {
    const sessions = [session({ day: 0, powerW: 11_000, place: 'Rare Stop' })];
    const site = analyzeChargerHealth(sessions).sites[0]!;
    expect(site.status).toBe('unknown');
    expect(site.performanceRatio).toBe(0);
  });

  it('ranks worst sites first and identifies the primary and fastest', () => {
    // Home: 12 × 42 kWh = 504 kWh. Supercharger: 8 × 30 + 5 × 12.5 = 302.5 kWh.
    const home = Array.from({ length: 12 }, (_, i) =>
      session({ day: i * 3, powerW: 7000, hours: 6, place: 'Home' }),
    );
    const sc = [
      ...Array.from({ length: 8 }, (_, i) =>
        session({ day: i * 4, powerW: 120_000, hours: 0.25, place: 'Supercharger' }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        session({ day: 40 + i * 4, powerW: 50_000, hours: 0.25, place: 'Supercharger' }),
      ),
    ];
    const summary = analyzeChargerHealth([...home, ...sc]);
    expect(summary.sites[0]!.label).toBe('Supercharger');
    expect(summary.sites[0]!.status).toBe('degraded');
    expect(summary.primarySite!.label).toBe('Home');
    expect(summary.fastestSite!.label).toBe('Supercharger');
  });

  it('ignores sessions with no location at all', () => {
    const summary = analyzeChargerHealth([
      session({ day: 0, powerW: 11_000 }),
      session({ day: 1, powerW: 11_000, place: 'Home' }),
    ]);
    expect(summary.sites).toHaveLength(1);
    expect(summary.usableSessions).toBe(1);
    expect(summary.totalSessions).toBe(2);
  });
});
