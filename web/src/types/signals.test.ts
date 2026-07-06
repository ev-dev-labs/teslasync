/**
 * signals.ts type-module tests.
 *
 * Covers the `narrowSignal` discriminator plus the exported type surface
 * (`SignalSource`, `SignalValueType`, and the `TypedSignalObservation`
 * discriminated union). The behavioural focus is:
 *   - the discriminant is driven by the CATALOG's value_type, never by which
 *     value_* column happens to be populated;
 *   - falsy-but-valid readings (`0`, `''`, `false`) survive rather than
 *     collapsing to null (the `== null` guard, not a truthiness check);
 *   - a missing discriminant column yields null;
 *   - a malformed / unrecognized catalog value_type yields null, NOT
 *     `undefined` — the catalog arrives from an unvalidated API, and a
 *     leaked `undefined` would be dereferenced by callers that only guard
 *     `=== null` (the regression this suite pins);
 *   - identity columns pass through untouched and the input is not mutated.
 */

import { describe, it, expect } from 'vitest';
import { narrowSignal } from './signals';
import type {
  SignalObservation,
  SignalCatalogEntry,
  SignalSource,
  SignalValueType,
  TypedSignalObservation,
  NumericSignalObservation,
  TextSignalObservation,
  BoolSignalObservation,
} from './signals';

function obs(partial: Partial<SignalObservation> = {}): SignalObservation {
  return {
    vehicle_id: 7,
    ts: '2026-02-03T04:05:06Z',
    signal_name: 'BatteryLevel',
    value_numeric: null,
    value_text: null,
    value_bool: null,
    source: 'fleet_telemetry',
    ...partial,
  };
}

function cat(partial: Partial<SignalCatalogEntry> = {}): SignalCatalogEntry {
  return {
    name: 'BatteryLevel',
    value_type: 'numeric',
    source_module: 'fleet_telemetry',
    unit: '%',
    description: null,
    first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-02-03T04:05:06Z',
    ...partial,
  };
}

describe('narrowSignal — numeric', () => {
  it('surfaces the numeric column as .value with value_type "numeric"', () => {
    const result = narrowSignal(obs({ value_numeric: 82.4 }), cat({ value_type: 'numeric' }));
    expect(result).not.toBeNull();
    expect(result?.value_type).toBe('numeric');
    expect(result?.value).toBe(82.4);
    expect(typeof result?.value).toBe('number');
  });

  it('preserves a genuine 0 reading (== null guard, not falsy)', () => {
    const result = narrowSignal(obs({ value_numeric: 0 }), cat({ value_type: 'numeric' }));
    expect(result).not.toBeNull();
    expect(result?.value).toBe(0);
  });

  it('preserves negative readings', () => {
    const result = narrowSignal(obs({ value_numeric: -3.5 }), cat({ value_type: 'numeric' }));
    expect(result?.value).toBe(-3.5);
  });

  it('returns null when the numeric column is null', () => {
    expect(narrowSignal(obs({ value_numeric: null }), cat({ value_type: 'numeric' }))).toBeNull();
  });

  it('is driven by the catalog discriminant, ignoring other populated columns', () => {
    // Catalog says numeric; text is also present but must be ignored.
    const result = narrowSignal(
      obs({ value_numeric: 5, value_text: 'stray', value_bool: true }),
      cat({ value_type: 'numeric' }),
    );
    expect(result?.value_type).toBe('numeric');
    expect(result?.value).toBe(5);
  });
});

describe('narrowSignal — text', () => {
  it('surfaces the text column as .value with value_type "text"', () => {
    const result = narrowSignal(obs({ value_text: 'Charging' }), cat({ value_type: 'text' }));
    expect(result?.value_type).toBe('text');
    expect(result?.value).toBe('Charging');
  });

  it('preserves an empty string (a valid text reading)', () => {
    const result = narrowSignal(obs({ value_text: '' }), cat({ value_type: 'text' }));
    expect(result).not.toBeNull();
    expect(result?.value).toBe('');
  });

  it('returns null when the text column is null', () => {
    expect(narrowSignal(obs({ value_text: null }), cat({ value_type: 'text' }))).toBeNull();
  });
});

