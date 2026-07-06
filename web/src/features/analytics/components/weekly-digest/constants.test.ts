import { describe, it, expect } from 'vitest';

import {
  DAY_LABELS,
  CITY_PAIRS,
  ALERT_SEVERITY_COLORS,
  CO2_PER_KWH_GASOLINE_KG,
} from './constants';
import { dayOfWeekIndex, findCityPair } from './helpers';
import { CHART_COLORS } from '@/components/charts';
import { STATUS_COLORS } from '@/lib/colors';

// ---------------------------------------------------------------------------
// weekly-digest/constants — data-contract lock + immutability hardening
//
// These constants are shared, module-level singletons that the Weekly Digest
// hook and helpers depend on structurally: `DAY_LABELS[dayOfWeekIndex(date)]`
// bins daily distance/energy, `findCityPair()` scans `CITY_PAIRS` for the fun
// fact, the alert pie colours each severity via `ALERT_SEVERITY_COLORS`, and
// `CO2_PER_KWH_GASOLINE_KG` scales energy into an emissions-saved estimate. A
// silent value drift, a reshuffled weekday order, or an accidental mutation of
// one of these singletons would surface as a mis-labelled chart axis, a wrong
// fun fact, an off-palette pie slice, or a corrupted estimate. The cases below
// pin: (1) the DAY_LABELS ↔ dayOfWeekIndex ordering contract, (2) the
// CITY_PAIRS shape + nearest-match selection, (3) the severity→colour mapping
// against its source-of-truth palettes plus the consumer's unknown-severity
// fallback, (4) the CO₂ factor and its multiplier semantics, and (5) that all
// three collections are frozen so no consumer can mutate the shared instance.
// ---------------------------------------------------------------------------

const HEX6 = /^#[0-9a-fA-F]{6}$/;

describe('module exports', () => {
  it('exposes all four named constants', () => {
    expect(DAY_LABELS).toBeDefined();
    expect(CITY_PAIRS).toBeDefined();
    expect(ALERT_SEVERITY_COLORS).toBeDefined();
    expect(CO2_PER_KWH_GASOLINE_KG).toBeDefined();
  });
});

