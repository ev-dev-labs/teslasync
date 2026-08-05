import { describe, it, expect } from 'vitest';
import { canonicalize, toCanonicalJson, toCanonicalBytes, CanonicalizationError } from './canonicalJson';

describe('canonicalize / toCanonicalJson', () => {
  it('sorts object keys regardless of insertion order', () => {
    const a = { b: 1, a: 2, c: 3 };
    const b = { c: 3, a: 2, b: 1 };
    expect(toCanonicalJson(a)).toBe(toCanonicalJson(b));
    expect(toCanonicalJson(a)).toBe('{"a":2,"b":1,"c":3}');
  });

  it('sorts nested object keys at every level', () => {
    const value = { outer: { z: 1, y: { d: 1, c: 2 }, x: 3 } };
    expect(toCanonicalJson(value)).toBe('{"outer":{"x":3,"y":{"c":2,"d":1},"z":1}}');
  });

  it('preserves array order (arrays are positional, not sorted)', () => {
    const value = { list: [3, 1, 2] };
    expect(toCanonicalJson(value)).toBe('{"list":[3,1,2]}');
  });

  it('canonicalizes arrays of objects, sorting each object independently', () => {
    const value = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
    expect(toCanonicalJson(value)).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
  });

  it('emits no whitespace', () => {
    const value = { a: 1, b: [1, 2, 3] };
    expect(toCanonicalJson(value)).not.toMatch(/\s/);
  });

  it('is deterministic across repeated calls', () => {
    const value = { z: 1, a: { y: 2, b: 3 }, m: [1, { q: 1, p: 2 }] };
    const first = toCanonicalJson(value);
    const second = toCanonicalJson(JSON.parse(JSON.stringify(value)));
    expect(first).toBe(second);
  });

  it('produces different output when any nested value changes (tamper sensitivity)', () => {
    const original = { a: 1, nested: { b: 2, c: [1, 2, 3] } };
    const tamperedLeaf = { a: 1, nested: { b: 2, c: [1, 2, 4] } };
    const tamperedTop = { a: 2, nested: { b: 2, c: [1, 2, 3] } };
    const originalJson = toCanonicalJson(original);
    expect(toCanonicalJson(tamperedLeaf)).not.toBe(originalJson);
    expect(toCanonicalJson(tamperedTop)).not.toBe(originalJson);
  });

  it('drops explicit undefined object properties, matching JSON.stringify', () => {
    const value = { a: 1, b: undefined };
    expect(toCanonicalJson(value)).toBe('{"a":1}');
  });

  it('throws CanonicalizationError for undefined inside an array', () => {
    expect(() => canonicalize([1, undefined, 3])).toThrow(CanonicalizationError);
  });

  it('throws CanonicalizationError for NaN', () => {
    expect(() => canonicalize({ a: NaN })).toThrow(CanonicalizationError);
  });

  it('throws CanonicalizationError for Infinity and -Infinity', () => {
    expect(() => canonicalize({ a: Infinity })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: -Infinity })).toThrow(CanonicalizationError);
  });

  it('throws CanonicalizationError for functions', () => {
    expect(() => canonicalize({ a: () => 1 })).toThrow(CanonicalizationError);
  });

  it('throws CanonicalizationError for class instances (non-plain objects)', () => {
    class Foo { x = 1; }
    expect(() => canonicalize({ a: new Foo() })).toThrow(CanonicalizationError);
  });

  it('throws CanonicalizationError for bigint', () => {
    expect(() => canonicalize({ a: 1n })).toThrow(CanonicalizationError);
  });

  it('handles null, booleans, and primitives at the top level', () => {
    expect(toCanonicalJson(null)).toBe('null');
    expect(toCanonicalJson(true)).toBe('true');
    expect(toCanonicalJson(42)).toBe('42');
    expect(toCanonicalJson('hi')).toBe('"hi"');
  });

  it('toCanonicalBytes encodes the canonical string as UTF-8', () => {
    const bytes = toCanonicalBytes({ a: 1 });
    // Avoid `instanceof Uint8Array` here: jsdom's global realm can differ
    // from the Uint8Array constructor TextEncoder returns, which makes
    // cross-realm `instanceof` checks unreliable in this test environment.
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
  });

  it('handles unicode strings without altering key sort stability', () => {
    const value = { café: 1, apple: 2 };
    // 'apple' < 'café' by UTF-16 code unit order ('a' < 'c')
    expect(toCanonicalJson(value)).toBe('{"apple":2,"café":1}');
  });
});
