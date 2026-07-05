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
 * The backend seeds every category to `'normal'` and only ever upgrades it to
 * one of the anomaly severities — `'info' | 'warning' | 'critical'` — as it
 * folds detected anomalies into each category (see
 * `internal/api/anomaly/handler.go`). So the real status domain is
 * `'normal' | 'info' | 'warning' | 'critical'`:
 *   - `'normal'`   → `success` (green + check): the ONLY "all healthy" state.
 *   - `'warning'`  → `warn`.
 *   - `'critical'` → `critical`.
 *   - `'info'`     → `info`: an info-level anomaly is present, so the category
 *     must NOT masquerade as a green success.
 *
 * Any unrecognized status falls back to the neutral `info` tone rather than a
 * misleading green `success` — an unknown state is not a healthy one.
 */
export function healthSeverity(status: string): Severity {
  if (status === 'critical') return 'critical';
  if (status === 'warning') return 'warn';
  if (status === 'normal') return 'success';
  return 'info';
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
