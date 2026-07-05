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

/**
 * Severity band for a temperature reading against its ceiling.
 *
 * `'unknown'` covers every input we cannot rank: a missing reading, a
 * non-finite reading (`NaN` / `±Infinity` leaking through from bad telemetry —
 * these slip past a bare `=== null` check and would otherwise fall through to
 * the "good" band, mislabelling garbage as healthy), or a non-positive /
 * non-finite ceiling that makes `celsius / max` meaningless. Both public colour
 * helpers derive from this single classifier so their bands can never drift.
 */
type TempSeverity = 'unknown' | 'good' | 'warning' | 'critical';

const WARNING_RATIO = 0.65;
const CRITICAL_RATIO = 0.85;

function classifyTempSeverity(
  celsius: number | null,
  max: number,
): TempSeverity {
  if (celsius === null || !Number.isFinite(celsius)) return 'unknown';
  if (!Number.isFinite(max) || max <= 0) return 'unknown';
  const ratio = celsius / max;
  if (ratio >= CRITICAL_RATIO) return 'critical';
  if (ratio >= WARNING_RATIO) return 'warning';
  return 'good';
}

/** Neutral swatch for an unrankable ("unknown") reading. */
const TEMP_UNKNOWN_COLOR = '#6b7280';

const SEVERITY_COLOR: Record<TempSeverity, string> = {
  unknown: TEMP_UNKNOWN_COLOR,
  good: HEALTH_COLOR.good,
  warning: HEALTH_COLOR.warning,
  critical: HEALTH_COLOR.critical,
};

export function tempSeverityColor(celsius: number | null, max: number): string {
  return SEVERITY_COLOR[classifyTempSeverity(celsius, max)];
}

// Neon has no neutral swatch, so an "unknown" reading keeps the historical
// safe/green state (matching the original `null → 'green'` behaviour).
const SEVERITY_NEON: Record<TempSeverity, 'green' | 'amber' | 'red'> = {
  unknown: 'green',
  good: 'green',
  warning: 'amber',
  critical: 'red',
};

export function tempNeonColor(
  celsius: number | null,
  max: number,
): 'green' | 'amber' | 'red' {
  return SEVERITY_NEON[classifyTempSeverity(celsius, max)];
}

export function displayTemp(
  celsius: number | null,
  formatTemperature: (c: number) => string,
): string {
  // A missing reading OR a non-finite value (NaN / ±Infinity from bad
  // telemetry) has no meaningful temperature to render — show the neutral
  // em-dash rather than delegating "NaN°C" to the formatter.
  if (celsius === null || !Number.isFinite(celsius)) return '—';
  return formatTemperature(celsius);
}
