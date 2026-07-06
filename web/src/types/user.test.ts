/**
 * user — contract tests for the authenticated-user wire type + its
 * fetch-boundary shape guard.
 *
 * The module used to be *type-only* (the `User` interface erased at runtime).
 * It now also owns the runtime contract for validating an untrusted
 * `/users/me` payload — so, following the repo convention for type modules
 * (see types/export.test.ts and types/admin-diagnostics.test.ts), this suite
 * locks the contract on two levels:
 *
 *   • Runtime (`expect`)      — `isUser` accepts a full and a minimal
 *     (avatar-less) user, rejects a payload missing any required field or
 *     carrying a wrong primitive type (required OR optional), and rejects
 *     null / primitives / arrays without peeking into containers.
 *   • Compile-time (`expectTypeOf`) — the interface keeps its six documented
 *     fields with the right optionality (mirroring the Go `domain/user.User`
 *     camelCase JSON tags), and `isUser` narrows `unknown` to `User` inside
 *     the guarded branch. Runtime no-ops enforced by tsc / vitest.
 *
 * No network, no DOM — pure structural + guard assertions, so no MSW/Query
 * harness is needed.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';

import { isUser } from './user';
import type { User } from './user';

/** A fully-populated user — the optional `avatarUrl` present. */
const VALID_FULL: Record<string, unknown> = {
  id: 'u-1',
  email: 'driver@example.com',
  displayName: 'Nikola',
  avatarUrl: 'https://cdn.example.com/a/u-1.png',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-02T00:00:00Z',
};

/** The minimal valid user — every required field, `avatarUrl` absent. */
const VALID_MINIMAL: Record<string, unknown> = {
  id: 'u-2',
  email: 'owner@example.com',
  displayName: 'Ada',
  createdAt: '2025-02-01T00:00:00Z',
  updatedAt: '2025-02-02T00:00:00Z',
};

const REQUIRED_FIELDS = ['id', 'email', 'displayName', 'createdAt', 'updatedAt'] as const;

// Every non-object value a shape guard must reject. Includes an array whose
// element is a valid user — the guard must reject the container, never inspect
// inside it.
const NON_OBJECTS: unknown[] = [
  null,
  undefined,
  0,
  1,
  NaN,
  '',
  'u-1',
  true,
  false,
  [],
  [VALID_FULL],
];

// ── User — the wire shape ─────────────────────────────────────────────────────

describe('User wire shape', () => {
  it('accepts a fully-populated user assignable without a cast', () => {
    const user: User = {
      id: 'u-1',
      email: 'driver@example.com',
      displayName: 'Nikola',
      avatarUrl: 'https://cdn.example.com/a/u-1.png',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-02T00:00:00Z',
    };

    expect(Object.keys(user).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'displayName',
      'email',
      'id',
      'updatedAt',
    ]);
    expect(user.displayName).toBe('Nikola');
    expect(user.avatarUrl).toBe('https://cdn.example.com/a/u-1.png');
  });

  it('accepts a minimal user with the optional avatarUrl absent', () => {
    const user: User = {
      id: 'u-2',
      email: 'owner@example.com',
      displayName: 'Ada',
      createdAt: '2025-02-01T00:00:00Z',
      updatedAt: '2025-02-02T00:00:00Z',
    };

    expect(user.avatarUrl).toBeUndefined();
    expect(user.id).toBe('u-2');
  });

  it('mirrors the Go domain/user.User camelCase JSON tags', () => {
    expectTypeOf<User['id']>().toEqualTypeOf<string>();
    expectTypeOf<User['email']>().toEqualTypeOf<string>();
    expectTypeOf<User['displayName']>().toEqualTypeOf<string>();
    expectTypeOf<User['createdAt']>().toEqualTypeOf<string>();
    expectTypeOf<User['updatedAt']>().toEqualTypeOf<string>();
    // avatarUrl is `omitempty` on the Go side → optional here.
    expectTypeOf<User['avatarUrl']>().toEqualTypeOf<string | undefined>();
  });
});

// ── isUser — the fetch-boundary shape guard ───────────────────────────────────

describe('isUser', () => {
  it('accepts a fully-populated and a minimal valid user', () => {
    expect(isUser(VALID_FULL)).toBe(true);
    expect(isUser(VALID_MINIMAL)).toBe(true);
  });

  it('rejects a user missing any required field', () => {
    for (const field of REQUIRED_FIELDS) {
      const bad = { ...VALID_FULL };
      delete bad[field];
      expect(isUser(bad), `missing ${field} should be rejected`).toBe(false);
    }
  });

  it('rejects a wrong primitive type on a required field', () => {
    expect(isUser({ ...VALID_MINIMAL, id: 123 })).toBe(false);
    expect(isUser({ ...VALID_MINIMAL, email: null })).toBe(false);
    expect(isUser({ ...VALID_MINIMAL, displayName: 0 })).toBe(false);
    expect(isUser({ ...VALID_MINIMAL, createdAt: false })).toBe(false);
    expect(isUser({ ...VALID_MINIMAL, updatedAt: 42 })).toBe(false);
  });

  it('rejects a non-string avatarUrl but accepts it absent, undefined, or a string', () => {
    // The backend omits the field entirely (never null) when unset.
    expect(isUser({ ...VALID_MINIMAL, avatarUrl: 5 })).toBe(false);
    expect(isUser({ ...VALID_MINIMAL, avatarUrl: null })).toBe(false);
    expect(isUser({ ...VALID_MINIMAL, avatarUrl: undefined })).toBe(true);
    expect(isUser({ ...VALID_MINIMAL, avatarUrl: 'https://x/y.png' })).toBe(true);
  });

  it('rejects null, primitives, and arrays (including an array of valid users)', () => {
    for (const value of NON_OBJECTS) {
      expect(isUser(value)).toBe(false);
    }
  });

  it('narrows an untrusted payload to User inside the guarded branch', () => {
    const raw: unknown = VALID_FULL;
    if (!isUser(raw)) throw new Error('guard should have accepted VALID_FULL');
    // Compile-time: inside the branch `raw` is the narrowed interface.
    expectTypeOf(raw).toEqualTypeOf<User>();
    // Runtime: the narrowed value exposes the trusted fields.
    expect(raw.id).toBe('u-1');
    expect(raw.email).toBe('driver@example.com');
    expect(raw.avatarUrl).toBe('https://cdn.example.com/a/u-1.png');
  });
});
