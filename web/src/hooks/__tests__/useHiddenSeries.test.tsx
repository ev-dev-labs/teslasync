/**
 * Phase-46 / Prompt 67 — useHiddenSeries hook tests.
 *
 * Verifies the URL-state-backed hidden-series tracker:
 *   - default empty Set when no `?hidden_…` param present
 *   - `toggle()` mirrors writes to the URL with sorted, comma-joined values
 *   - re-renders pick up URL mutations made by another caller
 *   - `reset()` removes the param entirely
 *   - identity-stable Set across renders when raw URL hasn't changed
 */
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { type ReactNode } from 'react';
import { useHiddenSeries } from '../useHiddenSeries';

function wrapperWith(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useHiddenSeries', () => {
  it('starts empty when no URL param is present', () => {
    const { result } = renderHook(() => useHiddenSeries('chart-a'), {
      wrapper: wrapperWith('/page'),
    });
    expect(result.current.hidden.size).toBe(0);
    expect(result.current.isHidden('foo')).toBe(false);
  });

  it('hydrates from an existing ?hidden_<key>=… URL param', () => {
    const { result } = renderHook(() => useHiddenSeries('chart-a'), {
      wrapper: wrapperWith('/page?hidden_chart-a=health,projected'),
    });
    expect(result.current.hidden.size).toBe(2);
    expect(result.current.isHidden('health')).toBe(true);
    expect(result.current.isHidden('projected')).toBe(true);
    expect(result.current.isHidden('other')).toBe(false);
  });

  it('toggle() adds a new key and writes to the URL', () => {
    const probe: { current: string } = { current: '' };
    const { result } = renderHook(
      () => {
        const state = useHiddenSeries('chart-a');
        // Read the live URL to assert the param is mirrored.
        const loc = useLocation();
        probe.current = loc.search;
        return state;
      },
      { wrapper: wrapperWith('/page') },
    );
    act(() => result.current.toggle('series-a'));
    expect(result.current.isHidden('series-a')).toBe(true);
    expect(probe.current).toContain('hidden_chart-a=series-a');
  });

  it('toggle() removes a previously hidden key', () => {
    const { result } = renderHook(() => useHiddenSeries('chart-a'), {
      wrapper: wrapperWith('/page?hidden_chart-a=series-a'),
    });
    expect(result.current.isHidden('series-a')).toBe(true);
    act(() => result.current.toggle('series-a'));
    expect(result.current.isHidden('series-a')).toBe(false);
  });

  it('writes the hidden set in alphabetically sorted order', () => {
    const probe: { current: string } = { current: '' };
    const { result } = renderHook(
      () => {
        const state = useHiddenSeries('chart-a');
        const loc = useLocation();
        probe.current = loc.search;
        return state;
      },
      { wrapper: wrapperWith('/page') },
    );
    act(() => result.current.toggle('zebra'));
    act(() => result.current.toggle('alpha'));
    act(() => result.current.toggle('mango'));
    // Toggling in z/a/m order MUST yield ?hidden_chart-a=alpha,mango,zebra
    // so two pasted URLs comparing the same set are byte-for-byte equal.
    expect(probe.current).toContain('hidden_chart-a=alpha%2Cmango%2Czebra');
  });

  it('reset() clears every hidden flag and drops the URL param', () => {
    const probe: { current: string } = { current: '' };
    const { result } = renderHook(
      () => {
        const state = useHiddenSeries('chart-a');
        const loc = useLocation();
        probe.current = loc.search;
        return state;
      },
      { wrapper: wrapperWith('/page?hidden_chart-a=a,b') },
    );
    expect(result.current.hidden.size).toBe(2);
    act(() => result.current.reset());
    expect(result.current.hidden.size).toBe(0);
    expect(probe.current).not.toContain('hidden_chart-a');
  });

  it('isolates state between distinct chartKeys', () => {
    const { result } = renderHook(
      () => {
        return {
          a: useHiddenSeries('chart-a'),
          b: useHiddenSeries('chart-b'),
        };
      },
      { wrapper: wrapperWith('/page') },
    );
    act(() => result.current.a.toggle('shared-name'));
    expect(result.current.a.isHidden('shared-name')).toBe(true);
    expect(result.current.b.isHidden('shared-name')).toBe(false);
  });

  it('returns a stable Set reference when the URL has not changed', () => {
    const { result, rerender } = renderHook(() => useHiddenSeries('chart-a'), {
      wrapper: wrapperWith('/page?hidden_chart-a=a,b'),
    });
    const first = result.current.hidden;
    rerender();
    expect(result.current.hidden).toBe(first);
  });
});
