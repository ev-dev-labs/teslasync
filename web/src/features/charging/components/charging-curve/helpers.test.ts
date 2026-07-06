// charging-curve/helpers unit tests.
//
// Every export is exercised across multiple facets / branches:
//   isDcSession          — charger_type presence, the 20 kW peak-power
//                          threshold (exclusive boundary) and the fully-null
//                          "AC" fallback.
//   getChargerLabel      — Tesla → Supercharger, any other charger_type or a
//                          high peak → DC Fast, otherwise Home / AC.
//   durationMinutes      — happy path, null end, non-positive/equal ranges,
//                          unparseable timestamps and minute rounding.
//   distanceAddedM       — positive delta, both missing-odometer guards and the
//                          zero/negative-delta → null branch.
//   sessionLabel         — composed "date — label — energy kWh" string plus the
//                          "?" fallback when energy is missing.
//   generateChargingCurve— flat AC curve, tapered DC curve (monotonic, clamped
//                          ≥ 0), default 0–100 span and — the important one — the
//                          non-finite SOC guard that keeps the sampling loop from
//                          spinning forever on ±Infinity / NaN telemetry.
//   avg                  — mean, empty/single/negative arrays and the nullish
//                          guard.
//
// Timestamps use an explicit "Z" (UTC) so duration maths are timezone-neutral.
// The global number locale is pinned to en-US so sessionLabel's formatted energy
// string is deterministic regardless of the CI host locale.

import { describe, it, expect, beforeAll } from 'vitest';
import { setGlobalLocale } from '@/lib/numberFormat';
import type { ChargingSession } from '@/api/types';
import {
  isDcSession,
  getChargerLabel,
  durationMinutes,
  distanceAddedM,
  sessionLabel,
  generateChargingCurve,
  avg,
} from './helpers';

beforeAll(() => {
  setGlobalLocale('en-US');
});

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2026-07-04T10:00:00Z',
    ended_at: '2026-07-04T11:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: 1_000_000,
    end_odometer_m: 1_050_000,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 42_500,
    peak_power_w: 150_000,
    avg_power_w: 90_000,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: '2026-07-04T10:00:00Z',
    duration_min: 60,
    ...overrides,
  };
}

describe('isDcSession', () => {
  it('treats any populated charger_type as a DC session', () => {
    expect(isDcSession(makeSession({ charger_type: 'Tesla', peak_power_w: null }))).toBe(true);
    expect(isDcSession(makeSession({ charger_type: 'CCS', peak_power_w: null }))).toBe(true);
  });

  it('classifies by peak power only above the 20 kW threshold (exclusive)', () => {
    expect(isDcSession(makeSession({ charger_type: null, peak_power_w: 20_001 }))).toBe(true);
    expect(isDcSession(makeSession({ charger_type: null, peak_power_w: 20_000 }))).toBe(false);
    expect(isDcSession(makeSession({ charger_type: null, peak_power_w: 7_000 }))).toBe(false);
  });

  it('is false for a null charger_type with no/low power (AC)', () => {
    expect(isDcSession(makeSession({ charger_type: null, peak_power_w: null }))).toBe(false);
    // Empty-string charger_type is falsy and must not force a DC classification.
    expect(isDcSession(makeSession({ charger_type: '', peak_power_w: null }))).toBe(false);
  });
});

describe('getChargerLabel', () => {
  it('labels Tesla hardware as a Supercharger (case-insensitive contains)', () => {
    expect(getChargerLabel(makeSession({ charger_type: 'Tesla' }))).toBe('Supercharger');
    expect(getChargerLabel(makeSession({ charger_type: 'tesla supercharger v3' }))).toBe('Supercharger');
  });

  it('labels any other charger_type or a high peak as DC Fast', () => {
    expect(getChargerLabel(makeSession({ charger_type: 'CCS' }))).toBe('DC Fast');
    expect(getChargerLabel(makeSession({ charger_type: null, peak_power_w: 50_000 }))).toBe('DC Fast');
  });

  it('falls back to Home / AC when nothing indicates DC', () => {
    expect(getChargerLabel(makeSession({ charger_type: null, peak_power_w: null }))).toBe('Home / AC');
    expect(getChargerLabel(makeSession({ charger_type: null, peak_power_w: 5_000 }))).toBe('Home / AC');
  });
});

describe('durationMinutes', () => {
  it('returns the whole-minute delta between two timestamps', () => {
    expect(durationMinutes('2026-07-04T10:00:00Z', '2026-07-04T11:00:00Z')).toBe(60);
    expect(durationMinutes('2026-07-04T10:00:00Z', '2026-07-04T10:15:00Z')).toBe(15);
  });

  it('rounds to the nearest minute', () => {
    // 90s → 1.5 min → rounds up to 2.
    expect(durationMinutes('2026-07-04T10:00:00Z', '2026-07-04T10:01:30Z')).toBe(2);
    // 29s → 0.48 min → rounds down to 0.
    expect(durationMinutes('2026-07-04T10:00:00Z', '2026-07-04T10:00:29Z')).toBe(0);
  });

  it('returns 0 for a null end, equal instants or a negative range', () => {
    expect(durationMinutes('2026-07-04T10:00:00Z', null)).toBe(0);
    expect(durationMinutes('2026-07-04T10:00:00Z', '2026-07-04T10:00:00Z')).toBe(0);
    expect(durationMinutes('2026-07-04T11:00:00Z', '2026-07-04T10:00:00Z')).toBe(0);
  });

  it('returns 0 for unparseable timestamps instead of NaN', () => {
    expect(durationMinutes('not-a-date', '2026-07-04T11:00:00Z')).toBe(0);
    expect(durationMinutes('2026-07-04T10:00:00Z', 'garbage')).toBe(0);
  });
});

