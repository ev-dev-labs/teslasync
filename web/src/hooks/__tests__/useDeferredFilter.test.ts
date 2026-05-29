/**
 * useDeferredFilter unit tests.
 *
 * Validates the hook contract: setValue updates `value` synchronously,
 * `deferred` catches up after React commits, the setter is reference-
 * stable, and the functional-update form works.
 *
 * Note on `isPending`: in jsdom under React 18 with no other concurrent
 * work scheduled, `useDeferredValue` typically commits in the same
 * `act()` flush, so the post-flush state sees `value === deferred` and
 * `isPending === false`. The boolean is exercised through the value/
 * deferred relationship rather than a brittle "did pending flicker"
 * assertion.
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useDeferredFilter } from '../useDeferredFilter';

describe('useDeferredFilter', () => {
  it('initialises both value and deferred to the supplied initial value', () => {
    const { result } = renderHook(() => useDeferredFilter('hello'));
    expect(result.current.value).toBe('hello');
    expect(result.current.deferred).toBe('hello');
    expect(result.current.isPending).toBe(false);
  });

  it('supports non-string generic values', () => {
    const { result } = renderHook(() => useDeferredFilter(42));
    expect(result.current.value).toBe(42);
    expect(result.current.deferred).toBe(42);
  });

  it('supports object generic values via Object.is identity', () => {
    const initial = { q: '', tag: null as string | null };
    const { result } = renderHook(() => useDeferredFilter(initial));
    expect(result.current.value).toBe(initial);
    expect(result.current.deferred).toBe(initial);
    expect(result.current.isPending).toBe(false);
  });

  it('updates value synchronously and lets deferred catch up after the flush', () => {
    const { result } = renderHook(() => useDeferredFilter(''));

    act(() => {
      result.current.setValue('typed');
    });

    expect(result.current.value).toBe('typed');
    // After the act() flush, useDeferredValue has commited the deferred
    // re-render — both should converge on the new value.
    expect(result.current.deferred).toBe('typed');
    expect(result.current.isPending).toBe(false);
  });

  it('supports the functional updater form (prev => next)', () => {
    const { result } = renderHook(() => useDeferredFilter(0));

    act(() => {
      result.current.setValue((prev) => prev + 1);
    });
    expect(result.current.value).toBe(1);

    act(() => {
      result.current.setValue((prev) => prev + 10);
    });
    expect(result.current.value).toBe(11);
    expect(result.current.deferred).toBe(11);
  });

  it('returns a reference-stable setValue across re-renders', () => {
    const { result, rerender } = renderHook(() => useDeferredFilter(''));
    const initialSetter = result.current.setValue;

    act(() => {
      result.current.setValue('a');
    });
    rerender();
    act(() => {
      result.current.setValue('b');
    });
    rerender();

    expect(result.current.setValue).toBe(initialSetter);
  });

  it('does not call setValue spuriously on re-render', () => {
    const renders = vi.fn();
    const { rerender } = renderHook(() => {
      renders();
      return useDeferredFilter('init');
    });
    const initialCount = renders.mock.calls.length;
    rerender();
    rerender();
    // Renders happen because we call rerender() — but the hook itself
    // must not schedule extra renders beyond what the parent triggers.
    expect(renders.mock.calls.length).toBe(initialCount + 2);
  });

  it('coalesces multiple synchronous setValue calls into the latest value', () => {
    const { result } = renderHook(() => useDeferredFilter(''));

    act(() => {
      result.current.setValue('a');
      result.current.setValue('ab');
      result.current.setValue('abc');
    });

    expect(result.current.value).toBe('abc');
    expect(result.current.deferred).toBe('abc');
  });

  it('returns isPending=false when value and deferred match (post-flush invariant)', () => {
    const { result } = renderHook(() => useDeferredFilter('x'));

    // Repeated transitions to the same value must not report pending.
    act(() => {
      result.current.setValue('y');
    });
    expect(result.current.isPending).toBe(false);

    act(() => {
      result.current.setValue('y');
    });
    expect(result.current.isPending).toBe(false);
  });
});
