import { Activity, Battery, Car, Shield, Wind, Zap, type LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Severity } from '@/lib/tokens';

/**
 * Per-category icon used by the System Health panel. Keys mirror the five
 * canonical health categories the backend seeds
 * (battery, tires, motors, hvac, charging). `Shield` is the safe fallback for
 * any future category the API may add before the frontend knows about it.
 */
export const HEALTH_ICONS: Record<string, LucideIcon> = {
  battery: Battery,
  tires: Car,
  motors: Zap,
  hvac: Wind,
  charging: Activity,
};

/** Safe fallback icon for an unknown health category. */
export const HEALTH_FALLBACK_ICON = Shield;

/**
 * Map a raw health-summary status onto the canonical {@link Severity} union so
 * status chips get a color-independent icon + tone from `severityTokens`.
 *
 * The backend emits one of 'normal' | 'info' | 'warning' | 'critical' per
 * category (a category inherits the severity of its worst anomaly, and an
 * info-level anomaly out-ranks the seeded 'normal' — see severityOrder in
 * internal/api/anomaly/handler.go). 'normal' surfaces as `success` (green +
 * check); everything else that is not a warning/critical — including 'info'
 * and any status the frontend does not yet recognize, plus a missing/null
 * value — maps to the neutral `info` tone. It must never fall through to a
 * green `success`, which would let an unknown or info-level state masquerade
 * as an all-clear "healthy".
 */
export function healthSeverity(status: string | null | undefined): Severity {
  switch (status) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'warn';
    case 'normal':
      return 'success';
    default:
      return 'info';
  }
}

/** Human-readable label for an anomaly detector type, i18n-aware. */
export function anomalyTypeLabel(t: TFunction, type: string): string {
  switch (type) {
    case 'z_score':
      return t('anomaly.type.z_score', 'Statistical');
    case 'range':
      return t('anomaly.type.range', 'Range');
    case 'trend':
      return t('anomaly.type.trend', 'Trend');
    default:
      return type;
  }
}
