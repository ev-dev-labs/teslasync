// Chart-annotation type/projection tests.
//
// Covers every runtime export of `annotations.ts`:
//   - toDataAnnotation          — the wire→chart-render projection, including
//     field renames, id stringification, the null/undefined/zero coercions,
//     first-bucket context derivation, input immutability, and the null-scope
//     crash guard (a nil Go slice marshals to JSON `null`, which previously
//     threw on `row.scope[0]`).
//   - ANNOTATION_SCOPES         — the eight chart buckets, deduped + in sync
//     with the AnnotationScope union.
//   - ANNOTATION_COLORS         — a valid hex per category, exact key set.
//   - ANNOTATION_CATEGORY_LABELS — a non-empty label per category, key set in
//     lockstep with the color map.
//
// The type-level exports (DataAnnotation / AnnotationCategory / AnnotationScope
// / ChartAnnotationRow) are exercised through the typed fixtures + the
// cross-map lookup contracts so `tsc --noEmit` covers them too.

import { describe, it, expect } from 'vitest';
import {
  toDataAnnotation,
  ANNOTATION_SCOPES,
  ANNOTATION_COLORS,
  ANNOTATION_CATEGORY_LABELS,
} from './annotations';
import type {
  AnnotationCategory,
  AnnotationScope,
  ChartAnnotationRow,
  DataAnnotation,
} from './annotations';

const ALL_CATEGORIES: readonly AnnotationCategory[] = [
  'milestone',
  'maintenance',
  'trip',
  'issue',
  'upgrade',
  'custom',
];

/** A fully-populated backend row; override any field per-case. */
function makeRow(overrides: Partial<ChartAnnotationRow> = {}): ChartAnnotationRow {
  return {
    id: 42,
    user_id: 3,
    vehicle_id: 7,
    occurred_at: '2025-03-01T12:00:00Z',
    category: 'maintenance',
    title: 'Tire rotation',
    description: 'Rotated all four',
    scope: ['tire', 'efficiency'],
    color: '#f59e0b',
    created_at: '2025-03-01T12:05:00Z',
    updated_at: '2025-03-01T12:10:00Z',
    ...overrides,
  };
}

describe('toDataAnnotation', () => {
  it('projects a fully populated row onto the exact DataAnnotation shape', () => {
    const expected: DataAnnotation = {
      id: '42',
      timestamp: '2025-03-01T12:00:00Z',
      label: 'Tire rotation',
      description: 'Rotated all four',
      category: 'maintenance',
      context: 'tire',
      vehicleId: 7,
      createdAt: '2025-03-01T12:05:00Z',
    };
    expect(toDataAnnotation(makeRow())).toEqual(expected);
  });

  it('renames occurred_at→timestamp, title→label and created_at→createdAt', () => {
    const result = toDataAnnotation(
      makeRow({ occurred_at: 'when', title: 'what', created_at: 'made' }),
    );
    expect(result.timestamp).toBe('when');
    expect(result.label).toBe('what');
    expect(result.createdAt).toBe('made');
  });

  it('stringifies the numeric id, preserving an explicit zero', () => {
    expect(toDataAnnotation(makeRow({ id: 0 })).id).toBe('0');
    expect(toDataAnnotation(makeRow({ id: 123456789 })).id).toBe('123456789');
  });

  it('derives context from the first scope bucket only', () => {
    expect(toDataAnnotation(makeRow({ scope: ['cost', 'tire', 'energy'] })).context).toBe('cost');
  });

  it('maps an empty scope array to a blank context', () => {
    expect(toDataAnnotation(makeRow({ scope: [] })).context).toBe('');
  });

  it('coerces a null scope to a blank context instead of throwing (nil Go slice → JSON null)', () => {
    const row = makeRow({ scope: null as unknown as string[] });
    expect(() => toDataAnnotation(row)).not.toThrow();
    expect(toDataAnnotation(row).context).toBe('');
  });

  it('coerces an absent scope to a blank context', () => {
    const row = makeRow({ scope: undefined as unknown as string[] });
    expect(toDataAnnotation(row).context).toBe('');
  });

  it('coerces a null or absent description to undefined but passes a real one through', () => {
    expect(toDataAnnotation(makeRow({ description: null })).description).toBeUndefined();
    expect(toDataAnnotation(makeRow({ description: undefined })).description).toBeUndefined();
    expect(toDataAnnotation(makeRow({ description: 'note' })).description).toBe('note');
  });

  it('coerces a null or absent vehicle_id to undefined but keeps an explicit zero', () => {
    expect(toDataAnnotation(makeRow({ vehicle_id: null })).vehicleId).toBeUndefined();
    expect(toDataAnnotation(makeRow({ vehicle_id: undefined })).vehicleId).toBeUndefined();
    expect(toDataAnnotation(makeRow({ vehicle_id: 0 })).vehicleId).toBe(0);
    expect(toDataAnnotation(makeRow({ vehicle_id: 9 })).vehicleId).toBe(9);
  });

  it('preserves every category verbatim', () => {
    for (const category of ALL_CATEGORIES) {
      expect(toDataAnnotation(makeRow({ category })).category).toBe(category);
    }
  });

  it('does not mutate the input row', () => {
    const row = makeRow();
    toDataAnnotation(row);
    expect(row).toEqual(makeRow());
  });
});

describe('ANNOTATION_SCOPES', () => {
  it('enumerates the eight chart buckets with no duplicates', () => {
    expect(ANNOTATION_SCOPES).toHaveLength(8);
    expect(new Set(ANNOTATION_SCOPES).size).toBe(8);
  });

  it('matches the AnnotationScope union exactly', () => {
    const expected: AnnotationScope[] = [
      'battery',
      'efficiency',
      'cost',
      'tire',
      'energy',
      'drivetrain',
      'mileage',
      'charging',
    ];
    expect([...ANNOTATION_SCOPES].sort()).toEqual([...expected].sort());
  });
});

describe('ANNOTATION_COLORS', () => {
  it('maps every category to a 6-digit hex color', () => {
    for (const category of ALL_CATEGORIES) {
      expect(ANNOTATION_COLORS[category]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('covers exactly the six categories — no missing or stray keys', () => {
    expect(Object.keys(ANNOTATION_COLORS).sort()).toEqual([...ALL_CATEGORIES].sort());
  });
});

describe('ANNOTATION_CATEGORY_LABELS', () => {
  it('provides a non-empty label for every category', () => {
    for (const category of ALL_CATEGORIES) {
      expect(ANNOTATION_CATEGORY_LABELS[category].length).toBeGreaterThan(0);
    }
  });

  it('shares the exact key set with ANNOTATION_COLORS', () => {
    expect(Object.keys(ANNOTATION_CATEGORY_LABELS).sort()).toEqual(
      Object.keys(ANNOTATION_COLORS).sort(),
    );
  });
});

describe('type contracts', () => {
  it('lets a projected annotation feed the color + label lookup maps', () => {
    const projected = toDataAnnotation(makeRow({ category: 'upgrade' }));
    expect(ANNOTATION_COLORS[projected.category]).toBe('#a855f7');
    expect(ANNOTATION_CATEGORY_LABELS[projected.category]).toBe('Upgrade');
  });

  it('accepts every scope bucket as a valid ChartAnnotationRow.scope entry', () => {
    for (const scope of ANNOTATION_SCOPES) {
      const row: ChartAnnotationRow = makeRow({ scope: [scope] });
      expect(toDataAnnotation(row).context).toBe(scope);
    }
  });
});
