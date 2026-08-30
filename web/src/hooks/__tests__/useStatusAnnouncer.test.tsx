/**
 * Governed status announcer contract (A11Y-06).
 *
 * Asserts that the semantic helpers reach the shared live region with
 * the right priority, that a burst collapses into a single trailing
 * emit, and that `useLoadAnnouncement` fires only on the
 * loading → settled edge (so `refetchInterval` pages stay silent).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useStatusAnnouncer,
  useLoadAnnouncement,
  __resetStatusAnnouncerForTests,
} from '@/hooks/useStatusAnnouncer';
import {
  subscribeAnnouncer,
  __resetAnnouncerForTests,
  type AnnouncerPriority,
} from '@/hooks/useAnnouncer';
import { __resetAnnouncePolicyForTests } from '@/lib/announcePolicy';

interface Spoken {
  message: string;
  priority: AnnouncerPriority;
}

/** Collects everything pushed at the live region during a test. */
function captureAnnouncements(): { spoken: Spoken[]; stop: () => void } {
  const spoken: Spoken[] = [];
  const stop = subscribeAnnouncer((message, priority) => {
    // Strip the announcer's rotating zero-width-space de-dupe suffix.
    spoken.push({ message: message.replace(/\u200B+$/, ''), priority });
  });
  return { spoken, stop };
}

describe('useStatusAnnouncer', () => {
  let capture: ReturnType<typeof captureAnnouncements>;

  beforeEach(() => {
    __resetAnnouncerForTests();
    __resetAnnouncePolicyForTests();
    __resetStatusAnnouncerForTests();
    capture = captureAnnouncements();
  });

  afterEach(() => {
    capture.stop();
    __resetStatusAnnouncerForTests();
    vi.useRealTimers();
  });

  it('returns a referentially stable API', () => {
    const { result, rerender } = renderHook(() => useStatusAnnouncer());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('announces load completion politely', () => {
    const { result } = renderHook(() => useStatusAnnouncer());
    act(() => result.current.announceLoaded('Drives', 42));
    expect(capture.spoken).toHaveLength(1);
    expect(capture.spoken[0].priority).toBe('polite');
  });

  it('announces refresh failures assertively', () => {
    const { result } = renderHook(() => useStatusAnnouncer());
    act(() => result.current.announceRefreshError('Drives'));
    expect(capture.spoken[0].priority).toBe('assertive');
  });

  it('collapses duplicate refresh errors from sibling panels', () => {
    const { result } = renderHook(() => useStatusAnnouncer());
    act(() => {
      result.current.announceRefreshError('Drives');
      result.current.announceRefreshError('Drives');
      result.current.announceRefreshError('Drives');
    });
    expect(capture.spoken).toHaveLength(1);
  });

  it('keeps unrelated channels independent', () => {
    const { result } = renderHook(() => useStatusAnnouncer());
    act(() => {
      result.current.announceRefreshError('Drives');
      result.current.announceSaved('Settings');
    });
    expect(capture.spoken).toHaveLength(2);
  });

  it('reports a partial bulk outcome assertively', () => {
    const { result } = renderHook(() => useStatusAnnouncer());
    act(() =>
      result.current.announceBulkOutcome({ action: 'Archived', succeeded: 3, failed: 1 }),
    );
    expect(capture.spoken[0].priority).toBe('assertive');
  });

  it('reports a clean bulk outcome politely', () => {
    const { result } = renderHook(() => useStatusAnnouncer());
    act(() =>
      result.current.announceBulkOutcome({ action: 'Archived', succeeded: 3 }),
    );
    expect(capture.spoken[0].priority).toBe('polite');
  });

  it('defers and coalesces a burst on one channel into a single emit', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStatusAnnouncer());

    // Stream announcements carry a 10 s floor, and each state produces
    // distinct copy — so this exercises the defer path rather than the
    // duplicate path.
    act(() => result.current.announceStreamState('connected', 'Live data'));
    expect(capture.spoken).toHaveLength(1);

    act(() => {
      result.current.announceStreamState('reconnecting', 'Live data');
      result.current.announceStreamState('disconnected', 'Live data');
    });
    // Both landed inside the rate-limit window: nothing extra spoken yet.
    expect(capture.spoken).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    // Exactly one trailing emit, carrying the LAST state — the user is
    // told where the connection ended up, not every step it took.
    expect(capture.spoken).toHaveLength(2);
    expect(capture.spoken[1].message.toLowerCase()).toContain('disconnected');
    expect(capture.spoken[1].priority).toBe('assertive');
  });
});

describe('useLoadAnnouncement', () => {
  let capture: ReturnType<typeof captureAnnouncements>;

  beforeEach(() => {
    __resetAnnouncerForTests();
    __resetAnnouncePolicyForTests();
    __resetStatusAnnouncerForTests();
    capture = captureAnnouncements();
  });

  afterEach(() => {
    capture.stop();
    __resetStatusAnnouncerForTests();
  });

  it('stays silent while still loading', () => {
    renderHook(() =>
      useLoadAnnouncement({ label: 'Drives', isLoading: true, count: undefined }),
    );
    expect(capture.spoken).toHaveLength(0);
  });

  it('announces once on the loading \u2192 settled edge', () => {
    const { rerender } = renderHook(
      ({ isLoading }) => useLoadAnnouncement({ label: 'Drives', isLoading, count: 5 }),
      { initialProps: { isLoading: true } },
    );
    rerender({ isLoading: false });
    expect(capture.spoken).toHaveLength(1);
  });

  it('never speaks for a background refetch that keeps isLoading false', () => {
    const { rerender } = renderHook(
      ({ count }) =>
        useLoadAnnouncement({ label: 'Drives', isLoading: false, count }),
      { initialProps: { count: 5 } },
    );
    rerender({ count: 6 });
    rerender({ count: 7 });
    expect(capture.spoken).toHaveLength(0);
  });

  it('announces a failed refresh assertively', () => {
    const { rerender } = renderHook(
      ({ isLoading }) =>
        useLoadAnnouncement({ label: 'Drives', isLoading, isError: true }),
      { initialProps: { isLoading: true } },
    );
    rerender({ isLoading: false });
    expect(capture.spoken[0].priority).toBe('assertive');
  });

  it('respects enabled={false}', () => {
    const { rerender } = renderHook(
      ({ isLoading }) =>
        useLoadAnnouncement({
          label: 'Drives',
          isLoading,
          count: 5,
          enabled: false,
        }),
      { initialProps: { isLoading: true } },
    );
    rerender({ isLoading: false });
    expect(capture.spoken).toHaveLength(0);
  });
});
