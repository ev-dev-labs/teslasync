import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook as renderHookBase } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import {
  useKioskMode,
  DEFAULT_KIOSK_CONFIG,
  type KioskConfig,
} from './useKioskMode';
import type { SavedDashboard } from '../widgets/types';

/**
 * useKioskMode contract.
 *
 * The hook owns four concerns worth pinning:
 *   1. Persisted config load/merge/save (localStorage, corruption-tolerant).
 *   2. `validIds` sanitisation against the live dashboard set (defends against
 *      corrupted storage + undefined props — the reason this file was hardened).
 *   3. Enter/exit kiosk incl. Fullscreen API and browser-driven Esc exit.
 *   4. Timer-driven behaviours: auto-rotation, cursor auto-hide, screen dim,
 *      and the `?kiosk=true` URL auto-entry.
 *
 * The Fullscreen API is not implemented by jsdom, so it is stubbed per-suite.
 */

// Not exported by the source (matches the useOnboardingSkip.test convention of
// hardcoding the storage key), but it is the stable persistence contract.
const KIOSK_CONFIG_KEY = 'teslasync-kiosk-config';

function browserRouterWrapper({ children }: { children: ReactNode }) {
  return createElement(BrowserRouter, null, children);
}

const renderHook: typeof renderHookBase = (callback, options) =>
  renderHookBase(callback, {
    ...options,
    wrapper: browserRouterWrapper,
  });

function makeDashboard(id: string, name = id): SavedDashboard {
  return {
    id,
    name,
    widgets: [],
    layouts: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

const THREE = [makeDashboard('a'), makeDashboard('b'), makeDashboard('c')];

/** Override the read-only `document.fullscreenElement` for a test. */
function setFullscreenElement(el: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => el,
  });
}

let requestFullscreen: ReturnType<typeof vi.fn>;
let exitFullscreen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  // Reset the URL so the `?kiosk=true` effect doesn't leak across tests.
  window.history.replaceState({}, '', '/');

  requestFullscreen = vi.fn().mockResolvedValue(undefined);
  exitFullscreen = vi.fn().mockResolvedValue(undefined);
  document.documentElement.requestFullscreen = requestFullscreen as unknown as typeof document.documentElement.requestFullscreen;
  document.exitFullscreen = exitFullscreen as unknown as typeof document.exitFullscreen;
  setFullscreenElement(null);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Drive the async enterKiosk() to completion inside act(). */
async function enter(result: { current: ReturnType<typeof useKioskMode> }): Promise<void> {
  await act(async () => {
    await result.current.enterKiosk();
  });
}

describe('DEFAULT_KIOSK_CONFIG', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_KIOSK_CONFIG.rotateInterval).toBe(30);
    expect(DEFAULT_KIOSK_CONFIG.dashboardIds).toEqual([]);
    expect(DEFAULT_KIOSK_CONFIG.hideCursor).toBe(true);
    expect(DEFAULT_KIOSK_CONFIG.clockPosition).toBe('bottom-right');
    expect(DEFAULT_KIOSK_CONFIG.widgetOpacity).toBe(1.0);
    expect(DEFAULT_KIOSK_CONFIG.backgroundOpacity).toBe(1.0);
  });
});

describe('useKioskMode — config persistence', () => {
  it('starts from defaults when storage is empty', () => {
    const { result } = renderHook(() =>
      useKioskMode(THREE, 'a', vi.fn()),
    );
    expect(result.current.config).toEqual(DEFAULT_KIOSK_CONFIG);
    expect(result.current.isKiosk).toBe(false);
    expect(result.current.isDimmed).toBe(false);
    expect(result.current.isCursorHidden).toBe(false);
  });

  it('hydrates and merges a partial persisted config over the defaults', () => {
    window.localStorage.setItem(
      KIOSK_CONFIG_KEY,
      JSON.stringify({ rotateInterval: 12, showClock: false }),
    );
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));

    expect(result.current.config.rotateInterval).toBe(12);
    expect(result.current.config.showClock).toBe(false);
    // Unspecified keys retain their defaults.
    expect(result.current.config.hideCursor).toBe(DEFAULT_KIOSK_CONFIG.hideCursor);
  });

  it('falls back to defaults on corrupted JSON', () => {
    window.localStorage.setItem(KIOSK_CONFIG_KEY, '{ this is : not json');
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    expect(result.current.config).toEqual(DEFAULT_KIOSK_CONFIG);
  });

  it('ignores a non-object payload (array/primitive) rather than merging junk keys', () => {
    window.localStorage.setItem(KIOSK_CONFIG_KEY, JSON.stringify([1, 2, 3]));
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    expect(result.current.config).toEqual(DEFAULT_KIOSK_CONFIG);
  });

  it('updateConfig merges, updates state, and persists to localStorage', () => {
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));

    act(() => {
      result.current.updateConfig({ rotateInterval: 45, hideCursor: false });
    });

    expect(result.current.config.rotateInterval).toBe(45);
    expect(result.current.config.hideCursor).toBe(false);
    const persisted = JSON.parse(
      window.localStorage.getItem(KIOSK_CONFIG_KEY) as string,
    ) as KioskConfig;
    expect(persisted.rotateInterval).toBe(45);
    expect(persisted.hideCursor).toBe(false);
  });

  it('updateConfig does not throw when persistence fails (quota / disabled storage)', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));

    expect(() =>
      act(() => {
        result.current.updateConfig({ rotateInterval: 5 });
      }),
    ).not.toThrow();
    // State still updates even though the write was swallowed.
    expect(result.current.config.rotateInterval).toBe(5);
    spy.mockRestore();
  });
});