describe('DAY_LABELS', () => {
  it('has exactly seven Monday-first ISO weekday labels', () => {
    expect(DAY_LABELS).toHaveLength(7);
    expect([...DAY_LABELS]).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('contains no duplicate labels', () => {
    expect(new Set(DAY_LABELS).size).toBe(DAY_LABELS.length);
  });

  // The load-bearing invariant: the hook does `DAY_LABELS[dayOfWeekIndex(date)]`
  // to bucket telemetry, so the label at each index MUST match the day that
  // `dayOfWeekIndex` maps into that slot. Noon-local ISO strings keep the day
  // stable across time zones. Jan 1–7 2024 happen to be a clean Mon→Sun run.
  it.each<[string, number, string]>([
    ['2024-01-01T12:00:00', 0, 'Mon'],
    ['2024-01-02T12:00:00', 1, 'Tue'],
    ['2024-01-03T12:00:00', 2, 'Wed'],
    ['2024-01-04T12:00:00', 3, 'Thu'],
    ['2024-01-05T12:00:00', 4, 'Fri'],
    ['2024-01-06T12:00:00', 5, 'Sat'],
    ['2024-01-07T12:00:00', 6, 'Sun'],
  ])('aligns with dayOfWeekIndex: %s → index %i (%s)', (iso, idx, label) => {
    expect(dayOfWeekIndex(iso)).toBe(idx);
    expect(DAY_LABELS[idx]).toBe(label);
    expect(DAY_LABELS[dayOfWeekIndex(iso)]).toBe(label);
  });

  it('maps to one zeroed bin per weekday in order (digest binning shape)', () => {
    const bins = DAY_LABELS.map((day) => ({ day, distance: 0 }));
    expect(bins).toHaveLength(7);
    expect(bins.map((b) => b.day)).toEqual([...DAY_LABELS]);
    expect(bins.every((b) => b.distance === 0)).toBe(true);
  });

  it('is a frozen singleton that rejects mutation', () => {
    expect(Object.isFrozen(DAY_LABELS)).toBe(true);
    expect(() => (DAY_LABELS as unknown as string[]).push('Xyz')).toThrow();
    expect([...DAY_LABELS]).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});

describe('CITY_PAIRS', () => {
  it('lists six reference intercity routes', () => {
    expect(CITY_PAIRS).toHaveLength(6);
  });

  it('gives every route a non-empty origin, destination, and positive distance', () => {
    for (const pair of CITY_PAIRS) {
      expect(pair.from.length).toBeGreaterThan(0);
      expect(pair.to.length).toBeGreaterThan(0);
      expect(pair.from).not.toBe(pair.to);
      expect(Number.isFinite(pair.km)).toBe(true);
      expect(pair.km).toBeGreaterThan(0);
    }
  });

  it('uses distinct distances so nearest-match selection is unambiguous', () => {
    const distances = CITY_PAIRS.map((p) => p.km);
    expect(new Set(distances).size).toBe(distances.length);
  });

  // Coupling with the fun-fact consumer: findCityPair picks the route whose km
  // is closest to the week's total distance.
  it.each<[number, string, string]>([
    [355, 'New York', 'Boston'], // ~350 route
    [880, 'Sydney', 'Melbourne'], // exact match on the longest route
    [500, 'Tokyo', 'Osaka'], // 515 is closer than 460/585
    [0, 'New York', 'Boston'], // smallest km wins for a near-zero week
  ])('findCityPair(%i) selects %s → %s', (distance, from, to) => {
    const pair = findCityPair(distance);
    expect(pair).toBeDefined();
    expect(pair?.from).toBe(from);
    expect(pair?.to).toBe(to);
  });

  it('is a frozen singleton that rejects mutation', () => {
    expect(Object.isFrozen(CITY_PAIRS)).toBe(true);
    expect(() =>
      (CITY_PAIRS as unknown as { from: string; to: string; km: number }[]).push({
        from: 'A',
        to: 'B',
        km: 1,
      }),
    ).toThrow();
    expect(CITY_PAIRS).toHaveLength(6);
  });
});

describe('ALERT_SEVERITY_COLORS', () => {
  it('maps exactly the info / warning / critical severities', () => {
    expect(Object.keys(ALERT_SEVERITY_COLORS).sort()).toEqual(['critical', 'info', 'warning']);
  });

  it('binds each severity to its source-of-truth palette colour', () => {
    expect(ALERT_SEVERITY_COLORS.info).toBe(CHART_COLORS[0]);
    expect(ALERT_SEVERITY_COLORS.warning).toBe(STATUS_COLORS.warning);
    expect(ALERT_SEVERITY_COLORS.critical).toBe(STATUS_COLORS.critical);
  });

  it('exposes valid, visually distinct hex colours for each slice', () => {
    const values = Object.values(ALERT_SEVERITY_COLORS);
    for (const color of values) {
      expect(color).toMatch(HEX6);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  it('has no entry for an unknown severity and resolves to the neutral fallback', () => {
    // Mirrors `ALERT_SEVERITY_COLORS[severity] ?? CHART_COLORS[4]` in the hook.
    expect(ALERT_SEVERITY_COLORS['debug']).toBeUndefined();
    const resolved = ALERT_SEVERITY_COLORS['debug'] ?? CHART_COLORS[4];
    expect(resolved).toBe(CHART_COLORS[4]);
  });

  it('returns the mapped colour (not the fallback) for a known severity', () => {
    const resolved = ALERT_SEVERITY_COLORS['info'] ?? CHART_COLORS[4];
    expect(resolved).toBe(CHART_COLORS[0]);
    expect(resolved).not.toBe(CHART_COLORS[4]);
  });

  it('is a frozen singleton that rejects new keys', () => {
    expect(Object.isFrozen(ALERT_SEVERITY_COLORS)).toBe(true);
    expect(() =>
      Object.defineProperty(ALERT_SEVERITY_COLORS, 'debug', { value: '#000000' }),
    ).toThrow();
    expect(ALERT_SEVERITY_COLORS['debug']).toBeUndefined();
  });
});

describe('CO2_PER_KWH_GASOLINE_KG', () => {
  it('is the pinned well-to-wheel gasoline factor', () => {
    expect(CO2_PER_KWH_GASOLINE_KG).toBe(0.21);
  });

  it('is a positive, finite factor below 1 kg per kWh', () => {
    expect(Number.isFinite(CO2_PER_KWH_GASOLINE_KG)).toBe(true);
    expect(CO2_PER_KWH_GASOLINE_KG).toBeGreaterThan(0);
    expect(CO2_PER_KWH_GASOLINE_KG).toBeLessThan(1);
  });

  it.each<[number, number]>([
    [0, 0],
    [100, 21],
    [250, 52.5],
  ])('scales %i kWh of energy into %d kg of CO₂ saved', (energy, expected) => {
    expect(energy * CO2_PER_KWH_GASOLINE_KG).toBeCloseTo(expected, 10);
  });

  it('is monotonic — more energy means more CO₂ saved', () => {
    expect(200 * CO2_PER_KWH_GASOLINE_KG).toBeGreaterThan(100 * CO2_PER_KWH_GASOLINE_KG);
  });
});
