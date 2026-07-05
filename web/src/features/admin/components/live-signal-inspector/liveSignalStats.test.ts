/**
 * liveSignalStats — pure derivation contract for the Live Signal Inspector.
 *
 * These helpers are the single coercion boundary between the backend's
 * `signalinspect.LiveState` envelope (`{ kind, value, source, age_ms, ts }`)
 * and every consumer on the page (KPI band, source/kind breakdowns, snapshot
 * table). Because the whole page trusts their output, the tests pin:
 *   - envelope vs bare-scalar detection and graceful degradation of malformed
 *     shapes (non-string kind/source, non-finite age, arrays, null/undefined),
 *   - kind classification via the canonical `ValueKind` name AND the JS-runtime
 *     fallback used for legacy bare scalars,
 *   - source normalisation onto the four layered buckets,
 *   - single-pass aggregation (counts, freshest age, ordered/filtered kinds)
 *     including the null-safe empty-snapshot path,
 *   - the compact human-readable age formatter across every unit threshold.
 */
import { describe, it, expect } from 'vitest';
import {
  rowFromEntry,
  rowsFromResponse,
  classifyKind,
  normalizeSource,
  computeStats,
  formatAge,
  KIND_ORDER,
  KIND_LABELS,
  type LiveSignalRow,
  type KindCategory,
  type SectionStatus,
} from './liveSignalStats';
import type { VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';

describe('rowFromEntry', () => {
  it('maps a full typed envelope onto a flat row', () => {
    const row = rowFromEntry('VehicleSpeed', {
      value: 62.5,
      kind: 'ValueKindFloat',
      source: 'l1',
      age_ms: 1200,
      timestamp: '2024-01-01T00:00:00Z',
    });
    expect(row).toEqual({
      name: 'VehicleSpeed',
      value: 62.5,
      kind: 'ValueKindFloat',
      source: 'l1',
      ageMs: 1200,
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  it('falls back to the typed `ts` mirror when `timestamp` is absent', () => {
    const row = rowFromEntry('Odometer', { value: 100, ts: '2024-05-05T00:00:00Z' });
    expect(row.timestamp).toBe('2024-05-05T00:00:00Z');
    expect(row.value).toBe(100);
  });

  it('drops malformed envelope metadata (non-string kind/source, non-numeric age)', () => {
    const row = rowFromEntry('weird', {
      value: 5,
      kind: 123,
      source: 456,
      age_ms: '99',
    });
    expect(row.value).toBe(5);
    expect(row.kind).toBeUndefined();
    expect(row.source).toBeUndefined();
    expect(row.ageMs).toBeUndefined();
  });

  it('rejects non-finite ages (NaN / Infinity) so downstream math stays sound', () => {
    expect(rowFromEntry('a', { value: 1, age_ms: NaN }).ageMs).toBeUndefined();
    expect(rowFromEntry('b', { value: 1, age_ms: Infinity }).ageMs).toBeUndefined();
    expect(rowFromEntry('c', { value: 1, age_ms: 0 }).ageMs).toBe(0);
  });

  it('treats bare scalars as opaque values with no envelope metadata', () => {
    expect(rowFromEntry('n', 42)).toEqual({ name: 'n', value: 42 });
    expect(rowFromEntry('s', 'hello')).toEqual({ name: 's', value: 'hello' });
    expect(rowFromEntry('b', true)).toEqual({ name: 'b', value: true });
  });

  it('treats null / undefined / arrays as bare scalars, never envelopes', () => {
    expect(rowFromEntry('nul', null).value).toBeNull();
    expect(rowFromEntry('und', undefined).value).toBeUndefined();
    // Arrays are objects but have no `value` key → not an envelope.
    const arrRow = rowFromEntry('arr', [1, 2, 3]);
    expect(arrRow.value).toEqual([1, 2, 3]);
    expect(arrRow.kind).toBeUndefined();
  });

  it('treats a compound object without a `value` key as a bare scalar', () => {
    const raw = { latitude: 1, longitude: 2 };
    const row = rowFromEntry('loc', raw);
    expect(row.value).toEqual(raw);
    expect(row.source).toBeUndefined();
  });
});

describe('rowsFromResponse', () => {
  it('returns an empty array for undefined / nullish payloads', () => {
    expect(rowsFromResponse(undefined)).toEqual([]);
    expect(rowsFromResponse({ signals: undefined })).toEqual([]);
    expect(rowsFromResponse({ vehicle_id: 1, count: 0, signals: {} })).toEqual([]);
  });

  it('flattens mixed envelope + bare-scalar entries, preserving names', () => {
    const rows = rowsFromResponse({
      vehicle_id: 7,
      count: 2,
      signals: {
        Speed: { value: 10, kind: 'ValueKindFloat', source: 'l1', age_ms: 500 },
        Gear: 'D',
      },
    });
    expect(rows).toHaveLength(2);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.Speed.ageMs).toBe(500);
    expect(byName.Speed.source).toBe('l1');
    expect(byName.Gear.value).toBe('D');
    expect(byName.Gear.kind).toBeUndefined();
  });
});

describe('classifyKind', () => {
  it('maps each canonical ValueKind onto its high-level category', () => {
    expect(classifyKind('ValueKindFloat', 0)).toBe('numeric');
    expect(classifyKind('ValueKindInt64', 0)).toBe('numeric');
    expect(classifyKind('ValueKindBool', false)).toBe('boolean');
    expect(classifyKind('ValueKindBoolean', false)).toBe('boolean');
    expect(classifyKind('ValueKindString', '')).toBe('text');
    expect(classifyKind('ValueKindEnum', 'ShiftStateD')).toBe('enum');
    expect(classifyKind('ValueKindUnixTime', 0)).toBe('time');
  });

  it('recognises any Compound-suffixed kind regardless of value type', () => {
    expect(classifyKind('ValueKindCompoundLocation', { lat: 1 })).toBe('compound');
    expect(classifyKind('StringCompound', 'x')).toBe('compound');
  });

  it('falls back to the JS runtime type for unknown / missing kinds', () => {
    expect(classifyKind('ValueKindMystery', 3.14)).toBe('numeric');
    expect(classifyKind(undefined, true)).toBe('boolean');
    expect(classifyKind(undefined, 'hi')).toBe('text');
    expect(classifyKind(undefined, { a: 1 })).toBe('compound');
  });

  it('classifies null / undefined values as "other", never compound', () => {
    expect(classifyKind(undefined, null)).toBe('other');
    expect(classifyKind(undefined, undefined)).toBe('other');
  });

  it('treats an empty-string kind as absent and uses the value type', () => {
    expect(classifyKind('', 'hello')).toBe('text');
    expect(classifyKind('', 7)).toBe('numeric');
  });
});

describe('normalizeSource', () => {
  it('maps the layered live-state sources case-insensitively', () => {
    expect(normalizeSource('l1')).toBe('l1');
    expect(normalizeSource('L1')).toBe('l1');
    expect(normalizeSource('l2')).toBe('l2');
    expect(normalizeSource('STALE')).toBe('stale');
  });

  it('buckets everything else (log, unknown, empty, undefined) as "unknown"', () => {
    // `log` is a historical source, not a *live* one — it is not an L1/L2 read.
    expect(normalizeSource('log')).toBe('unknown');
    expect(normalizeSource('mystery')).toBe('unknown');
    expect(normalizeSource('')).toBe('unknown');
    expect(normalizeSource(undefined)).toBe('unknown');
  });
});

describe('computeStats', () => {
  it('returns a fully zeroed snapshot for an empty array', () => {
    expect(computeStats([])).toEqual({
      total: 0,
      live: 0,
      stale: 0,
      legacy: 0,
      numeric: 0,
      bySource: { l1: 0, l2: 0, stale: 0, unknown: 0 },
      byKind: [],
      freshestAgeMs: null,
    });
  });

  it('is null-safe: nullish rows degrade to the zeroed snapshot without throwing', () => {
    const zeroed = computeStats([]);
    expect(computeStats(undefined)).toEqual(zeroed);
    expect(computeStats(null)).toEqual(zeroed);
    expect(() => computeStats(null)).not.toThrow();
  });

  it('aggregates counts, sources, kinds and the freshest age in one pass', () => {
    const rows: LiveSignalRow[] = [
      { name: 'a', value: 1, kind: 'ValueKindFloat', source: 'l1', ageMs: 1500 },
      { name: 'b', value: 2, kind: 'ValueKindInt32', source: 'l2', ageMs: 300 },
      { name: 'c', value: 'x', kind: 'ValueKindString', source: 'stale', ageMs: 50 },
      { name: 'd', value: true, kind: 'ValueKindBool', source: 'l1' },
      { name: 'e', value: { lat: 1 }, kind: 'ValueKindCompoundLocation', source: 'log' },
    ];
    const stats = computeStats(rows);
    expect(stats.total).toBe(5);
    expect(stats.bySource).toEqual({ l1: 2, l2: 1, stale: 1, unknown: 1 });
    expect(stats.live).toBe(2);
    expect(stats.legacy).toBe(1);
    expect(stats.stale).toBe(1);
    expect(stats.numeric).toBe(2);
    // freshest = smallest finite age across the snapshot.
    expect(stats.freshestAgeMs).toBe(50);
    expect(stats.byKind).toEqual([
      { category: 'numeric', count: 2 },
      { category: 'boolean', count: 1 },
      { category: 'text', count: 1 },
      { category: 'compound', count: 1 },
    ]);
  });

  it('ignores non-finite ages when choosing the freshest signal', () => {
    const rows: LiveSignalRow[] = [
      { name: 'a', value: 1, ageMs: NaN },
      { name: 'b', value: 2, ageMs: 200 },
      { name: 'c', value: 3 },
    ];
    expect(computeStats(rows).freshestAgeMs).toBe(200);
  });

  it('emits byKind buckets in canonical KIND_ORDER and omits empty ones', () => {
    const rows: LiveSignalRow[] = [
      { name: 'x', value: 'label', kind: 'ValueKindEnum' },
      { name: 'y', value: 0, kind: 'ValueKindUnixTime' },
      { name: 'z', value: null },
      { name: 'w', value: 5, kind: 'ValueKindFloat' },
    ];
    const categories: KindCategory[] = computeStats(rows).byKind.map((b) => b.category);
    // KIND_ORDER = numeric, boolean, text, enum, time, compound, other.
    expect(categories).toEqual(['numeric', 'enum', 'time', 'other']);
  });
});

describe('formatAge', () => {
  it('returns an em dash for unknown / non-finite ages', () => {
    expect(formatAge(null)).toBe('—');
    expect(formatAge(undefined)).toBe('—');
    expect(formatAge(NaN)).toBe('—');
    expect(formatAge(Infinity)).toBe('—');
  });

  it('formats sub-second and second ranges', () => {
    expect(formatAge(0)).toBe('0ms');
    expect(formatAge(999)).toBe('999ms');
    expect(formatAge(1499)).toBe('1.5s');
    expect(formatAge(2000)).toBe('2.0s');
  });

  it('formats minute, hour and day ranges', () => {
    expect(formatAge(120_000)).toBe('2m');
    expect(formatAge(3_600_000)).toBe('1.0h');
    expect(formatAge(7_200_000)).toBe('2.0h');
    expect(formatAge(86_400_000)).toBe('1.0d');
    expect(formatAge(172_800_000)).toBe('2.0d');
  });
});

describe('kind label metadata', () => {
  it('lists all seven categories in stable display order', () => {
    expect(KIND_ORDER).toEqual([
      'numeric',
      'boolean',
      'text',
      'enum',
      'time',
      'compound',
      'other',
    ]);
    expect(KIND_ORDER).toContain('compound');
  });

  it('provides an i18n key + non-empty fallback for every ordered category', () => {
    for (const category of KIND_ORDER) {
      expect(KIND_LABELS[category].key).toContain('admin.liveSignals.kind.');
      expect(KIND_LABELS[category].fallback.length).toBeGreaterThan(0);
    }
  });
});

describe('SectionStatus', () => {
  it('enumerates the five self-sufficient section render states', () => {
    const all: SectionStatus[] = ['no-vehicle', 'loading', 'error', 'empty', 'ready'];
    expect(all).toHaveLength(5);
    expect(all).toContain('ready');
  });
});

describe('rowsFromResponse → computeStats (integration)', () => {
  it('derives page-level stats end-to-end from a realistic live payload', () => {
    const resp: VehicleLiveSignalsResponse = {
      vehicle_id: 7,
      count: 3,
      at: '2024-01-01T00:00:00Z',
      signals: {
        VehicleSpeed: {
          value: 60,
          kind: 'ValueKindFloat',
          source: 'l1',
          age_ms: 800,
          timestamp: '2024-01-01T00:00:00Z',
        },
        Gear: 'D',
        Locked: { value: true, kind: 'ValueKindBool', source: 'l2' },
      },
    };
    const stats = computeStats(rowsFromResponse(resp));
    expect(stats.total).toBe(3);
    expect(stats.numeric).toBe(1);
    expect(stats.bySource).toEqual({ l1: 1, l2: 1, stale: 0, unknown: 1 });
    expect(stats.freshestAgeMs).toBe(800);
    expect(stats.byKind).toEqual([
      { category: 'numeric', count: 1 },
      { category: 'boolean', count: 1 },
      { category: 'text', count: 1 },
    ]);
  });
});