describe('useKioskMode — validIds sanitisation', () => {
  it('rotates through all dashboards when no explicit selection is configured', () => {
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    expect(result.current.validIds).toEqual(['a', 'b', 'c']);
  });

  it('honours an explicit valid selection and drops ids that no longer exist', () => {
    window.localStorage.setItem(
      KIOSK_CONFIG_KEY,
      JSON.stringify({ dashboardIds: ['c', 'gone', 'a'] }),
    );
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    expect(result.current.validIds).toEqual(['c', 'a']);
  });

  it('falls back to all dashboards when the configured selection matches nothing', () => {
    window.localStorage.setItem(
      KIOSK_CONFIG_KEY,
      JSON.stringify({ dashboardIds: ['ghost-1', 'ghost-2'] }),
    );
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    expect(result.current.validIds).toEqual(['a', 'b', 'c']);
  });

  it('tolerates a corrupted non-array dashboardIds without throwing (regression)', () => {
    // Before hardening this crashed with `dashboardIds.filter is not a function`.
    window.localStorage.setItem(
      KIOSK_CONFIG_KEY,
      JSON.stringify({ dashboardIds: 'not-an-array' }),
    );
    expect(() =>
      renderHook(() => useKioskMode(THREE, 'a', vi.fn())),
    ).not.toThrow();
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    expect(result.current.validIds).toEqual(['a', 'b', 'c']);
  });

  it('tolerates an undefined dashboards prop without throwing (regression)', () => {
    const { result } = renderHook(() =>
      useKioskMode(undefined as unknown as SavedDashboard[], 'a', vi.fn()),
    );
    expect(result.current.validIds).toEqual([]);
  });
});

describe('useKioskMode — rotateIndex derivation', () => {
  it('maps the active id to its position within validIds', () => {
    const { result } = renderHook(() => useKioskMode(THREE, 'b', vi.fn()));
    expect(result.current.rotateIndex).toBe(1);
  });

  it('falls back to 0 when the active id is not part of the rotation set', () => {
    const { result } = renderHook(() =>
      useKioskMode(THREE, 'not-present', vi.fn()),
    );
    expect(result.current.rotateIndex).toBe(0);
  });

  it('recomputes when the active id changes', () => {
    const { result, rerender } = renderHook(
      ({ activeId }) => useKioskMode(THREE, activeId, vi.fn()),
      { initialProps: { activeId: 'a' } },
    );
    expect(result.current.rotateIndex).toBe(0);
    rerender({ activeId: 'c' });
    expect(result.current.rotateIndex).toBe(2);
  });
});

describe('useKioskMode — enter / exit', () => {
  it('enterKiosk requests fullscreen and flips isKiosk on', async () => {
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    await enter(result);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isKiosk).toBe(true);
  });

  it('still enables kiosk when the fullscreen request is rejected', async () => {
    requestFullscreen.mockRejectedValueOnce(new Error('permission denied'));
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    await enter(result);
    expect(result.current.isKiosk).toBe(true);
  });

  it('exitKiosk leaves fullscreen (when active) and clears kiosk state', async () => {
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    await enter(result);
    setFullscreenElement(document.documentElement);

    act(() => {
      result.current.exitKiosk();
    });

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isKiosk).toBe(false);
    expect(result.current.isDimmed).toBe(false);
    expect(result.current.isCursorHidden).toBe(false);
  });

  it('exitKiosk does not call exitFullscreen when not in fullscreen', async () => {
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    await enter(result);
    setFullscreenElement(null);

    act(() => {
      result.current.exitKiosk();
    });

    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(result.current.isKiosk).toBe(false);
  });

  it('exits kiosk when the browser leaves fullscreen (Esc key)', async () => {
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    await enter(result);
    expect(result.current.isKiosk).toBe(true);

    setFullscreenElement(null);
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.isKiosk).toBe(false);
  });
});

