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
 * Map a raw health-summary status ('normal' | 'warning' | 'critical') onto the
 * canonical {@link Severity} union so status chips get color-independent
 * icon + tone from `severityTokens`. 'normal' surfaces as `success` (green +
 * check) rather than the neutral `info` that `normalizeSeverity('normal')`
 * would otherwise return.
 */
export function healthSeverity(status: string): Severity {
  if (status === 'critical') return 'critical';
  if (status === 'warning') return 'warn';
  return 'success';
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
