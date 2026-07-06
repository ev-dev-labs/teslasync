import { describe, it, expect } from 'vitest';

import {
  parseFeatureEntries,
  summarizeFeatureEntries,
  buildFeatureComposition,
  type FeatureFlagEntry,
} from './parseFeatureFlags';

// ---------------------------------------------------------------------------
// parseFeatureFlags — pure parsing / aggregation for the Tesla account
// feature-config blob (`GET /api/v1/tesla/user/feature-config`).
//
// Tesla returns a flat map of `feature -> value` where each value is either a
// bare boolean (a "flag") or an object carrying an `enabled` field plus extra
// config ("configured"). These tests pin the normalisation contract, the
// enabled/disabled aggregation, and the composition breakdown — including the
// hardened branches: a non-plain-object payload yields an empty list, array
// values fall through to the flag branch, and the aggregators are null-safe.
// ---------------------------------------------------------------------------

/** Build a typed entry without repeating every field at each call site. */
function entry(over: Partial<FeatureFlagEntry> & Pick<FeatureFlagEntry, 'key'>): FeatureFlagEntry {
  return { enabled: false, details: null, kind: 'flag', ...over };
}

describe('parseFeatureEntries — invalid / empty payloads', () => {
  it.each([null, undefined, 42, 'flags', true, false, NaN])(
    'returns [] for the non-object payload %p',
    (value) => {
      expect(parseFeatureEntries(value)).toEqual([]);
    },
  );

  it('returns [] for an empty object', () => {
    expect(parseFeatureEntries({})).toEqual([]);
  });

  it('treats a top-level array as invalid (documented "plain object" contract)', () => {
    // Regression guard: `typeof [] === 'object'`, so a naive isRecord would
    // emit junk index-keyed rows ("0", "1", …) instead of an empty list.
    expect(parseFeatureEntries([true, false])).toEqual([]);
    expect(parseFeatureEntries([{ enabled: true }])).toEqual([]);
  });
});

describe('parseFeatureEntries — boolean flags', () => {
  it('normalises bare booleans into flag rows', () => {
    const rows = parseFeatureEntries({ alpha: true, beta: false });
    expect(rows).toEqual([
      { key: 'alpha', enabled: true, details: null, kind: 'flag' },
      { key: 'beta', enabled: false, details: null, kind: 'flag' },
    ]);
  });

  it('coerces truthy / falsy non-boolean primitives to the enabled state', () => {
    const rows = parseFeatureEntries({ zero: 0, five: 5, empty: '', text: 'x', nil: null });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
    expect(byKey.zero).toBe(false);
    expect(byKey.five).toBe(true);
    expect(byKey.empty).toBe(false);
    expect(byKey.text).toBe(true);
    expect(byKey.nil).toBe(false);
    // Every primitive value is a flag, never "configured".
    expect(rows.every((r) => r.kind === 'flag')).toBe(true);
  });

  it('treats an array-valued feature as a truthy flag, not a configured object', () => {
    // Post-hardening: arrays are excluded from the record branch, so an array
    // value resolves to Boolean(array) === true and carries no details.
    const rows = parseFeatureEntries({ tiers: [1, 2, 3], nothing: [] });
    expect(rows).toEqual([
      { key: 'nothing', enabled: true, details: null, kind: 'flag' },
      { key: 'tiers', enabled: true, details: null, kind: 'flag' },
    ]);
  });
});

