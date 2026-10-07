import { Shield, ShieldAlert, Crown, Key, type LucideIcon } from 'lucide-react';
import type { NeonColor } from '@/lib/tokens';
import type { APIKey } from '@/types/admin';

/** Permission level rendered by the badge, access-levels panel, and create form. */
export type ApiKeyPermission = APIKey['permissions'];

export interface PermissionMeta {
  icon: LucideIcon;
  color: NeonColor;
  /** Hex used by `<MetricBar>` (a shared component that needs a color value,
   *  mirroring the reference `TimelinePage` STATE_COLORS pattern). Matches the
   *  neon hue of `color` above. */
  barColor: string;
  /** i18n key + English fallback for the short chip label. */
  labelKey: string;
  labelFallback: string;
  /** i18n key + English fallback for the one-line access description. */
  descKey: string;
  descFallback: string;
}

/**
 * Single source of truth for how each permission level is presented.
 * Colors resolve through `neonColorMap` (toned 300-level text on neon-tinted
 * chips) so nothing here uses ad-hoc hex or inline styles.
 */
export const PERMISSION_META: Record<ApiKeyPermission, PermissionMeta> = {
  read: {
    icon: Shield,
    color: 'green',
    barColor: '#10b981',
    labelKey: 'apiKeys.perm.read',
    labelFallback: 'Read',
    descKey: 'apiKeys.perm.readDesc',
    descFallback: 'Read-only access to fleet data.',
  },
  'read-write': {
    icon: ShieldAlert,
    color: 'amber',
    barColor: '#f59e0b',
    labelKey: 'apiKeys.perm.readWrite',
    labelFallback: 'Read-Write',
    descKey: 'apiKeys.perm.readWriteDesc',
    descFallback: 'Read data and send vehicle commands.',
  },
  admin: {
    icon: Crown,
    color: 'purple',
    barColor: '#a855f7',
    labelKey: 'apiKeys.perm.admin',
    labelFallback: 'Admin',
    descKey: 'apiKeys.perm.adminDesc',
    descFallback: 'Full administrative access to every resource.',
  },
};

/** Fallback used when the API returns an unrecognised permission string. */
export const FALLBACK_PERMISSION_META: PermissionMeta = PERMISSION_META.read;

/** Ordered list of permission levels for the create form + access-levels panel. */
export const PERMISSION_ORDER: ApiKeyPermission[] = ['read', 'read-write', 'admin'];

/** Icon for the key card + empty state — kept here so the barrel stays lean. */
export const KEY_ICON: LucideIcon = Key;

/**
 * Resolve an API-supplied permission string to its presentation metadata,
 * falling back to {@link FALLBACK_PERMISSION_META} for anything unrecognised.
 *
 * `PERMISSION_META` is a plain object literal, so it inherits every
 * `Object.prototype` member (`constructor`, `toString`, `hasOwnProperty`,
 * `valueOf`, `__proto__`, …). A bare `PERMISSION_META[perm] ?? FALLBACK`
 * would resolve those inherited functions for a permission that happens to
 * share one of those names — returning e.g. the `Object` constructor
 * masquerading as a `PermissionMeta`, whose `.icon`/`.color` are `undefined`
 * and crash `<ApiKeyPermissionBadge>` (React renders `<undefined />` and
 * `neonColorMap[undefined]` throws). Restricting the lookup to the record's
 * OWN keys makes such strings fall through to the safe fallback like any
 * other unrecognised value, honouring this function's documented contract.
 */
export function permissionMeta(perm: string): PermissionMeta {
  return Object.prototype.hasOwnProperty.call(PERMISSION_META, perm)
    ? PERMISSION_META[perm as ApiKeyPermission]
    : FALLBACK_PERMISSION_META;
}
