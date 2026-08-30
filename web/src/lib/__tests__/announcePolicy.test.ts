/**
 * Announcement governance contract (A11Y-06).
 *
 * The decision layer is pure, so every rule that keeps a live region
 * from becoming a metronome is asserted here without React, a DOM live
 * region, or a real clock.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideAnnouncement,
  commitDeferredAnnouncement,
  __resetAnnouncePolicyForTests,
  DEFAULT_DEDUPE_WINDOW_MS,
  DEFAULT_MIN_INTERVAL_MS,
  STREAM_DEDUPE_WINDOW_MS,
  STREAM_MIN_INTERVAL_MS,
} from '@/lib/announcePolicy';

const T0 = 1_000_000;

describe('decideAnnouncement', () => {
  beforeEach(() => {
    __resetAnnouncePolicyForTests();
  });

  it('speaks the first message on a channel', () => {
    expect(decideAnnouncement('Drives loaded', { key: 'loaded:drives' }, T0)).toEqual({
      kind: 'speak',
      delayMs: 0,
      reason: 'new',
    });
  });

  it('drops empty and whitespace-only text', () => {
    expect(decideAnnouncement('   ', { key: 'k' }, T0).kind).toBe('drop');
    expect(decideAnnouncement('', { key: 'k' }, T0).kind).toBe('drop');
  });

  it('drops an identical repeat inside the dedupe window', () => {
    decideAnnouncement('Could not refresh Drives', { key: 'e' }, T0);
    const second = decideAnnouncement(
      'Could not refresh Drives',
      { key: 'e' },
      T0 + DEFAULT_DEDUPE_WINDOW_MS - 1,
    );
    expect(second).toEqual({ kind: 'drop', delayMs: 0, reason: 'duplicate' });
  });

  it('speaks the same text again once the dedupe window has passed', () => {
    decideAnnouncement('Saved', { key: 's' }, T0);
    const again = decideAnnouncement(
      'Saved',
      { key: 's' },
      T0 + DEFAULT_DEDUPE_WINDOW_MS + 1,
    );
    expect(again.kind).toBe('speak');
  });

  it('checks duplicates before the rate limit', () => {
    decideAnnouncement('Same', { key: 'k' }, T0);
    // Inside BOTH windows: duplicate wins, so the caller drops rather
    // than queueing a pointless trailing emit.
    expect(decideAnnouncement('Same', { key: 'k' }, T0 + 10).reason).toBe('duplicate');
  });

  it('defers new text that arrives inside the minimum interval', () => {
    decideAnnouncement('First', { key: 'k' }, T0);
    const decision = decideAnnouncement('Second', { key: 'k' }, T0 + 200);
    expect(decision.kind).toBe('defer');
    expect(decision.reason).toBe('rate-limited');
    expect(decision.delayMs).toBe(DEFAULT_MIN_INTERVAL_MS - 200);
  });

  it('isolates governance per channel', () => {
    decideAnnouncement('Telemetry updated', { key: 'stream:live' }, T0);
    // A noisy stream must never throttle a save confirmation.
    expect(
      decideAnnouncement('Settings saved', { key: 'saved:settings' }, T0 + 1).kind,
    ).toBe('speak');
  });

  it('honours per-call window overrides for stream channels', () => {
    decideAnnouncement(
      'Live data connected',
      {
        key: 'stream:live',
        minIntervalMs: STREAM_MIN_INTERVAL_MS,
        dedupeWindowMs: STREAM_DEDUPE_WINDOW_MS,
      },
      T0,
    );
    const soon = decideAnnouncement(
      'Live data reconnecting',
      {
        key: 'stream:live',
        minIntervalMs: STREAM_MIN_INTERVAL_MS,
        dedupeWindowMs: STREAM_DEDUPE_WINDOW_MS,
      },
      T0 + 5_000,
    );
    expect(soon.kind).toBe('defer');
    expect(soon.delayMs).toBe(STREAM_MIN_INTERVAL_MS - 5_000);
  });

  it('treats a committed deferred emit as the channel\u2019s latest speech', () => {
    decideAnnouncement('First', { key: 'k' }, T0);
    commitDeferredAnnouncement('k', 'Final value', T0 + 1_000);
    // Re-announcing the committed text inside the dedupe window drops.
    expect(decideAnnouncement('Final value', { key: 'k' }, T0 + 1_100).kind).toBe(
      'drop',
    );
    // And the rate-limit clock restarted at the commit time.
    expect(decideAnnouncement('Newer value', { key: 'k' }, T0 + 1_100).kind).toBe(
      'defer',
    );
  });

  it('resets cleanly between tests', () => {
    decideAnnouncement('Once', { key: 'k' }, T0);
    __resetAnnouncePolicyForTests();
    expect(decideAnnouncement('Once', { key: 'k' }, T0).kind).toBe('speak');
  });
});
