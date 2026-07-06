import { describe, it, expect } from 'vitest';
import {
  METRIC_SEMANTICS,
  resolveSemantic,
  type Direction,
  type MetricUnit,
  type MetricSemantic,
  type MetricId,
} from './metricSemantics';

// The full, closed sets the registry and inline callers are allowed to use.
// Kept in sync with the `Direction` / `MetricUnit` unions by hand so the tests
// fail loudly if either union grows without the registry being reviewed.
const VALID_DIRECTIONS: readonly Direction[] = ['higher_better', 'lower_better', 'neutral'];
const VALID_UNITS: readonly MetricUnit[] = [
  'currency', 'percent', 'mi', 'km', 'kwh', 'wh', 'wh_per_mi',
  'h', 'min', 'count', 'mph', 'kph', 'c', 'f', 'bar',
];

describe('METRIC_SEMANTICS registry', () => {
  const entries = Object.entries(METRIC_SEMANTICS) as [MetricId, MetricSemantic][];

  it('is a non-empty registry', () => {
    expect(entries.length).toBeGreaterThanOrEqual(17);
  });

  it('every entry.id matches its map key (guards copy/paste when extending)', () => {
    for (const [key, semantic] of entries) {
      expect(semantic.id).toBe(key);
    }
  });

  it('every entry.direction is a valid Direction', () => {
    for (const [, semantic] of entries) {
      expect(VALID_DIRECTIONS).toContain(semantic.direction);
    }
  });

  it('every entry.unit (when present) is a valid MetricUnit', () => {
    for (const [, semantic] of entries) {
      if (semantic.unit !== undefined) {
        expect(VALID_UNITS).toContain(semantic.unit);
      }
    }
  });

  it('exposes the documented core metric ids', () => {
    const keys = Object.keys(METRIC_SEMANTICS);
    expect(keys).toContain('cost');
    expect(keys).toContain('range');
    expect(keys).toContain('efficiency');
    expect(keys).toContain('battery_health_pct');
    expect(keys).toContain('distance');
  });

  it.each([
    ['cost', 'lower_better', 'currency'],
    ['cost_per_mi', 'lower_better', 'currency'],
    ['energy_consumed', 'lower_better', 'kwh'],
    ['energy_per_mi', 'lower_better', 'wh_per_mi'],
    ['range', 'higher_better', 'mi'],
    ['efficiency', 'lower_better', 'wh_per_mi'],
    ['regen_pct', 'higher_better', 'percent'],
    ['drive_score', 'higher_better', 'count'],
    ['vampire_drain', 'lower_better', 'kwh'],
    ['idle_time', 'lower_better', 'h'],
    ['distance', 'neutral', 'mi'],
    ['trip_count', 'neutral', 'count'],
    ['charging_sessions', 'neutral', 'count'],
    ['battery_health_pct', 'higher_better', 'percent'],
    ['speed_avg', 'neutral', 'mph'],
    ['temperature', 'neutral', 'c'],
    ['pressure', 'neutral', 'bar'],
  ] as const)('%s → %s / %s', (id, direction, unit) => {
    const semantic = METRIC_SEMANTICS[id];
    expect(semantic.direction).toBe(direction);
    expect(semantic.unit).toBe(unit);
  });
});

describe('resolveSemantic — registered string ids', () => {
  it('returns the canonical registry entry for a known id', () => {
    const s = resolveSemantic('range');
    expect(s).toEqual({ id: 'range', direction: 'higher_better', unit: 'mi' });
  });

  it('returns the SAME object reference (no per-call allocation) for a known id', () => {
    expect(resolveSemantic('cost')).toBe(METRIC_SEMANTICS.cost);
  });

  it('resolves a string id and its object form to the same canonical entry', () => {
    expect(resolveSemantic('drive_score')).toBe(resolveSemantic(METRIC_SEMANTICS.drive_score));
  });
});

describe('resolveSemantic — unknown / typo string ids', () => {
  it('falls back to a neutral semantic carrying the original id', () => {
    // Unknown ids are tolerated at runtime (e.g. a typo passed via JS).
    const s = resolveSemantic('totally_made_up' as MetricId);
    expect(s).toEqual({ id: 'totally_made_up', direction: 'neutral' });
  });

  it('leaves unit undefined for an unknown id', () => {
    const s = resolveSemantic('totally_made_up' as MetricId);
    expect(s.unit).toBeUndefined();
  });

  it('treats the empty string as an unknown id (no crash)', () => {
    expect(resolveSemantic('' as MetricId)).toEqual({ id: '', direction: 'neutral' });
  });
});

describe('resolveSemantic — MetricSemantic pass-through', () => {
  it('returns a fully-formed MetricSemantic object unchanged (same reference)', () => {
    const custom: MetricSemantic = { id: 'custom_metric', direction: 'higher_better', unit: 'kwh' };
    expect(resolveSemantic(custom)).toBe(custom);
  });

  it('preserves a passed-through id rather than overwriting it with "inline"', () => {
    const custom: MetricSemantic = { id: 'custom_metric', direction: 'lower_better' };
    expect(resolveSemantic(custom).id).toBe('custom_metric');
  });
});

describe('resolveSemantic — inline { direction, unit } objects', () => {
  it('wraps an inline object with the "inline" sentinel id', () => {
    const s = resolveSemantic({ direction: 'lower_better', unit: 'min' });
    expect(s).toEqual({ id: 'inline', direction: 'lower_better', unit: 'min' });
  });

  it('keeps unit undefined when the inline object omits it', () => {
    const s = resolveSemantic({ direction: 'higher_better' });
    expect(s).toEqual({ id: 'inline', direction: 'higher_better', unit: undefined });
    expect(s.unit).toBeUndefined();
  });

  it('routes an object whose id is not a string through the inline branch', () => {
    // Malformed input (non-string id) must not be treated as a MetricSemantic.
    // @ts-expect-error — intentionally invalid id type for a runtime robustness check.
    const s = resolveSemantic({ id: 123, direction: 'neutral', unit: 'mi' });
    expect(s).toEqual({ id: 'inline', direction: 'neutral', unit: 'mi' });
  });
});

describe('resolveSemantic — nullish input (regression: must not throw)', () => {
  it('returns a neutral semantic for null instead of throwing', () => {
    expect(() => resolveSemantic(null)).not.toThrow();
    expect(resolveSemantic(null)).toEqual({ id: 'unknown', direction: 'neutral' });
  });

  it('returns a neutral semantic for undefined instead of throwing', () => {
    expect(() => resolveSemantic(undefined)).not.toThrow();
    expect(resolveSemantic(undefined)).toEqual({ id: 'unknown', direction: 'neutral' });
  });

  it('never produces a nullish direction (the field <Delta> colours on)', () => {
    const direction: Direction = resolveSemantic(null).direction;
    expect(VALID_DIRECTIONS).toContain(direction);
  });
});
