/**
 * Phase-46 / Prompt 12 — useAnnouncer module tests.
 *
 * Validates the module-level pub/sub mechanics WITHOUT rendering the
 * AnnouncerRegion component (those integration tests live next to
 * AnnouncerRegion itself).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  announce,
  subscribeAnnouncer,
  useAnnouncer,
  __resetAnnouncerForTests,
  __getAnnouncerListenerCountForTests,
} from '../useAnnouncer';

beforeEach(() => {
  __resetAnnouncerForTests();
});

describe('useAnnouncer', () => {
  it('returns a stable object across re-renders', () => {
    const { result, rerender } = renderHook(() => useAnnouncer());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('exposes the announce function', () => {
    const { result } = renderHook(() => useAnnouncer());
    expect(typeof result.current.announce).toBe('function');
  });
});

describe('subscribeAnnouncer / announce', () => {
  it('delivers messages to subscribed listeners', () => {
    const listener = vi.fn();
    subscribeAnnouncer(listener);
    announce('hello');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1]).toBe('polite');
    expect(listener.mock.calls[0][0]).toContain('hello');
  });

  it('routes the priority argument through to listeners', () => {
    const listener = vi.fn();
    subscribeAnnouncer(listener);
    announce('error!', 'assertive');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1]).toBe('assertive');
  });

  it('defaults the priority to polite when not provided', () => {
    const listener = vi.fn();
    subscribeAnnouncer(listener);
    announce('default-priority');
    expect(listener.mock.calls[0][1]).toBe('polite');
  });

  it('skips empty messages', () => {
    const listener = vi.fn();
    subscribeAnnouncer(listener);
    announce('');
    expect(listener).not.toHaveBeenCalled();
  });

  it('appends a rotating zero-width-space suffix so duplicates re-fire', () => {
    const listener = vi.fn();
    subscribeAnnouncer(listener);
    announce('same');
    announce('same');
    announce('same');
    expect(listener).toHaveBeenCalledTimes(3);
    const messages = listener.mock.calls.map((c) => c[0] as string);
    expect(messages[0]).not.toBe(messages[1]);
    expect(messages[1]).not.toBe(messages[2]);
    for (const msg of messages) {
      expect(msg.startsWith('same')).toBe(true);
    }
  });

  it('unsubscribe removes the listener and stops further deliveries', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnnouncer(listener);
    announce('first');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    announce('second');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports multiple concurrent listeners', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscribeAnnouncer(listenerA);
    subscribeAnnouncer(listenerB);
    announce('broadcast');
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it('listener count helper reflects the live subscriber set', () => {
    expect(__getAnnouncerListenerCountForTests()).toBe(0);
    const unsub = subscribeAnnouncer(() => {});
    expect(__getAnnouncerListenerCountForTests()).toBe(1);
    unsub();
    expect(__getAnnouncerListenerCountForTests()).toBe(0);
  });

  it('no-ops silently when there are no subscribers', () => {
    expect(() => announce('drop me')).not.toThrow();
  });

  it('useAnnouncer().announce delivers to subscribed listeners', () => {
    const listener = vi.fn();
    subscribeAnnouncer(listener);
    const { result } = renderHook(() => useAnnouncer());
    act(() => {
      result.current.announce('via hook');
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toContain('via hook');
  });
});
