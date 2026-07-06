import { describe, it, expect } from 'vitest';
import type { APIKey } from '@/types/admin';
import { PERMISSION_ORDER } from './constants';
import { isKeyExpired, isRecentlyUsed, summarizeKeys } from './helpers';

// ---------------------------------------------------------------------------
// api-keys/helpers hardening
//
// These pure derivations feed the API-keys KPI band, access-levels panel, and
// admin highlight. Every branch is pinned against a fixed `now` so the suite is
// deterministic, and the tally is pinned against malformed API data — the
// backend serializes `permissions` as a free string, so a value like
// `"toString"` must NOT match an inherited Object.prototype member and corrupt
// the per-permission counts.
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0); // fixed clock for every assertion
const DAY = 24 * 60 * 60 * 1000;

function makeKey(overrides: Partial<APIKey> = {}): APIKey {
  return {
    id: 'k1',
    name: 'CI token',
    keyPrefix: 'tsk_abc',
    permissions: 'read',
    createdAt: new Date(NOW - 30 * DAY).toISOString(),
    lastUsedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe('isKeyExpired', () => {
  it('treats a key without an expiry as never expired', () => {
    expect(isKeyExpired(makeKey({ expiresAt: null }), NOW)).toBe(false);
  });

  it('is expired when expiresAt is strictly in the past', () => {
    const key = makeKey({ expiresAt: new Date(NOW - DAY).toISOString() });
    expect(isKeyExpired(key, NOW)).toBe(true);
  });

  it('is not expired when expiresAt is in the future', () => {
    const key = makeKey({ expiresAt: new Date(NOW + DAY).toISOString() });
    expect(isKeyExpired(key, NOW)).toBe(false);
  });

  it('treats an expiry exactly equal to now as not-yet-expired (strict <)', () => {
    const key = makeKey({ expiresAt: new Date(NOW).toISOString() });
    expect(isKeyExpired(key, NOW)).toBe(false);
  });

  it('never throws and returns false on an unparseable expiry string', () => {
    const key = makeKey({ expiresAt: 'not-a-date' });
    expect(isKeyExpired(key, NOW)).toBe(false);
  });

  it('defaults `now` to the real clock — a past expiry is still expired', () => {
    const key = makeKey({ expiresAt: new Date(1000).toISOString() });
    expect(isKeyExpired(key)).toBe(true);
  });
});

describe('isRecentlyUsed', () => {
  it('is false when the key has never been used', () => {
    expect(isRecentlyUsed(makeKey({ lastUsedAt: null }), undefined, NOW)).toBe(false);
  });

  it('is true within the default 7-day window', () => {
    const key = makeKey({ lastUsedAt: new Date(NOW - 2 * DAY).toISOString() });
    expect(isRecentlyUsed(key, undefined, NOW)).toBe(true);
  });

  it('is false once usage falls outside the default 7-day window', () => {
    const key = makeKey({ lastUsedAt: new Date(NOW - 8 * DAY).toISOString() });
    expect(isRecentlyUsed(key, undefined, NOW)).toBe(false);
  });

  it('respects a custom window (inclusive at the boundary)', () => {
    const key = makeKey({ lastUsedAt: new Date(NOW - DAY).toISOString() });
    expect(isRecentlyUsed(key, DAY, NOW)).toBe(true);
    expect(isRecentlyUsed(key, DAY - 1, NOW)).toBe(false);
  });

  it('never throws and returns false on an unparseable lastUsedAt string', () => {
    const key = makeKey({ lastUsedAt: 'garbage' });
    expect(isRecentlyUsed(key, undefined, NOW)).toBe(false);
  });

  it('counts a future usage timestamp as recently used', () => {
    const key = makeKey({ lastUsedAt: new Date(NOW + DAY).toISOString() });
    expect(isRecentlyUsed(key, undefined, NOW)).toBe(true);
  });
});

describe('summarizeKeys', () => {
  it('returns a fully zeroed summary for an empty list', () => {
    const summary = summarizeKeys([], NOW);
    expect(summary).toEqual({
      total: 0,
      active: 0,
      expired: 0,
      admin: 0,
      recentlyUsed: 0,
      byPermission: { read: 0, 'read-write': 0, admin: 0 },
    });
  });

  it('derives every headline count in a single consistent pass', () => {
    const keys: APIKey[] = [
      makeKey({ id: 'a', permissions: 'read', lastUsedAt: new Date(NOW - DAY).toISOString() }),
      makeKey({ id: 'b', permissions: 'read-write', expiresAt: new Date(NOW - DAY).toISOString() }),
      makeKey({ id: 'c', permissions: 'admin', expiresAt: new Date(NOW + DAY).toISOString() }),
      makeKey({ id: 'd', permissions: 'admin', lastUsedAt: new Date(NOW - 30 * DAY).toISOString() }),
    ];

    const summary = summarizeKeys(keys, NOW);

    expect(summary.total).toBe(4);
    expect(summary.expired).toBe(1); // only key "b"
    expect(summary.active).toBe(3); // total - expired, keys without expiry count active
    expect(summary.admin).toBe(2); // keys "c" and "d"
    expect(summary.recentlyUsed).toBe(1); // only key "a" within 7 days
    expect(summary.byPermission).toEqual({ read: 1, 'read-write': 1, admin: 2 });
  });

  it('keeps active + expired equal to the total count', () => {
    const keys: APIKey[] = [
      makeKey({ id: 'a', expiresAt: new Date(NOW - DAY).toISOString() }),
      makeKey({ id: 'b', expiresAt: new Date(NOW + DAY).toISOString() }),
      makeKey({ id: 'c', expiresAt: null }),
    ];
    const summary = summarizeKeys(keys, NOW);
    expect(summary.active + summary.expired).toBe(summary.total);
  });

  it('does not let a malformed permission corrupt the per-permission tally', () => {
    // Regression pin: the `in` operator would match inherited `toString`
    // and mutate byPermission into `"function toString(){…}1"`.
    const rogue = { ...makeKey({ id: 'x' }), permissions: 'toString' } as unknown as APIKey;
    const summary = summarizeKeys([rogue, makeKey({ id: 'y', permissions: 'read' })], NOW);

    expect(summary.byPermission).toEqual({ read: 1, 'read-write': 0, admin: 0 });
    expect(Object.keys(summary.byPermission).sort()).toEqual([...PERMISSION_ORDER].sort());
    expect(summary.total).toBe(2); // the rogue key still counts toward the total
  });

  it('ignores other inherited-member permission strings without throwing', () => {
    const rogue = { ...makeKey(), permissions: 'hasOwnProperty' } as unknown as APIKey;
    const summary = summarizeKeys([rogue], NOW);
    expect(summary.byPermission).toEqual({ read: 0, 'read-write': 0, admin: 0 });
    expect(summary.admin).toBe(0);
  });

  it('is null-safe when handed a nullish list', () => {
    const summary = summarizeKeys(undefined as unknown as APIKey[], NOW);
    expect(summary.total).toBe(0);
    expect(summary.byPermission).toEqual({ read: 0, 'read-write': 0, admin: 0 });
  });
});