describe('narrowSignal — bool', () => {
  it('surfaces a true reading as .value with value_type "bool"', () => {
    const result = narrowSignal(obs({ value_bool: true }), cat({ value_type: 'bool' }));
    expect(result?.value_type).toBe('bool');
    expect(result?.value).toBe(true);
  });

  it('preserves a false reading (== null guard, not falsy)', () => {
    const result = narrowSignal(obs({ value_bool: false }), cat({ value_type: 'bool' }));
    expect(result).not.toBeNull();
    expect(result?.value).toBe(false);
  });

  it('returns null when the bool column is null', () => {
    expect(narrowSignal(obs({ value_bool: null }), cat({ value_type: 'bool' }))).toBeNull();
  });
});

describe('narrowSignal — malformed / defensive paths', () => {
  it('returns null (never undefined) for an unrecognized catalog value_type', () => {
    // The catalog is sourced from an unvalidated API response, so a value_type
    // outside the union is reachable at runtime. It must map to null, matching
    // the declared `| null` return — not leak `undefined`.
    const weird = cat({ value_type: 'geojson' as unknown as SignalValueType });
    const result = narrowSignal(obs({ value_numeric: 1 }), weird);
    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  it('does not mutate the input observation', () => {
    const input = obs({ value_numeric: 42 });
    const snapshot = { ...input };
    narrowSignal(input, cat({ value_type: 'numeric' }));
    expect(input).toEqual(snapshot);
  });

  it('passes identity columns through onto the narrowed row', () => {
    const result = narrowSignal(
      obs({
        vehicle_id: 99,
        ts: '2026-03-01T12:00:00Z',
        signal_name: 'Odometer',
        source: 'backfill',
        value_numeric: 123456,
      }),
      cat({ value_type: 'numeric' }),
    );
    expect(result).toMatchObject({
      vehicle_id: 99,
      ts: '2026-03-01T12:00:00Z',
      signal_name: 'Odometer',
      source: 'backfill',
      value_type: 'numeric',
      value: 123456,
    });
  });
});

describe('exported type surface', () => {
  it('narrows the TypedSignalObservation union by its value_type discriminant', () => {
    const rows: Array<TypedSignalObservation | null> = [
      narrowSignal(obs({ value_numeric: 3 }), cat({ value_type: 'numeric' })),
      narrowSignal(obs({ value_text: 'On' }), cat({ value_type: 'text' })),
      narrowSignal(obs({ value_bool: true }), cat({ value_type: 'bool' })),
    ];

    const seen: SignalValueType[] = [];
    for (const row of rows) {
      if (row == null) continue;
      switch (row.value_type) {
        case 'numeric': {
          const n: NumericSignalObservation = row;
          expect(typeof n.value).toBe('number');
          break;
        }
        case 'text': {
          const s: TextSignalObservation = row;
          expect(typeof s.value).toBe('string');
          break;
        }
        case 'bool': {
          const b: BoolSignalObservation = row;
          expect(typeof b.value).toBe('boolean');
          break;
        }
      }
      seen.push(row.value_type);
    }
    expect(seen).toEqual(['numeric', 'text', 'bool']);
  });

  it('accepts every declared SignalSource variant', () => {
    const sources: SignalSource[] = ['fleet_telemetry', 'fleet_api', 'manual', 'backfill'];
    const rows = sources.map((source) =>
      narrowSignal(obs({ source, value_numeric: 1 }), cat({ value_type: 'numeric' })),
    );
    expect(rows.every((r) => r?.value === 1)).toBe(true);
    expect(rows.map((r) => r?.source)).toEqual(sources);
  });
});
