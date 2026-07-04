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

export function permissionMeta(perm: string): PermissionMeta {
  return PERMISSION_META[perm as ApiKeyPermission] ?? FALLBACK_PERMISSION_META;
}
