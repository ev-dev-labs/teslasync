import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeArray, safeObject } from './safeArray';

// ---------------------------------------------------------------------------
// safeArray / safeObject hardening
//
// These are the runtime guards that stand between a Go backend — whose `nil`
// slices marshal to JSON `null`, and whose `interface{}` envelopes can serialise
// as an object instead of an array — and every list-bearing hook's
// `select: safeArray`. The invariant callers depend on:
//
//   1. safeArray ALWAYS returns a real array (never null/undefined), so
//      `.map/.filter/.length` can never throw.
//   2. A genuine array is passed through *by reference* (no defensive copy) so
//      TanStack Query's structural-sharing / referential-equality checks hold.
//   3. Only unexpected NON-nullish, non-array values warn — a plain `null`
//      (the common Go-nil case) is silent, so logs aren't flooded.
//   4. safeObject rejects arrays (an array is not a plain object) and returns
//      the caller's fallback for every nullish / non-object input.
// ---------------------------------------------------------------------------

describe('safeArray', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes a populated array through by reference (no copy)', () => {
    const input = [1, 2, 3];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = safeArray(input);

    expect(result).toBe(input);
    expect(result).toEqual([1, 2, 3]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('passes an empty array through by reference', () => {
    const input: string[] = [];

    const result = safeArray(input);

    expect(result).toBe(input);
    expect(result).toHaveLength(0);
  });

  it('preserves falsy-but-valid elements without coercion', () => {
    const input = [0, '', false, null, undefined, NaN];

    const result = safeArray(input);

    expect(result).toEqual([0, '', false, null, undefined, NaN]);
    expect(result).toHaveLength(6);
  });

  it('coerces null to [] silently (the common Go nil-slice case)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = safeArray(null);

    expect(result).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('coerces undefined to [] silently', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = safeArray(undefined);

    expect(result).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['number', 42],
    ['string', 'not-an-array'],
    ['boolean', true],
    ['object', { length: 0 }],
  ])('coerces an unexpected %s payload to [] and warns', (kind, value) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = safeArray(value as unknown as unknown[]);

    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[safeArray] Expected array, got:', kind);
  });

  it('honours the explicit generic type parameter', () => {
    const result = safeArray<number>(undefined);

    // Contract: a caller-typed empty array, safe to iterate.
    expect(result).toEqual([]);
    const doubled = result.map((n) => n * 2);
    expect(doubled).toEqual([]);
  });
});

describe('safeObject', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fallback = { ok: false } as const;

  it('passes a plain object through by reference', () => {
    const input = { a: 1, b: 'two' };

    const result = safeObject(input, { a: 0, b: '' });

    expect(result).toBe(input);
    expect(result).toEqual({ a: 1, b: 'two' });
  });

  it('treats an empty object as a valid object (not the fallback)', () => {
    const input: Record<string, unknown> = {};
    const fb: Record<string, unknown> = { placeholder: true };

    const result = safeObject(input, fb);

    expect(result).toBe(input);
    expect(result).not.toBe(fb);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('returns the fallback for %s', (_kind, value) => {
    const result = safeObject(value as unknown as Record<string, unknown>, fallback);

    expect(result).toBe(fallback);
    expect(result).toEqual({ ok: false });
  });

  it('returns the fallback for an array (an array is not a plain object)', () => {
    const result = safeObject([1, 2, 3] as unknown as Record<string, unknown>, fallback);

    expect(result).toBe(fallback);
    expect(Array.isArray(result)).toBe(false);
  });

  it('does not mutate or merge — it returns exactly one of the two inputs', () => {
    const input = { keep: 'me' };
    const fb = { keep: 'default' };

    expect(safeObject(input, fb)).toBe(input);
    expect(safeObject(null, fb)).toBe(fb);
    // Neither input was mutated in the process.
    expect(input).toEqual({ keep: 'me' });
    expect(fb).toEqual({ keep: 'default' });
  });
});
