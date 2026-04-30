import { HEALTH_COLOR, type HealthStatus } from './constants';

export function healthBadgeVariant(
  health: HealthStatus,
): 'success' | 'warning' | 'danger' {
  if (health === 'good') return 'success';
  if (health === 'warning') return 'warning';
  return 'danger';
}

export function getAlertVariant(
  health: HealthStatus,
): 'warning' | 'danger' {
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
  fmtTemp: (c: number) => string,
): string {
  if (celsius === null) return '—';
  return fmtTemp(celsius);
}
