/**
 * AnnouncerRegion contract.
 *
 * `<AnnouncerRegion>` is the single global mount point for the app's
 * imperative screen-reader announcements. It renders two visually-hidden
 * live regions — one `polite`, one `assertive` — and subscribes to the
 * module-level announcer bus (`@/hooks/useAnnouncer`). These tests lock in
 * the behaviours the rest of the app relies on:
 *
 *   1. The live-region ARIA contract (role / aria-live / aria-atomic) for
 *      BOTH priorities — a single missing attribute silently breaks SR
 *      announcements.
 *   2. Priority routing — polite messages land in the polite region ONLY
 *      and vice versa, and the two regions never clobber each other.
 *   3. The subscribe-on-mount / unsubscribe-on-unmount lifecycle, so a
 *      remounted layout never leaks duplicate listeners.
 *   4. The de-dup rotation that lets an identical message be re-announced
 *      (screen readers skip live-region updates whose text is unchanged).
 *   5. Defensive edges — empty announcements stay silent and firing before
 *      the region mounts is a no-op, not a crash.
 *
 * Announcements are driven through the public `announce()` API — exactly
 * how production call-sites reach the region — rather than by poking the
 * component's internals.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AnnouncerRegion } from '../AnnouncerRegion';
import {
  announce,
  __resetAnnouncerForTests,
  __getAnnouncerListenerCountForTests,
} from '@/hooks/useAnnouncer';

/**
 * The announcer bus is module-level state; without a reset each test would
 * inherit the previous test's subscribers and de-dup counter. Reset before
 * AND after so a failing test can't poison a neighbour.
 */
beforeEach(() => {
  __resetAnnouncerForTests();
});
afterEach(() => {
  __resetAnnouncerForTests();
});

/**
 * Announcements carry a rotating zero-width-space (U+200B) suffix so
 * identical consecutive messages still register as a text change. Strip it
 * when asserting on the human-visible content.
 */
const strip = (value: string | null | undefined) =>
  (value ?? '').replace(/\u200B/g, '');

describe('AnnouncerRegion', () => {
  it('mounts both live regions with the full ARIA triplet per priority', () => {
    render(<AnnouncerRegion />);
    const polite = screen.getByTestId('announcer-polite');
    const assertive = screen.getByTestId('announcer-assertive');

    expect(polite).toHaveAttribute('role', 'status');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(polite).toHaveAttribute('aria-atomic', 'true');

    expect(assertive).toHaveAttribute('role', 'alert');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    expect(assertive).toHaveAttribute('aria-atomic', 'true');
  });

  it('exposes the two regions via their ARIA roles (status + alert)', () => {
    render(<AnnouncerRegion />);
    // role="status" resolves to the polite region, role="alert" to the
    // assertive one — the identity check guards against the two regions
    // being accidentally swapped.
    expect(screen.getByRole('status')).toBe(
      screen.getByTestId('announcer-polite'),
    );
    expect(screen.getByRole('alert')).toBe(
      screen.getByTestId('announcer-assertive'),
    );
  });

  it('renders both regions empty before any announcement', () => {
    render(<AnnouncerRegion />);
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe('');
    expect(strip(screen.getByTestId('announcer-assertive').textContent)).toBe(
      '',
    );
  });

  it('subscribes exactly one listener while mounted and cleans up on unmount', () => {
    expect(__getAnnouncerListenerCountForTests()).toBe(0);
    const { unmount } = render(<AnnouncerRegion />);
    expect(__getAnnouncerListenerCountForTests()).toBe(1);
    unmount();
    expect(__getAnnouncerListenerCountForTests()).toBe(0);
  });

  it('routes a polite announcement to the polite region only', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('Filter removed', 'polite');
    });
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe(
      'Filter removed',
    );
    // The assertive region must stay silent so a routine confirmation never
    // interrupts whatever the AT is currently reading.
    expect(strip(screen.getByTestId('announcer-assertive').textContent)).toBe(
      '',
    );
  });

  it('routes an assertive announcement to the assertive region only', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('Session expired', 'assertive');
    });
    expect(strip(screen.getByTestId('announcer-assertive').textContent)).toBe(
      'Session expired',
    );
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe('');
  });

  it('defaults to the polite region when no priority is supplied', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('Saved view applied');
    });
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe(
      'Saved view applied',
    );
    expect(strip(screen.getByTestId('announcer-assertive').textContent)).toBe(
      '',
    );
  });

  it('keeps the polite and assertive regions independent', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('3 items archived', 'polite');
    });
    act(() => {
      announce('Upload failed', 'assertive');
    });
    // Writing to one priority must never overwrite the other region's text.
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe(
      '3 items archived',
    );
    expect(strip(screen.getByTestId('announcer-assertive').textContent)).toBe(
      'Upload failed',
    );
  });

  it('replaces the previous message in a region with the latest one', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('First', 'polite');
    });
    act(() => {
      announce('Second', 'polite');
    });
    // A live region only speaks its current content; the newest message wins.
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe(
      'Second',
    );
  });

  it('produces a distinct string when the same message is announced twice', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('Selection cleared', 'polite');
    });
    const first = screen.getByTestId('announcer-polite').textContent ?? '';
    act(() => {
      announce('Selection cleared', 'polite');
    });
    const second = screen.getByTestId('announcer-polite').textContent ?? '';

    // To a human both announcements read identically...
    expect(strip(first)).toBe('Selection cleared');
    expect(strip(second)).toBe('Selection cleared');
    // ...but the raw text content must change so the screen reader re-reads
    // it — otherwise re-running the same action is silent the second time.
    expect(second).not.toBe(first);
  });

  it('ignores empty announcements so the regions stay silent', () => {
    render(<AnnouncerRegion />);
    act(() => {
      announce('', 'polite');
      announce('', 'assertive');
    });
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe('');
    expect(strip(screen.getByTestId('announcer-assertive').textContent)).toBe(
      '',
    );
  });

  it('drops announcements fired before mount and delivers those fired after', () => {
    // No region is mounted yet — firing must be a silent no-op, never a
    // throw (call-sites announce from effects that may run pre-Layout).
    expect(() => announce('too early', 'polite')).not.toThrow();

    render(<AnnouncerRegion />);
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe('');

    act(() => {
      announce('now live', 'polite');
    });
    expect(strip(screen.getByTestId('announcer-polite').textContent)).toBe(
      'now live',
    );
  });

  it('unmounts cleanly and stops receiving announcements', () => {
    const { unmount } = render(<AnnouncerRegion />);
    unmount();
    // With no subscribers left, a post-unmount announce must not throw
    // (e.g. an in-flight async callback firing after the layout tears down).
    expect(__getAnnouncerListenerCountForTests()).toBe(0);
    expect(() => announce('after unmount', 'assertive')).not.toThrow();
  });
});
