/**
 * Verified request identity and the independent full-profile compatibility shape.
 * GET /users/me returns only {@link VerifiedUserIdentity}; profile attributes
 * are managed by the external authentication provider.
 */

/**
 * Full profile shape, not the verified-identity response from GET /users/me.
 *
 * `avatarUrl` is optional — the backend omits it (never sends `null`) when the
 * user has no avatar; every other field is always present. Validate an
 * untrusted payload with {@link isUser} before trusting it.
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/** Verified identity returned by GET /users/me; provider profile attributes are not invented. */
export interface VerifiedUserIdentity {
  id: string;
}

/**
 * Validates that an untrusted value is structurally a {@link User}: the five
 * required string fields are present and `avatarUrl`, when present, is a string.
 * This validates full profiles, not the identity-only GET /users/me payload.
 * Rejects `null`, primitives, and arrays without peeking inside.
 */
export function isUser(value: unknown): value is User {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const u = value as Record<string, unknown>;
  if (typeof u.id !== 'string') return false;
  if (typeof u.email !== 'string') return false;
  if (typeof u.displayName !== 'string') return false;
  if (typeof u.createdAt !== 'string') return false;
  if (typeof u.updatedAt !== 'string') return false;
  if (u.avatarUrl !== undefined && typeof u.avatarUrl !== 'string') return false;
  return true;
}
