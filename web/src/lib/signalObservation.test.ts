/**
 * signalObservation extractor tests.
 *
 * Covers latestNumeric / latestBool / latestText across:
 *   - the head-row contract (index 0 = newest; later rows ignored),
 *   - falsy-value preservation of the nullish-coalescing extractors
 *     (`0`, `false`, and `''` must survive, not collapse to null / '—'),
 *   - the missing branches (undefined data, empty array, null value), and
 *   - latestNumeric's non-finite guard (NaN / ±Infinity coerced to null so
 *     they never leak into a downstream `!= null` check or chart aggregation).
 */

import { describe, it, expect } from 'vitest';
import type { SignalObservation } from '@/types/signals';
import { latestNumeric, latestBool, latestText } from './signalObservation';

function obs(partial: Partial<SignalObservation>): SignalObservation {
  return {
    vehicle_id: 1,
    ts: '2026-01-01T00:00:00Z',
    signal_name: 'Test',
    value_numeric: null,
    value_text: null,
    value_bool: null,
    source: 'fleet_telemetry',
    ...partial,
  };
}

describe('latestNumeric', () => {
  it('returns the numeric value from the head (newest) row', () => {
    const data = [obs({ value_numeric: 11.176 }), obs({ value_numeric: 3.3 })];
    expect(latestNumeric(data)).toBe(11.176);
  });

  it('reads index 0 only, ignoring later rows', () => {
    const data = [obs({ value_numeric: 42 }), obs({ value_numeric: 99 })];
    expect(latestNumeric(data)).toBe(42);
  });

  it('preserves a genuine 0 reading (nullish-coalescing, not falsy)', () => {
    expect(latestNumeric([obs({ value_numeric: 0 })])).toBe(0);
  });

  it('preserves negative values', () => {
    expect(latestNumeric([obs({ value_numeric: -12.5 })])).toBe(-12.5);
  });

  it('returns null for undefined data', () => {
    expect(latestNumeric(undefined)).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(latestNumeric([])).toBeNull();
  });

  it('returns null when the head row value_numeric is null', () => {
    expect(latestNumeric([obs({ value_numeric: null })])).toBeNull();
  });

  it('coerces NaN to null so it never leaks past a != null guard', () => {
    expect(latestNumeric([obs({ value_numeric: NaN })])).toBeNull();
  });

  it('coerces +Infinity and -Infinity to null', () => {
    expect(latestNumeric([obs({ value_numeric: Infinity })])).toBeNull();
    expect(latestNumeric([obs({ value_numeric: -Infinity })])).toBeNull();
  });
});

describe('latestBool', () => {
  it('returns true from the head row', () => {
    expect(latestBool([obs({ value_bool: true })])).toBe(true);
  });

  it('preserves false (nullish-coalescing, not falsy)', () => {
    expect(latestBool([obs({ value_bool: false })])).toBe(false);
  });

  it('reads index 0 only, ignoring later rows', () => {
    const data = [obs({ value_bool: false }), obs({ value_bool: true })];
    expect(latestBool(data)).toBe(false);
  });

  it('returns null for undefined data, empty array, and null value', () => {
    expect(latestBool(undefined)).toBeNull();
    expect(latestBool([])).toBeNull();
    expect(latestBool([obs({ value_bool: null })])).toBeNull();
  });
});

describe('latestText', () => {
  it('returns the text value from the head row', () => {
    expect(latestText([obs({ value_text: 'FollowDistance7' })])).toBe('FollowDistance7');
  });

  it('reads index 0 only, ignoring later rows', () => {
    const data = [obs({ value_text: 'On' }), obs({ value_text: 'Off' })];
    expect(latestText(data)).toBe('On');
  });

  it('preserves an empty string (a valid text reading)', () => {
    expect(latestText([obs({ value_text: '' })])).toBe('');
  });

  it('returns null for undefined data, empty array, and null value', () => {
    expect(latestText(undefined)).toBeNull();
    expect(latestText([])).toBeNull();
    expect(latestText([obs({ value_text: null })])).toBeNull();
  });
});
