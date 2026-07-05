/**
 * Shared status metadata for the Software Updates feature.
 *
 * Single source of truth for the per-status colour, icon, badge variant, and
 * i18n label used by both the update timeline cards and the status-breakdown
 * panel. Colours map onto the shared `neonColorMap` tokens (toned 300-level
 * text + neon chip backgrounds) so the surface stays consistent with the rest
 * of the app; the `hex` value feeds the dynamic <MetricBar> gradient which
 * needs a raw colour.
 */

import type { LucideIcon } from 'lucide-react';
import { CheckCircle, Download, ArrowUpCircle, Clock } from 'lucide-react';

import type { NeonColor } from '@/lib/tokens';
import type { BadgeProps } from '@/components/ui';

export type UpdateStatusKey =
  | 'installed'
  | 'installing'
  | 'downloading'
  | 'available'
  | 'scheduled';

export interface UpdateStatusMeta {
  /** Shared neon token key — drives chip bg / ring / toned text. */
  color: NeonColor;
  /** Raw hex for the dynamic <MetricBar> gradient. */
  hex: string;
  icon: LucideIcon;
  badgeVariant: NonNullable<BadgeProps['variant']>;
  labelKey: string;
  labelFallback: string;
}

export const UPDATE_STATUS: Record<UpdateStatusKey, UpdateStatusMeta> = {
  installed: {
    color: 'green',
    hex: '#10b981',
    icon: CheckCircle,
    badgeVariant: 'success',
    labelKey: 'softwareUpdates.status.installed',
    labelFallback: 'Installed',
  },
  installing: {
    color: 'cyan',
    hex: '#06b6d4',
    icon: Download,
    badgeVariant: 'info',
    labelKey: 'softwareUpdates.status.installing',
    labelFallback: 'Installing',
  },
  downloading: {
    color: 'cyan',
    hex: '#22d3ee',
    icon: Download,
    badgeVariant: 'info',
    labelKey: 'softwareUpdates.status.downloading',
    labelFallback: 'Downloading',
  },
  available: {
    color: 'amber',
    hex: '#f59e0b',
    icon: ArrowUpCircle,
    badgeVariant: 'warning',
    labelKey: 'softwareUpdates.status.available',
    labelFallback: 'Available',
  },
  scheduled: {
    color: 'blue',
    hex: '#64748b',
    icon: Clock,
    badgeVariant: 'neutral',
    labelKey: 'softwareUpdates.status.scheduled',
    labelFallback: 'Scheduled',
  },
};

/** Stable display order for the status-breakdown panel. */
export const UPDATE_STATUS_ORDER: UpdateStatusKey[] = [
  'installed',
  'installing',
  'downloading',
  'available',
  'scheduled',
];

/**
 * Resolve a wire status string to its metadata, defaulting to `available`.
 *
 * Uses an own-property check instead of a bare `UPDATE_STATUS[key] ?? …`:
 * indexing walks the prototype chain, so a wire status of `constructor`,
 * `toString`, `valueOf`, `hasOwnProperty`, … resolves to an inherited
 * `Object.prototype` member (a truthy function) and slips past the `??`
 * fallback — handing every consumer a `meta` whose icon/color/hex are
 * `undefined` and crashing the timeline-card render.
 */
export function getUpdateStatus(status: string | null | undefined): UpdateStatusMeta {
  const key = status ?? '';
  return Object.prototype.hasOwnProperty.call(UPDATE_STATUS, key)
    ? UPDATE_STATUS[key as UpdateStatusKey]
    : UPDATE_STATUS.available;
}
