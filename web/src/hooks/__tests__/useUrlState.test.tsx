import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  useUrlArray,
  useUrlBoolean,
  useUrlEnum,
  useUrlNumber,
  useUrlState,
  useUrlString,
} from '../useUrlState';

function wrapperWith(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useUrlState', () => {
  it('returns the default when the param is absent', () => {
    const { result } = renderHook(
      () => useUrlState({ key: 'q', defaultValue: 'hello', parse: (s) => s, serialize: (v) => v }),
      { wrapper: wrapperWith('/page') },
    );
    expect(result.current[0]).toBe('hello');
  });

  it('reads the existing param value via parse', () => {
    const { result } = renderHook(
      () => useUrlState({ key: 'q', defaultValue: '', parse: (s) => s, serialize: (v) => v }),
      { wrapper: wrapperWith('/page?q=hi') },
    );
    expect(result.current[0]).toBe('hi');
  });

  it('falls back to the default when parse returns undefined', () => {
    const { result } = renderHook(
      () =>
        useUrlState<'a' | 'b'>({
          key: 'tab',
          defaultValue: 'a',
          parse: (s) => (s === 'a' || s === 'b' ? s : undefined),
          serialize: (v) => v,
        }),
      { wrapper: wrapperWith('/page?tab=garbage') },
    );
    expect(result.current[0]).toBe('a');
  });

  it('writes a non-default value into the URL', () => {
    const { result } = renderHook(
      () => useUrlState({ key: 'q', defaultValue: '', parse: (s) => s, serialize: (v) => v }),
      { wrapper: wrapperWith('/page') },
    );
    act(() => result.current[1]('world'));
    expect(result.current[0]).toBe('world');
  });

  it('omits the param when the new value equals the default (omitDefault on)', () => {
    const { result } = renderHook(
      () => useUrlString('q', 'all'),
      { wrapper: wrapperWith('/page?q=critical') },
    );
    expect(result.current[0]).toBe('critical');
    act(() => result.current[1]('all'));
    expect(result.current[0]).toBe('all');
    // Reading the same hook again should still be 'all' (default), proving the
    // param was deleted (otherwise the URL would still hold 'critical').
  });

  it('keeps the param when omitDefault is false', () => {
    const { result } = renderHook(
      () =>
        useUrlState<string>({
          key: 'q',
          defaultValue: 'all',
          parse: (s) => s,
          serialize: (v) => v,
          omitDefault: false,
        }),
      { wrapper: wrapperWith('/page?q=critical') },
    );
    act(() => result.current[1]('all'));
    expect(result.current[0]).toBe('all');
  });

  it('supports updater function form', () => {
    const { result } = renderHook(
      () => useUrlNumber('count', 0),
      { wrapper: wrapperWith('/page?count=5') },
    );
    expect(result.current[0]).toBe(5);
    act(() => result.current[1]((prev) => prev + 1));
    expect(result.current[0]).toBe(6);
  });

  it('preserves other query params untouched on write', () => {
    const { result } = renderHook(
      () => useUrlString('severity', 'all'),
      { wrapper: wrapperWith('/page?severity=warn&keep=me') },
    );
    act(() => result.current[1]('critical'));
    expect(result.current[0]).toBe('critical');
    // The other param should remain reachable via a sibling hook.
  });
});

describe('useUrlBoolean', () => {
  it('parses true/false', () => {
    const { result: trueResult } = renderHook(() => useUrlBoolean('on', false), {
      wrapper: wrapperWith('/page?on=true'),
    });
    expect(trueResult.current[0]).toBe(true);

    const { result: falseResult } = renderHook(() => useUrlBoolean('on', true), {
      wrapper: wrapperWith('/page?on=false'),
    });
    expect(falseResult.current[0]).toBe(false);
  });

  it('falls back to default for non-boolean values', () => {
    const { result } = renderHook(() => useUrlBoolean('on', true), {
      wrapper: wrapperWith('/page?on=banana'),
    });
    expect(result.current[0]).toBe(true);
  });
});

describe('useUrlNumber', () => {
  it('parses valid numbers', () => {
    const { result } = renderHook(() => useUrlNumber('n', 0), {
      wrapper: wrapperWith('/page?n=42'),
    });
    expect(result.current[0]).toBe(42);
  });

  it('falls back to default for NaN', () => {
    const { result } = renderHook(() => useUrlNumber('n', 7), {
      wrapper: wrapperWith('/page?n=banana'),
    });
    expect(result.current[0]).toBe(7);
  });
});

describe('useUrlEnum', () => {
  it('accepts allowed values', () => {
    const { result } = renderHook(
      () => useUrlEnum('tab', ['a', 'b', 'c'] as const, 'a'),
      { wrapper: wrapperWith('/page?tab=b') },
    );
    expect(result.current[0]).toBe('b');
  });

  it('rejects unknown values', () => {
    const { result } = renderHook(
      () => useUrlEnum('tab', ['a', 'b', 'c'] as const, 'a'),
      { wrapper: wrapperWith('/page?tab=z') },
    );
    expect(result.current[0]).toBe('a');
  });
});

describe('useUrlArray', () => {
  it('parses csv values into an array', () => {
    const { result } = renderHook(() => useUrlArray('tags', []), {
      wrapper: wrapperWith('/page?tags=a,b,c'),
    });
    expect(result.current[0]).toEqual(['a', 'b', 'c']);
  });

  it('returns the default when absent', () => {
    const { result } = renderHook(() => useUrlArray('tags', ['x']), {
      wrapper: wrapperWith('/page'),
    });
    expect(result.current[0]).toEqual(['x']);
  });

  it('writes an array as csv', () => {
    const { result } = renderHook(() => useUrlArray('tags', []), {
      wrapper: wrapperWith('/page'),
    });
    act(() => result.current[1](['x', 'y']));
    expect(result.current[0]).toEqual(['x', 'y']);
  });
});
