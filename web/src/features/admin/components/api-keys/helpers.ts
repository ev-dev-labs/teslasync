import type { APIKey } from '@/types/admin';
import { PERMISSION_ORDER, type ApiKeyPermission } from './constants';

/** A key is expired when it has an `expiresAt` that is already in the past. */
export function isKeyExpired(key: APIKey, now: number = Date.now()): boolean {
  if (!key.expiresAt) return false;
  const ts = new Date(key.expiresAt).getTime();
  return Number.isFinite(ts) && ts < now;
}

/** A key counts as "recently used" if it was used within the given window. */
export function isRecentlyUsed(
  key: APIKey,
  windowMs: number = 7 * 24 * 60 * 60 * 1000,
  now: number = Date.now(),
): boolean {
  if (!key.lastUsedAt) return false;
  const ts = new Date(key.lastUsedAt).getTime();
  return Number.isFinite(ts) && now - ts <= windowMs;
}

export interface ApiKeysSummary {
  total: number;
  active: number;
  expired: number;
  admin: number;
  recentlyUsed: number;
  /** Count of keys per permission level, in `PERMISSION_ORDER`. */
  byPermission: Record<ApiKeyPermission, number>;
}

/**
 * Derive all headline counts from the key list in a single pass so the KPI
 * band, access-levels panel, and admin highlight stay consistent.
 */
export function summarizeKeys(keys: readonly APIKey[], now: number = Date.now()): ApiKeysSummary {
  const list = keys ?? [];
  const byPermission = PERMISSION_ORDER.reduce(
    (acc, perm) => ({ ...acc, [perm]: 0 }),
    {} as Record<ApiKeyPermission, number>,
  );

  let active = 0;
  let expired = 0;
  let admin = 0;
  let recentlyUsed = 0;

  for (const key of list) {
    if (isKeyExpired(key, now)) expired += 1;
    else active += 1;
    if (key.permissions === 'admin') admin += 1;
    if (isRecentlyUsed(key, undefined, now)) recentlyUsed += 1;
    // `hasOwnProperty.call` (not the `in` operator) so a malformed API value
    // like `permissions: "toString"` can't match an inherited Object.prototype
    // member and corrupt the per-permission tally.
    if (Object.prototype.hasOwnProperty.call(byPermission, key.permissions)) {
      byPermission[key.permissions as ApiKeyPermission] += 1;
    }
  }

  return { total: list.length, active, expired, admin, recentlyUsed, byPermission };
}
