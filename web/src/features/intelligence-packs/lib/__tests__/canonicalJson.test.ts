import { describe, it, expect } from 'vitest';
import { canonicalize, canonicalStringify, canonicalBytes, CanonicalizationError } from '../canonicalJson';

describe('canonicalize', () => {
  it('sorts object keys ascending by UTF-16 code unit order', () => {
    const value = { b: 1, a: 2, c: 3 };
    expect(canonicalize(value)).toEqual({ a: 2, b: 1, c: 3 });
    expect(Object.keys(canonicalize(value) as object)).toEqual(['a', 'b', 'c']);
  });

  it('preserves array element order', () => {
    const value = { list: [3, 1, 2] };
    expect((canonicalize(value) as { list: number[] }).list).toEqual([3, 1, 2]);
  });

  it('recursively sorts nested object keys inside arrays', () => {
    const value = [{ z: 1, a: 2 }];
    const result = canonicalize(value) as Array<Record<string, number>>;
    expect(Object.keys(result[0])).toEqual(['a', 'z']);
  });

  it('normalizes -0 to 0', () => {
    expect(canonicalize(-0)).toBe(0);
    expect(Object.is(canonicalize(-0), -0)).toBe(false);
  });

  it('passes through strings, booleans, and null unchanged', () => {
    expect(canonicalize('hello')).toBe('hello');
    expect(canonicalize(true)).toBe(true);
    expect(canonicalize(false)).toBe(false);
    expect(canonicalize(null)).toBe(null);
  });

  it('throws CanonicalizationError for non-finite numbers', () => {
    expect(() => canonicalize(NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Infinity)).toThrow(CanonicalizationError);
    expect(() => canonicalize(-Infinity)).toThrow(CanonicalizationError);
  });

  it('throws CanonicalizationError for undefined/function/symbol/bigint', () => {
    expect(() => canonicalize(undefined)).toThrow(CanonicalizationError);
    expect(() => canonicalize(() => 1)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Symbol('x'))).toThrow(CanonicalizationError);
    expect(() => canonicalize(BigInt(1))).toThrow(CanonicalizationError);
  });
});

describe('canonicalStringify', () => {
  it('produces identical output regardless of source key order', () => {
    const a = { name: 'x', id: 1, nested: { z: 1, a: 2 } };
    const b = { id: 1, nested: { a: 2, z: 1 }, name: 'x' };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('is whitespace-free', () => {
    expect(canonicalStringify({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it('is sensitive to actual content changes (tamper-evident)', () => {
    const original = { a: 1, b: 2 };
    const tampered = { a: 1, b: 3 };
    expect(canonicalStringify(original)).not.toBe(canonicalStringify(tampered));
  });
});

describe('canonicalBytes', () => {
  it('UTF-8 encodes the canonical string', () => {
    const bytes = canonicalBytes({ a: 1 });
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
  });

  it('produces identical bytes for reordered-but-equal input', () => {
    const bytes1 = canonicalBytes({ a: 1, b: 2 });
    const bytes2 = canonicalBytes({ b: 2, a: 1 });
    expect(Array.from(bytes1)).toEqual(Array.from(bytes2));
  });
});
