/**
 * useMediaQuery unit tests.
 *
 * Covers all three exports — `useMediaQuery`, `useIsMobile`,
 * `useIsCoarsePointer` — across every branch of the hook:
 *   - synchronous initial read from `matchMedia().matches`
 *   - the SSR / legacy-platform fallback when `window.matchMedia` is absent
 *     (jsdom ships without it, so this is the pristine default)
 *   - reactive updates via the modern `addEventListener('change', …)` API
 *   - listener cleanup on unmount and re-subscription when `query` changes
 *   - the "sync once in the effect" path when the first-paint default is stale
 *
 * jsdom has no `window.matchMedia`, so each test installs a controllable fake
 * (mirroring the pattern in `src/__tests__/mobile.viewport.test.tsx`) and the
 * shared `afterEach` wipes it to keep the no-matchMedia branch honest.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useMediaQuery, useIsMobile, useIsCoarsePointer } from '../useMediaQuery';

type ChangeListener = (event: MediaQueryListEvent) => void;

interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  onchange: null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
}

/**
 * Install a controllable `window.matchMedia` fake.
 *
 * @param resolve decides `matches` per call. Receives the query and a
 *   monotonically increasing call index so a test can simulate a resize
 *   between the initial render read and the effect read (different values
 *   on successive calls for the same query).
 */
function installMatchMedia(resolve: (query: string, callIndex: number) => boolean) {
  const instances: FakeMediaQueryList[] = [];
  const listenersByQuery = new Map<string, Set<ChangeListener>>();
  let callIndex = 0;

  const spy = vi.fn((query: string): FakeMediaQueryList => {
    const listeners = listenersByQuery.get(query) ?? new Set<ChangeListener>();
    listenersByQuery.set(query, listeners);
    const mql: FakeMediaQueryList = {
      matches: resolve(query, callIndex++),
      media: query,
      onchange: null,
      addEventListener: vi.fn((type: string, cb: ChangeListener) => {
        if (type === 'change') listeners.add(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: ChangeListener) => {
        if (type === 'change') listeners.delete(cb);
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    };
    instances.push(mql);
    return mql;
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: spy,
  });

  return {
    spy,
    instances,
    lastFor: (query: string) => [...instances].reverse().find((m) => m.media === query),
    fire: (query: string, matches: boolean) => {
      listenersByQuery
        .get(query)
        ?.forEach((cb) => cb({ matches, media: query } as MediaQueryListEvent));
    },
  };
}

afterEach(() => {
  // jsdom ships without matchMedia — wiping our per-test install leaves the
  // environment pristine so the "no matchMedia" fallback branch is genuine.
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('useMediaQuery', () => {
  it('returns the initial match state synchronously on first render', () => {
    installMatchMedia(() => true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'));
    expect(result.current).toBe(true);
  });

  it('returns false when the query does not match and forwards the exact query', () => {
    const ctl = installMatchMedia((q) => q === '(min-width: 1200px)');
    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'));
    expect(result.current).toBe(false);
    expect(ctl.spy).toHaveBeenCalledWith('(max-width: 640px)');
  });

  it('falls back to false without throwing when window.matchMedia is unavailable', () => {
    // Guarantee the SSR / legacy-platform branch: nothing installed.
    Reflect.deleteProperty(window, 'matchMedia');
    expect(window.matchMedia).toBeUndefined();
    const { result } = renderHook(() => useMediaQuery('(pointer: coarse)'));
    expect(result.current).toBe(false);
  });

  it('subscribes via the modern addEventListener("change") API, never addListener', () => {
    const ctl = installMatchMedia(() => false);
    renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)'));
    const mql = ctl.lastFor('(prefers-reduced-motion: reduce)');
    expect(mql?.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(mql?.addListener).not.toHaveBeenCalled();
  });

  it('re-renders reactively when the media query flips on and back off', () => {
    const ctl = installMatchMedia(() => false);
    const { result } = renderHook(() => useMediaQuery('(pointer: coarse)'));
    expect(result.current).toBe(false);

    act(() => ctl.fire('(pointer: coarse)', true));
    expect(result.current).toBe(true);

    act(() => ctl.fire('(pointer: coarse)', false));
    expect(result.current).toBe(false);
  });

  it('re-syncs to the live value in the effect when the first-paint default was stale', () => {
    // First matchMedia() call (the useState initial read) reports false; the
    // second call (inside useEffect) reports true — as if the viewport changed
    // between render and commit. The hook must converge on the effect value.
    const ctl = installMatchMedia((_query, callIndex) => callIndex > 0);
    const { result } = renderHook(() => useMediaQuery('(max-width: 640px)'));
    expect(result.current).toBe(true);
    expect(ctl.spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('removes its change listener on unmount', () => {
    const ctl = installMatchMedia(() => false);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    const mql = ctl.lastFor('(min-width: 1024px)');
    unmount();
    expect(mql?.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('unsubscribes the old query and re-subscribes when the query prop changes', () => {
    const ctl = installMatchMedia((q) => q === '(min-width: 1024px)');
    const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: '(max-width: 640px)' },
    });
    expect(result.current).toBe(false);
    const first = ctl.lastFor('(max-width: 640px)');

    rerender({ q: '(min-width: 1024px)' });

    expect(first?.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(ctl.spy).toHaveBeenCalledWith('(min-width: 1024px)');
    expect(result.current).toBe(true);
  });

  it('does not cross-contaminate listeners between distinct queries', () => {
    const ctl = installMatchMedia(() => false);
    const { result } = renderHook(() => useMediaQuery('(pointer: coarse)'));
    expect(result.current).toBe(false);
    // Firing an unrelated query must not flip this hook's state.
    act(() => ctl.fire('(max-width: 640px)', true));
    expect(result.current).toBe(false);
  });
});

describe('useIsMobile', () => {
  it('queries the (max-width: 640px) phone breakpoint and matches on a narrow viewport', () => {
    const ctl = installMatchMedia((q) => q === '(max-width: 640px)');
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    expect(ctl.spy).toHaveBeenCalledWith('(max-width: 640px)');
  });

  it('reports false on a wide viewport', () => {
    installMatchMedia(() => false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});

describe('useIsCoarsePointer', () => {
  it('queries (pointer: coarse) and reports true for touch devices', () => {
    const ctl = installMatchMedia((q) => q === '(pointer: coarse)');
    const { result } = renderHook(() => useIsCoarsePointer());
    expect(result.current).toBe(true);
    expect(ctl.spy).toHaveBeenCalledWith('(pointer: coarse)');
  });

  it('updates when a coarse pointer is attached at runtime', () => {
    const ctl = installMatchMedia(() => false);
    const { result } = renderHook(() => useIsCoarsePointer());
    expect(result.current).toBe(false);
    act(() => ctl.fire('(pointer: coarse)', true));
    expect(result.current).toBe(true);
  });
});
