import type { ComponentType } from 'react';
import {
  Clock,
  Loader,
  CircleCheck,
  CircleX,
  CalendarX,
  type LucideProps,
} from 'lucide-react';

import type { GDPRArtifactStatus } from '@/types/admin-operator-confidence';

/** Badge colour variant per artifact status. */
export const STATUS_VARIANT: Record<
  GDPRArtifactStatus,
  'info' | 'success' | 'danger' | 'warning' | 'neutral'
> = {
  queued: 'info',
  running: 'info',
  complete: 'success',
  failed: 'danger',
  expired: 'warning',
};

/**
 * Leading icon per status so the state is conveyed by shape as well as
 * colour (a11y: status is never colour-only).
 */
export const STATUS_ICON: Record<GDPRArtifactStatus, ComponentType<LucideProps>> = {
  queued: Clock,
  running: Loader,
  complete: CircleCheck,
  failed: CircleX,
  expired: CalendarX,
};

/**
 * Toned hex per status for the lifecycle timeline dots. Dynamic prop
 * values (not static CSS-var inline styles), matching the feedback-queue
 * `STATUS_COLORS` convention so they stay out of the guardian check.
 */
export const STATUS_COLOR: Record<GDPRArtifactStatus, string> = {
  queued: '#22d3ee',
  running: '#22d3ee',
  complete: '#10b981',
  failed: '#f43f5e',
  expired: '#f59e0b',
};