describe('useKioskMode — auto-rotation', () => {
  it('advances to the next dashboard after the configured interval', async () => {
    vi.useFakeTimers();
    const switchDashboard = vi.fn();
    const { result } = renderHook(() =>
      useKioskMode(THREE, 'a', switchDashboard),
    );
    await enter(result);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_KIOSK_CONFIG.rotateInterval * 1000);
    });

    expect(switchDashboard).toHaveBeenCalledWith('b');
  });

  it('does not rotate while kiosk mode is inactive', () => {
    vi.useFakeTimers();
    const switchDashboard = vi.fn();
    renderHook(() => useKioskMode(THREE, 'a', switchDashboard));

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(switchDashboard).not.toHaveBeenCalled();
  });

  it('does not rotate when only a single dashboard is in the set', async () => {
    vi.useFakeTimers();
    const switchDashboard = vi.fn();
    const { result } = renderHook(() =>
      useKioskMode([makeDashboard('solo')], 'solo', switchDashboard),
    );
    await enter(result);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(switchDashboard).not.toHaveBeenCalled();
  });

  it('does not rotate when the interval is disabled (<= 0)', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      KIOSK_CONFIG_KEY,
      JSON.stringify({ rotateInterval: 0 }),
    );
    const switchDashboard = vi.fn();
    const { result } = renderHook(() =>
      useKioskMode(THREE, 'a', switchDashboard),
    );
    await enter(result);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(switchDashboard).not.toHaveBeenCalled();
  });
});

describe('useKioskMode — cursor auto-hide', () => {
  it('hides the cursor after the timeout and reveals it on pointer movement', async () => {
    vi.useFakeTimers();
    // Single dashboard so the rotation timer stays out of the way.
    const { result } = renderHook(() =>
      useKioskMode([makeDashboard('solo')], 'solo', vi.fn()),
    );
    await enter(result);

    expect(result.current.isCursorHidden).toBe(false);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_KIOSK_CONFIG.cursorTimeout * 1000);
    });
    expect(result.current.isCursorHidden).toBe(true);

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'));
    });
    expect(result.current.isCursorHidden).toBe(false);
  });

  it('never hides the cursor when hideCursor is disabled', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      KIOSK_CONFIG_KEY,
      JSON.stringify({ hideCursor: false }),
    );
    const { result } = renderHook(() =>
      useKioskMode([makeDashboard('solo')], 'solo', vi.fn()),
    );
    await enter(result);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.isCursorHidden).toBe(false);
  });
});

describe('useKioskMode — screen dim (burn-in prevention)', () => {
  it('dims after the configured idle minutes and clears on interaction', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      KIOSK_CONFIG_KEY,
      // dimAfter is in minutes; disable the cursor timer to isolate dim.
      JSON.stringify({ dimAfter: 1, hideCursor: false }),
    );
    const { result } = renderHook(() =>
      useKioskMode([makeDashboard('solo')], 'solo', vi.fn()),
    );
    await enter(result);

    expect(result.current.isDimmed).toBe(false);

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(result.current.isDimmed).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(result.current.isDimmed).toBe(false);
  });

  it('never dims when dimAfter is 0', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useKioskMode([makeDashboard('solo')], 'solo', vi.fn()),
    );
    await enter(result);

    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000);
    });

    expect(result.current.isDimmed).toBe(false);
  });
});

describe('useKioskMode — URL auto-entry', () => {
  it('auto-enters kiosk on ?kiosk=true and canonicalizes the URL', async () => {
    window.history.replaceState({}, '', '/dashboard?kiosk=true&tab=fleet');

    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    // Flush the (unawaited) enterKiosk() the effect kicked off.
    await act(async () => {
      await Promise.resolve();
    });

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isKiosk).toBe(true);
    const params = new URLSearchParams(window.location.search);
    expect(params.get('kiosk')).toBeNull();
    expect(params.get('presentation')).toBe('kiosk');
    expect(params.get('tab')).toBe('fleet');
  });

  it('does not auto-enter kiosk without the query flag', async () => {
    window.history.replaceState({}, '', '/dashboard');
    const { result } = renderHook(() => useKioskMode(THREE, 'a', vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });

    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(result.current.isKiosk).toBe(false);
  });
});