describe('parseFeatureEntries — configured objects', () => {
  it('reads `enabled` and summarises the remaining sub-fields as details', () => {
    const rows = parseFeatureEntries({
      signaling: { enabled: true, tier: 'premium', limit: 5 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      key: 'signaling',
      enabled: true,
      details: 'tier: "premium", limit: 5',
      kind: 'configured',
    });
  });

  it('defaults `enabled` to false when the object omits it', () => {
    const rows = parseFeatureEntries({ partner: { subscribe: true } });
    expect(rows[0].enabled).toBe(false);
    expect(rows[0].kind).toBe('configured');
    expect(rows[0].details).toBe('subscribe: true');
  });

  it('yields null details when the only key is `enabled`', () => {
    const rows = parseFeatureEntries({ solo: { enabled: false } });
    expect(rows[0]).toEqual({ key: 'solo', enabled: false, details: null, kind: 'configured' });
  });

  it('JSON-encodes nested, string, boolean and null sub-field values', () => {
    const rows = parseFeatureEntries({
      cfg: { enabled: true, nested: { a: 1 }, name: 'x', on: false, missing: null },
    });
    const { details } = rows[0];
    expect(details).toContain('nested: {"a":1}');
    expect(details).toContain('name: "x"');
    expect(details).toContain('on: false');
    expect(details).toContain('missing: null');
  });
});

describe('parseFeatureEntries — ordering', () => {
  it('sorts rows by key using localeCompare', () => {
    const rows = parseFeatureEntries({ gamma: true, alpha: false, beta: true });
    expect(rows.map((r) => r.key)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('summarizeFeatureEntries', () => {
  it('returns all-zero metrics for an empty list', () => {
    expect(summarizeFeatureEntries([])).toEqual({
      total: 0,
      enabled: 0,
      disabled: 0,
      enabledRate: 0,
    });
  });

  it('counts enabled / disabled and computes the enabled rate', () => {
    const rows = [
      entry({ key: 'a', enabled: true }),
      entry({ key: 'b', enabled: false }),
      entry({ key: 'c', enabled: false }),
      entry({ key: 'd', enabled: false }),
    ];
    expect(summarizeFeatureEntries(rows)).toEqual({
      total: 4,
      enabled: 1,
      disabled: 3,
      enabledRate: 25,
    });
  });

  it('reports a 100% rate when every feature is enabled', () => {
    const rows = [entry({ key: 'a', enabled: true }), entry({ key: 'b', enabled: true })];
    expect(summarizeFeatureEntries(rows).enabledRate).toBe(100);
  });

  it('is null-safe when handed a missing list', () => {
    // Defensive hardening: the public util must not throw on nullish input.
    expect(summarizeFeatureEntries(undefined as unknown as FeatureFlagEntry[])).toEqual({
      total: 0,
      enabled: 0,
      disabled: 0,
      enabledRate: 0,
    });
  });
});

describe('buildFeatureComposition', () => {
  it('returns [] for an empty list', () => {
    expect(buildFeatureComposition([])).toEqual([]);
  });

  it('drops kinds that never occur so the chart has no all-zero column', () => {
    const rows = [entry({ key: 'a', kind: 'flag', enabled: true })];
    const composition = buildFeatureComposition(rows);
    expect(composition).toEqual([{ kind: 'flag', enabled: 1, disabled: 0, total: 1 }]);
    expect(composition.some((r) => r.kind === 'configured')).toBe(false);
  });

  it('groups enabled / disabled counts by kind in flag-then-configured order', () => {
    const rows = [
      entry({ key: 'f1', kind: 'flag', enabled: true }),
      entry({ key: 'f2', kind: 'flag', enabled: false }),
      entry({ key: 'c1', kind: 'configured', enabled: true }),
      entry({ key: 'c2', kind: 'configured', enabled: true }),
      entry({ key: 'c3', kind: 'configured', enabled: false }),
    ];
    expect(buildFeatureComposition(rows)).toEqual([
      { kind: 'flag', enabled: 1, disabled: 1, total: 2 },
      { kind: 'configured', enabled: 2, disabled: 1, total: 3 },
    ]);
  });

  it('is null-safe when handed a missing list', () => {
    expect(buildFeatureComposition(undefined as unknown as FeatureFlagEntry[])).toEqual([]);
  });
});

describe('parse → summarize → compose pipeline', () => {
  it('produces consistent aggregates from a realistic Tesla feature-config blob', () => {
    const blob = {
      signaling: { enabled: true, subscribe_connectivity: true },
      se_partner_authentication: { enabled: false },
      tesla_hardware_present: true,
      cellular_data: false,
    };

    const entries = parseFeatureEntries(blob);
    expect(entries.map((e) => e.key)).toEqual([
      'cellular_data',
      'se_partner_authentication',
      'signaling',
      'tesla_hardware_present',
    ]);

    const summary = summarizeFeatureEntries(entries);
    expect(summary).toEqual({ total: 4, enabled: 2, disabled: 2, enabledRate: 50 });

    const composition = buildFeatureComposition(entries);
    expect(composition).toEqual([
      { kind: 'flag', enabled: 1, disabled: 1, total: 2 },
      { kind: 'configured', enabled: 1, disabled: 1, total: 2 },
    ]);
  });
});
