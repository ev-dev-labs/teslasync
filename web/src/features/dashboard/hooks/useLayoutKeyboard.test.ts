/**
 * useLayoutKeyboard — behavioural coverage + hardening regression tests.
 *
 * The hook wires a single global `keydown` listener that drives the dashboard's
 * keyboard shortcuts (toggle edit, exit, help overlay, undo/redo, Alt+n layout
 * switch) and, separately, publishes those entries to the shortcut registry so
 * the `?` cheatsheet can list them.
 *
 * `react-i18next` is stubbed to the repo's passthrough `t(key, default)`
 * convention and `useShortcut` is mocked to a spy so the registry side-effect
 * can be asserted without a Router / QueryClient. Keyboard input is driven with
 * real `KeyboardEvent`s dispatched on `window` (the repo has no
 * `@testing-library/user-event`) — this also mirrors how a real browser reports
 * `key`, notably the uppercase `Z` while Shift is held, which is the regression
 * this suite locks in for redo-via-Ctrl+Shift+Z.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { SavedDashboard } from '../widgets/types';
import type { ShortcutDefinition } from '@/hooks/useShortcutRegistry';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}));

vi.mock('@/hooks/useShortcutRegistry', () => ({
  useShortcut: vi.fn(),
}));

import { useShortcut } from '@/hooks/useShortcutRegistry';
import { useLayoutKeyboard } from './useLayoutKeyboard';

const mockUseShortcut = vi.mocked(useShortcut);

type Options = Parameters<typeof useLayoutKeyboard>[0];

function makeDash(id: string): SavedDashboard {
  return {
    id,
    name: id.toUpperCase(),
    widgets: [],
    layouts: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function setup(over: Partial<Options> = {}) {
  const opts: Options = {
    editMode: false,
    setEditMode: vi.fn(),
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    dashboards: [makeDash('a'), makeDash('b')],
    switchDashboard: vi.fn(),
    ...over,
  };
  const view = renderHook((props: Options) => useLayoutKeyboard(props), {
    initialProps: opts,
  });
  return { opts, ...view };
}

function press(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function lastRegistered(): ShortcutDefinition[] {
  const arg = mockUseShortcut.mock.lastCall?.[0];
  if (!arg) return [];
  return Array.isArray(arg) ? arg : [arg];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('useLayoutKeyboard — keyboard handling', () => {
  it('toggles edit mode on a bare "e" and prevents the default', () => {
    const { opts } = setup({ editMode: false });
    const event = press({ key: 'e' });
    expect(opts.setEditMode).toHaveBeenCalledTimes(1);
    expect(opts.setEditMode).toHaveBeenCalledWith(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('toggles edit mode off when already editing', () => {
    const { opts } = setup({ editMode: true });
    press({ key: 'e' });
    expect(opts.setEditMode).toHaveBeenCalledWith(false);
  });

  it('ignores Shift+E so it never toggles edit mode', () => {
    const { opts } = setup({ editMode: false });
    const event = press({ key: 'E', shiftKey: true });
    expect(opts.setEditMode).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('exits edit mode on Escape while editing', () => {
    const { opts } = setup({ editMode: true });
    const event = press({ key: 'Escape' });
    expect(opts.setEditMode).toHaveBeenCalledWith(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing on Escape when not editing', () => {
    const { opts } = setup({ editMode: false });
    press({ key: 'Escape' });
    expect(opts.setEditMode).not.toHaveBeenCalled();
  });

  it('opens the shortcuts overlay on "?" and on Shift+/', () => {
    const overlay = vi.fn();
    window.addEventListener('toggle-keyboard-shortcuts', overlay);
    setup();
    press({ key: '?' });
    press({ key: '/', shiftKey: true });
    expect(overlay).toHaveBeenCalledTimes(2);
    window.removeEventListener('toggle-keyboard-shortcuts', overlay);
  });

  it('switches to the matching dashboard on Alt+number', () => {
    const { opts } = setup({
      dashboards: [makeDash('a'), makeDash('b'), makeDash('c')],
    });
    const event = press({ key: '2', altKey: true });
    expect(opts.switchDashboard).toHaveBeenCalledWith('b');
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores Alt+number outside the dashboard range', () => {
    const { opts } = setup({ dashboards: [makeDash('a'), makeDash('b')] });
    press({ key: '3', altKey: true });
    expect(opts.switchDashboard).not.toHaveBeenCalled();
  });

  it('ignores Alt+Shift+number because of the modifier guard', () => {
    const { opts } = setup();
    press({ key: '1', altKey: true, shiftKey: true });
    expect(opts.switchDashboard).not.toHaveBeenCalled();
  });

  it('ignores shortcuts while focus is inside a form field', () => {
    const { opts } = setup({ editMode: false });
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      press({ key: 'e' }, el);
      document.body.removeChild(el);
    }
    expect(opts.setEditMode).not.toHaveBeenCalled();
  });

  it('ignores shortcuts inside a contenteditable element', () => {
    const { opts } = setup({ editMode: false });
    const el = document.createElement('div');
    Object.defineProperty(el, 'isContentEditable', { value: true });
    document.body.appendChild(el);
    press({ key: 'e' }, el);
    document.body.removeChild(el);
    expect(opts.setEditMode).not.toHaveBeenCalled();
  });

  it('undoes on Ctrl+Z when editing and undo is available', () => {
    const { opts } = setup({ editMode: true, canUndo: true });
    const event = press({ key: 'z', ctrlKey: true });
    expect(opts.onUndo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not undo when canUndo is false', () => {
    const { opts } = setup({ editMode: true, canUndo: false });
    const event = press({ key: 'z', ctrlKey: true });
    expect(opts.onUndo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('redoes on Ctrl+Y', () => {
    const { opts } = setup({ editMode: true, canRedo: true });
    press({ key: 'y', ctrlKey: true });
    expect(opts.onRedo).toHaveBeenCalledTimes(1);
  });

  it('redoes on Ctrl+Shift+Z even though the browser reports uppercase "Z"', () => {
    const { opts } = setup({ editMode: true, canRedo: true });
    const event = press({ key: 'Z', ctrlKey: true, shiftKey: true });
    expect(opts.onRedo).toHaveBeenCalledTimes(1);
    expect(opts.onUndo).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('accepts Meta (Cmd) as the undo modifier', () => {
    const { opts } = setup({ editMode: true });
    press({ key: 'z', metaKey: true });
    expect(opts.onUndo).toHaveBeenCalledTimes(1);
  });

  it('never undoes or redoes when not in edit mode', () => {
    const { opts } = setup({ editMode: false });
    press({ key: 'z', ctrlKey: true });
    press({ key: 'y', ctrlKey: true });
    expect(opts.onUndo).not.toHaveBeenCalled();
    expect(opts.onRedo).not.toHaveBeenCalled();
  });

  it('detaches the keydown listener on unmount', () => {
    const { opts, unmount } = setup({ editMode: false });
    unmount();
    press({ key: 'e' });
    expect(opts.setEditMode).not.toHaveBeenCalled();
  });
});

describe('useLayoutKeyboard — cheatsheet registration', () => {
  it('registers only the toggle-edit shortcut by default', () => {
    setup({ editMode: false, dashboards: [makeDash('a')] });
    const defs = lastRegistered();
    expect(defs.map((d) => d.id)).toEqual(['dashboard.toggleEdit']);
    const toggle = defs[0];
    expect(toggle?.keys).toEqual(['E']);
    expect(toggle?.group).toBe('Dashboard');
    expect(toggle?.scope).toBe('route');
    expect(toggle?.routeMatch).toBeInstanceOf(RegExp);
  });

  it('adds exit + undo + redo shortcuts while in edit mode', () => {
    setup({ editMode: true, dashboards: [makeDash('a')] });
    const ids = lastRegistered().map((d) => d.id);
    expect(ids).toContain('dashboard.exitEdit');
    expect(ids).toContain('dashboard.undo');
    expect(ids).toContain('dashboard.redo');
  });

  it('adds the switch shortcut only when more than one dashboard exists', () => {
    const single = (() => {
      setup({ editMode: false, dashboards: [makeDash('a')] });
      return lastRegistered().map((d) => d.id);
    })();
    expect(single).not.toContain('dashboard.switch');

    cleanup();
    vi.clearAllMocks();

    setup({ editMode: false, dashboards: [makeDash('a'), makeDash('b')] });
    const many = lastRegistered().map((d) => d.id);
    expect(many).toContain('dashboard.switch');
  });
});
