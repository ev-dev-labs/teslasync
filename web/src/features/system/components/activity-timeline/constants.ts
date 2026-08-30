import type { ComponentType } from 'react';
import { Icons } from '@/lib/icons';
import type { BadgeProps } from '@/components/ui';
import type { ActivityKind } from '@/types/activity';

/** Icon shown in the timeline dot for each activity domain. */
export const KIND_ICON: Record<ActivityKind, ComponentType<{ className?: string }>> = {
  drive: Icons.drive,
  charging: Icons.batteryCharging,
  alert: Icons.notifications,
  software_update: Icons.download,
  annotation: Icons.flag,
};

/** Hex accent fed to `TimelineItem`'s `color` prop — one per domain. */
export const KIND_ACCENT: Record<ActivityKind, string> = {
  drive: '#22d3ee',
  charging: '#34d399',
  alert: '#f59e0b',
  software_update: '#818cf8',
  annotation: '#c084fc',
};

/** Maps an alert's `severity` to a `Badge` variant. */
export function severityBadgeVariant(severity?: string | null): BadgeProps['variant'] {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warn':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Maps a domain-specific `status` string to a `Badge` variant. */
export function statusBadgeVariant(status: string): BadgeProps['variant'] {
  switch (status) {
    case 'completed':
    case 'installed':
    case 'sent':
      return 'success';
    case 'in_progress':
    case 'installing':
    case 'downloading':
    case 'pending':
      return 'info';
    case 'failed':
      return 'danger';
    case 'deferred_dnd':
    case 'available':
      return 'warning';
    default:
      return 'neutral';
  }
}