describe('distanceAddedM', () => {
  it('returns the positive odometer delta in meters', () => {
    expect(distanceAddedM(makeSession({ start_odometer_m: 1_000_000, end_odometer_m: 1_050_000 }))).toBe(50_000);
  });

  it('returns null when either odometer reading is missing', () => {
    expect(distanceAddedM(makeSession({ start_odometer_m: null }))).toBeNull();
    expect(distanceAddedM(makeSession({ end_odometer_m: null }))).toBeNull();
  });

  it('returns null for a zero or negative delta', () => {
    expect(distanceAddedM(makeSession({ start_odometer_m: 1_000_000, end_odometer_m: 1_000_000 }))).toBeNull();
    expect(distanceAddedM(makeSession({ start_odometer_m: 1_050_000, end_odometer_m: 1_000_000 }))).toBeNull();
  });
});

describe('sessionLabel', () => {
  it('composes a "date — label — energy kWh" string', () => {
    const label = sessionLabel(makeSession({ charger_type: 'Tesla', total_energy_added_wh: 42_500 }));
    expect(label).toContain('Supercharger');
    expect(label).toContain('42.5 kWh');
    // Two em-dash separators between the three segments.
    expect(label.split(' — ')).toHaveLength(3);
  });

  it('reflects the charger classification in the label segment', () => {
    expect(sessionLabel(makeSession({ charger_type: null, peak_power_w: null }))).toContain('Home / AC');
    expect(sessionLabel(makeSession({ charger_type: 'CCS' }))).toContain('DC Fast');
  });

  it('renders "?" when the energy figure is missing', () => {
    const label = sessionLabel(
      makeSession({ total_energy_added_wh: null as unknown as number }),
    );
    expect(label).toContain('? kWh');
  });
});

describe('generateChargingCurve', () => {
  it('produces a flat curve at peak power for an AC session', () => {
    const curve = generateChargingCurve(
      makeSession({ charger_type: null, peak_power_w: 11_000, start_soc_pct: 20, end_soc_pct: 80 }),
    );
    // Inclusive span 20..80 → 61 samples.
    expect(curve).toHaveLength(61);
    expect(curve.every((p) => p.power === 11)).toBe(true);
    expect(curve[0]).toEqual({ soc: 20, power: 11 });
  });

  it('tapers a DC curve monotonically and never emits negative power', () => {
    const curve = generateChargingCurve(
      makeSession({ charger_type: 'Tesla', peak_power_w: 150_000, start_soc_pct: 20, end_soc_pct: 100 }),
    );
    expect(curve).toHaveLength(81);
    // Below 50% SOC the curve holds peak (150 kW).
    expect(curve[0]).toEqual({ soc: 20, power: 150 });
    // Non-increasing across the whole sweep and always clamped to ≥ 0.
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].power).toBeLessThanOrEqual(curve[i - 1].power);
      expect(curve[i].power).toBeGreaterThanOrEqual(0);
    }
    // Tapered tail is well below peak by 100%.
    expect(curve[curve.length - 1].power).toBeLessThan(150);
  });

  it('defaults a missing start/end SOC to the full 0–100 span', () => {
    const curve = generateChargingCurve(
      makeSession({ start_soc_pct: null as unknown as number, end_soc_pct: null }),
    );
    expect(curve).toHaveLength(101);
    expect(curve[0].soc).toBe(0);
    expect(curve[curve.length - 1].soc).toBe(100);
  });

  it('guards non-finite SOC bounds so the sampling loop always terminates', () => {
    // Regression: an Infinity end (or -Infinity start) previously spun the
    // `for (soc; soc <= endSoc; soc += 1)` loop forever and hung the UI.
    const infiniteEnd = generateChargingCurve(
      makeSession({ start_soc_pct: 20, end_soc_pct: Infinity }),
    );
    expect(infiniteEnd.length).toBeGreaterThan(0);
    expect(infiniteEnd.length).toBeLessThanOrEqual(201);
    expect(infiniteEnd[infiniteEnd.length - 1].soc).toBeLessThanOrEqual(100);

    const infiniteStart = generateChargingCurve(
      makeSession({ start_soc_pct: -Infinity, end_soc_pct: 80 }),
    );
    expect(infiniteStart[0].soc).toBe(0);
    expect(infiniteStart).toHaveLength(81);

    const nanStart = generateChargingCurve(
      makeSession({ start_soc_pct: NaN, end_soc_pct: 40 }),
    );
    expect(nanStart[0].soc).toBe(0);
    expect(nanStart).toHaveLength(41);
  });

  it('returns an empty curve for an inverted range', () => {
    const curve = generateChargingCurve(makeSession({ start_soc_pct: 90, end_soc_pct: 10 }));
    expect(curve).toEqual([]);
  });
});

describe('avg', () => {
  it('computes the arithmetic mean', () => {
    expect(avg([10, 20, 30])).toBe(20);
    expect(avg([5])).toBe(5);
    expect(avg([-10, 10])).toBe(0);
  });

  it('returns 0 for an empty or nullish array instead of NaN/throwing', () => {
    expect(avg([])).toBe(0);
    expect(avg(undefined as unknown as number[])).toBe(0);
    expect(avg(null as unknown as number[])).toBe(0);
  });
});
