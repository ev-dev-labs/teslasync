/**
 * user — the authenticated-user wire type + a fetch-boundary shape guard.
 *
 * {@link User} mirrors the Go `domain/user.User` struct returned by
 * `GET /users/me` (camelCase JSON tags: `id`, `email`, `displayName`,
 * `avatarUrl`, `createdAt`, `updatedAt`). The Go side tags `avatarUrl`
 * `omitempty`, so it is *absent* — never `null` — when the user has no avatar;
 * the other five fields are always present. `time.Time` serialises to an
 * RFC3339 string, so `createdAt` / `updatedAt` arrive as `string`.
 *
 * Following the repo convention for type modules (see types/export.ts and
 * types/admin-diagnostics.ts), the module also owns the runtime backbone for
 * validating an untrusted `/users/me` payload at the fetch boundary.
 */

/**
 * The authenticated user, as returned by `GET /users/me`.
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

/**
 * Validates that an untrusted value is structurally a {@link User}: the five
 * required string fields are present and `avatarUrl`, when present, is a string.
 * Intended for the fetch boundary before a `/users/me` payload is trusted.
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
