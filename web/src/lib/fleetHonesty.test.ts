import { describe, expect, it } from 'vitest';

import { honestyFromLiveConnection, tallyHonesty } from './fleetHonesty';

describe('fleetHonesty', () => {
  it('maps posture onto live/stale/guessed/missing', () => {
    expect(tallyHonesty(['reporting', 'stale', 'unverified', 'offline', 'failed'])).toEqual({
      live: 1,
      stale: 1,
      guessed: 1,
      missing: 2,
    });
  });

  it('maps the SSE pipe the same way', () => {
    expect(honestyFromLiveConnection('connected', false)).toBe('live');
    expect(honestyFromLiveConnection('connected', true)).toBe('stale');
    expect(honestyFromLiveConnection('reconnecting', false)).toBe('guessed');
    expect(honestyFromLiveConnection('disconnected', false)).toBe('missing');
  });
});
