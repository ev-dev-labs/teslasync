import { describe, it, expect } from 'vitest';

import {
  FLAG_VALUE_KINDS,
  classifyFlagValue,
  type FlagValueKind,
} from './flagValueKind';

// ---------------------------------------------------------------------------
// flagValueKind hardening
//
// `classifyFlagValue` is the single source of truth shared by FlagStatsBand
// (KPI counts) and FlagCompositionPanel (proportional breakdown). If the two
// panels ever disagreed on how a value is bucketed the summary numbers would
// silently drift, so every branch — including the check-ORDER that lets
// `null`/`[]` win over `typeof value === 'object'` — is pinned here against
// concrete inputs, and a completeness/soundness invariant guarantees the
// classifier stays in lock-step with the FLAG_VALUE_KINDS display order.
// ---------------------------------------------------------------------------

// One representative value per declared kind. Used to prove the classifier and
// the display-order constant describe exactly the same set of buckets.
const SAMPLES: Record<FlagValueKind, unknown> = {
  boolean: true,
  number: 7,
  string: 'flag-value',
  object: { nested: { deep: 1 } },
  array: [1, 2, 3],
  null: null,
};

describe('FLAG_VALUE_KINDS', () => {
  it('lists exactly the six JSON buckets in the documented display order', () => {
    expect(FLAG_VALUE_KINDS).toEqual([
      'boolean',
      'number',
      'string',
      'object',
      'array',
      'null',
    ]);
  });

  it('contains no duplicate buckets', () => {
    expect(new Set(FLAG_VALUE_KINDS).size).toBe(FLAG_VALUE_KINDS.length);
  });

  it('is frozen so a rogue consumer cannot reorder the shared constant', () => {
    expect(Object.isFrozen(FLAG_VALUE_KINDS)).toBe(true);
    // ESM test modules run in strict mode → mutating a frozen array throws.
    expect(() =>
      (FLAG_VALUE_KINDS as unknown as FlagValueKind[]).push('boolean'),
    ).toThrow();
    expect(FLAG_VALUE_KINDS).toHaveLength(6);
  });

  it('covers precisely the kinds the classifier can emit (no drift)', () => {
    // Every declared bucket must be produced by the classifier…
    expect(Object.keys(SAMPLES).sort()).toEqual([...FLAG_VALUE_KINDS].sort());
    // …and each representative sample must classify back to its own bucket.
    for (const kind of FLAG_VALUE_KINDS) {
      expect(classifyFlagValue(SAMPLES[kind])).toBe(kind);
    }
  });
});

describe('classifyFlagValue — primitives', () => {
  it('buckets both boolean literals as "boolean"', () => {
    expect(classifyFlagValue(true)).toBe('boolean');
    expect(classifyFlagValue(false)).toBe('boolean');
  });

  it('buckets every numeric shape — including 0, negatives, NaN and Infinity — as "number"', () => {
    expect(classifyFlagValue(42)).toBe('number');
    expect(classifyFlagValue(3.14)).toBe('number');
    expect(classifyFlagValue(0)).toBe('number');
    expect(classifyFlagValue(-1)).toBe('number');
    expect(classifyFlagValue(NaN)).toBe('number');
    expect(classifyFlagValue(Infinity)).toBe('number');
  });

  it('buckets strings — including the empty string — as "string"', () => {
    expect(classifyFlagValue('hello')).toBe('string');
    expect(classifyFlagValue('')).toBe('string');
  });
});

describe('classifyFlagValue — nullish', () => {
  it('buckets null as "null"', () => {
    expect(classifyFlagValue(null)).toBe('null');
  });

  it('folds undefined (an absent value, not valid JSON) into the "null" bucket', () => {
    expect(classifyFlagValue(undefined)).toBe('null');
  });
});

describe('classifyFlagValue — containers', () => {
  it('buckets arrays as "array", empty or populated, ahead of the typeof-object catch-all', () => {
    // Regression pin: Array.isArray MUST run before `typeof value === 'object'`,
    // otherwise arrays would be mislabeled "object" and inflate the structured
    // count differently across the two panels.
    expect(classifyFlagValue([])).toBe('array');
    expect(classifyFlagValue([1, 2, 3])).toBe('array');
    expect(classifyFlagValue([{ a: 1 }, [2]])).toBe('array');
  });

  it('buckets plain objects as "object", empty or populated', () => {
    expect(classifyFlagValue({})).toBe('object');
    expect(classifyFlagValue({ enabled: true, rollout: 0.5 })).toBe('object');
  });

  it('does not confuse null with a plain object (null is caught first)', () => {
    expect(classifyFlagValue(null)).not.toBe('object');
    expect(classifyFlagValue({})).not.toBe('null');
  });
});

describe('classifyFlagValue — soundness', () => {
  it('always returns a member of FLAG_VALUE_KINDS and never throws, even on non-JSON inputs', () => {
    const exotic: unknown[] = [
      true,
      1,
      'x',
      null,
      undefined,
      [],
      {},
      () => 'fn',
      Symbol('s'),
      10n,
      new Date(),
      new Map(),
    ];
    for (const value of exotic) {
      let kind: FlagValueKind | undefined;
      expect(() => {
        kind = classifyFlagValue(value);
      }).not.toThrow();
      expect(FLAG_VALUE_KINDS).toContain(kind);
    }
  });

  it('routes exotic non-JSON values through the "object" catch-all', () => {
    // Feature-flag values are opaque JSON; anything that is not a recognised
    // primitive/array/null lands in the object bucket rather than crashing.
    expect(classifyFlagValue(() => undefined)).toBe('object');
    expect(classifyFlagValue(Symbol('flag'))).toBe('object');
    expect(classifyFlagValue(10n)).toBe('object');
    expect(classifyFlagValue(new Date())).toBe('object');
  });
});
