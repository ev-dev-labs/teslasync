/**
 * Native parity port of
 * web/src/features/driving/components/drivetrain-health/helpers.ts.
 *
 * Pure TypeScript utility logic with no runtime DOM, browser, React, Recharts,
 * Leaflet, or web-UI dependency — every function is platform-agnostic and is
 * ported verbatim so it is fully React Native compatible. These helpers map a
 * drivetrain `HealthStatus` to shared Badge/Alert variants and translate a motor
 * temperature (in Celsius) into severity colors / neon accents / display text.
 *
 * The web source imports `{ HEALTH_COLOR, type HealthStatus }` from the sibling
 * `./constants` module (L1). That module has no native parity port yet in this
 * conversion loop, so — following the established repo pattern for not-yet-ported
 * siblings — the two symbols this file needs are inlined here field-for-field
 * from web/src/features/driving/components/drivetrain-health/constants.ts:
 *   - the `HealthStatus` union `'good' | 'warning' | 'critical'`
 *   - the `HEALTH_COLOR` record (good #10b981 / warning #f59e0b / critical #ef4444)
 * `HealthStatus` is kept local (non-exported) to preserve the web file's exact
 * public surface (it imported, never re-exported, the type).
 */

type HealthStatus = 'good' | 'warning' | 'critical';

const HEALTH_COLOR: Record<HealthStatus, string> = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

export function healthBadgeVariant(
  health: HealthStatus,
): 'success' | 'warning' | 'danger' {
  if (health === 'good') return 'success';
  if (health === 'warning') return 'warning';
  return 'danger';
}

export function getAlertVariant(health: HealthStatus): 'warning' | 'danger' {
  return health === 'warning' ? 'warning' : 'danger';
}

export function tempSeverityColor(celsius: number | null, max: number): string {
  if (celsius === null) return '#6b7280';
  const ratio = celsius / max;
  if (ratio >= 0.85) return HEALTH_COLOR.critical;
  if (ratio >= 0.65) return HEALTH_COLOR.warning;
  return HEALTH_COLOR.good;
}

export function tempNeonColor(
  celsius: number | null,
  max: number,
): 'green' | 'amber' | 'red' {
  if (celsius === null) return 'green';
  const ratio = celsius / max;
  if (ratio >= 0.85) return 'red';
  if (ratio >= 0.65) return 'amber';
  return 'green';
}

export function displayTemp(
  celsius: number | null,
  formatTemperature: (c: number) => string,
): string {
  if (celsius === null) return '—';
  return formatTemperature(celsius);
}
