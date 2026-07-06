// Unit tests for `useKeyboardShortcuts`. Exercises the full keyboard state
// machine: cheat-sheet toggle, command-palette dispatch, `g`-prefixed GOTO
// navigation, the 1.5s GOTO auto-reset (a regression the old effect teardown
// used to swallow), the typing-target guard, modifier gating, and listener
// cleanup on unmount. `useNavigate` is stubbed the same way the page specs do
// it (see AutomationsListPage.test.tsx) so no Router wrapper is required.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { useKeyboardShortcuts, GOTO_SHORTCUTS } from './useKeyboardShortcuts';

interface PressOptions extends KeyboardEventInit {
  target?: EventTarget;
}

/** Dispatch a keydown that reaches the window-level listener and flush React. */
function press(key: string, options: PressOptions = {}): KeyboardEvent {
  const { target, ...init } = options;
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    (target ?? window).dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  navigateMock.mockClear();
});

describe('GOTO_SHORTCUTS map', () => {
  it('maps every entry to an absolute path and a non-empty label', () => {
    const entries = Object.values(GOTO_SHORTCUTS);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.path.startsWith('/')).toBe(true);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('pins the well-known navigation targets', () => {
    expect(GOTO_SHORTCUTS.d).toEqual({ path: '/', label: 'Dashboard' });
    expect(GOTO_SHORTCUTS.v).toEqual({ path: '/vehicles', label: 'Vehicles' });
    expect(GOTO_SHORTCUTS.c.path).toBe('/charging');
  });
});

describe('useKeyboardShortcuts — initial state', () => {
  it('starts idle with the cheat sheet hidden', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    expect(result.current.mode).toBe('idle');
    expect(result.current.showCheatSheet).toBe(false);
    expect(typeof result.current.toggleCheatSheet).toBe('function');
  });

  it('keeps a stable toggle callback identity across renders', () => {
    const { result, rerender } = renderHook(() => useKeyboardShortcuts());
    const first = result.current.toggleCheatSheet;
    rerender();
    expect(result.current.toggleCheatSheet).toBe(first);
  });
});

describe('useKeyboardShortcuts — cheat sheet', () => {
  it('toggles the cheat sheet on "?" and prevents the default', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    const event = press('?');
    expect(result.current.showCheatSheet).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    press('?');
    expect(result.current.showCheatSheet).toBe(false);
  });

  it('toggles the cheat sheet via the returned callback', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    act(() => result.current.toggleCheatSheet());
    expect(result.current.showCheatSheet).toBe(true);
  });

  it('ignores "?" while a modifier key is held', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    const event = press('?', { ctrlKey: true });
    expect(result.current.showCheatSheet).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('useKeyboardShortcuts — command palette', () => {
  it('dispatches toggle-command-palette on Ctrl+K', () => {
    const spy = vi.fn();
    window.addEventListener('toggle-command-palette', spy);
    const { unmount } = renderHook(() => useKeyboardShortcuts());
    const event = press('k', { ctrlKey: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    unmount();
    window.removeEventListener('toggle-command-palette', spy);
  });

  it('dispatches toggle-command-palette on "/" while idle', () => {
    const spy = vi.fn();
    window.addEventListener('toggle-command-palette', spy);
    renderHook(() => useKeyboardShortcuts());
    press('/');
    expect(spy).toHaveBeenCalledTimes(1);
    window.removeEventListener('toggle-command-palette', spy);
  });

  it('does not open the palette with "/" while in GOTO mode', () => {
    const spy = vi.fn();
    window.addEventListener('toggle-command-palette', spy);
    const { result } = renderHook(() => useKeyboardShortcuts());
    press('g');
    expect(result.current.mode).toBe('goto');
    press('/');
    expect(spy).not.toHaveBeenCalled();
    // '/' is not a GOTO target, so the machine falls back to idle.
    expect(result.current.mode).toBe('idle');
    window.removeEventListener('toggle-command-palette', spy);
  });
});

describe('useKeyboardShortcuts — GOTO navigation', () => {
  it('navigates when "g" is followed by a mapped key', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    press('g');
    expect(result.current.mode).toBe('goto');
    press('v');
    expect(navigateMock).toHaveBeenCalledWith('/vehicles');
    expect(result.current.mode).toBe('idle');
  });

  it('lower-cases the GOTO target so Shift+key still matches', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    press('g');
    press('V', { shiftKey: true });
    expect(navigateMock).toHaveBeenCalledWith('/vehicles');
    expect(result.current.mode).toBe('idle');
  });

  it('resets to idle without navigating on an unmapped GOTO key', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    press('g');
    press('z');
    expect(navigateMock).not.toHaveBeenCalled();
    expect(result.current.mode).toBe('idle');
  });

  it('does not enter GOTO mode when Ctrl is held with "g"', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    press('g', { ctrlKey: true });
    expect(result.current.mode).toBe('idle');
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — escape', () => {
  it('closes the cheat sheet and exits GOTO mode', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    press('?');
    press('g');
    expect(result.current.showCheatSheet).toBe(true);
    expect(result.current.mode).toBe('goto');
    press('Escape');
    expect(result.current.mode).toBe('idle');
    expect(result.current.showCheatSheet).toBe(false);
  });
});

describe('useKeyboardShortcuts — GOTO timeout auto-reset', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns to idle after the timeout when no target key follows "g"', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    press('g');
    expect(result.current.mode).toBe('goto');
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // Regression guard: the effect must not tear down the armed timeout, or
    // this stays stuck in 'goto' forever.
    expect(result.current.mode).toBe('idle');
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — typing guard', () => {
  it('ignores shortcuts while focus is inside a text input', () => {
    const { result } = renderHook(() => useKeyboardShortcuts());
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('?', { target: input });
    expect(result.current.showCheatSheet).toBe(false);
    press('g', { target: input });
    expect(result.current.mode).toBe('idle');
    document.body.removeChild(input);
  });
});

describe('useKeyboardShortcuts — cleanup', () => {
  it('adds on mount and removes the window keydown listener on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useKeyboardShortcuts());
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
