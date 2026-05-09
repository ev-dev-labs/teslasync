import { describe, it, expect } from 'vitest';
import { asNonEmptyString, asString, asFiniteNumber, asBoolean } from './typeGuards';

describe('typeGuards.asNonEmptyString', () => {
  it('returns the string for non-empty strings', () => {
    expect(asNonEmptyString('hello')).toBe('hello');
    expect(asNonEmptyString('0')).toBe('0');
    expect(asNonEmptyString('false')).toBe('false');
  });
  it('returns null for empty string', () => {
    expect(asNonEmptyString('')).toBeNull();
  });
  it.each([null, undefined, 0, 1, true, false, NaN, {}, [], () => {}])('returns null for %p', (v) => {
    expect(asNonEmptyString(v)).toBeNull();
  });
  it('does NOT coerce booleans to "true"/"false" (would corrupt enum parsers)', () => {
    expect(asNonEmptyString(false)).toBeNull();
    expect(asNonEmptyString(true)).toBeNull();
  });
});

describe('typeGuards.asString', () => {
  it('returns the string for any string (including empty)', () => {
    expect(asString('hello')).toBe('hello');
    expect(asString('')).toBe('');
  });
  it.each([null, undefined, 0, true, {}, []])('returns null for %p', (v) => {
    expect(asString(v)).toBeNull();
  });
});

describe('typeGuards.asFiniteNumber', () => {
  it('returns finite numbers unchanged', () => {
    expect(asFiniteNumber(0)).toBe(0);
    expect(asFiniteNumber(-3.14)).toBe(-3.14);
    expect(asFiniteNumber(42)).toBe(42);
  });
  it('returns null for non-finite or non-number', () => {
    expect(asFiniteNumber(NaN)).toBeNull();
    expect(asFiniteNumber(Infinity)).toBeNull();
    expect(asFiniteNumber('42')).toBeNull();
    expect(asFiniteNumber(null)).toBeNull();
    expect(asFiniteNumber(undefined)).toBeNull();
  });
});

describe('typeGuards.asBoolean', () => {
  it('returns booleans unchanged', () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean(false)).toBe(false);
  });
  it('returns null for non-booleans', () => {
    expect(asBoolean('true')).toBeNull();
    expect(asBoolean(1)).toBeNull();
    expect(asBoolean(0)).toBeNull();
    expect(asBoolean(null)).toBeNull();
    expect(asBoolean(undefined)).toBeNull();
    expect(asBoolean({})).toBeNull();
  });
});
