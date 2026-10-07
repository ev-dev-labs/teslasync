import type { SecretRotationSeverity, SecretRotationStatus } from '@/types/admin-operator-confidence';

export const SEVERITY_VARIANT: Record<SecretRotationSeverity, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

// Chart-only hex — dynamic fill values, not static CSS vars. `unknown`
// borrows the muted slate used across the app's neutral chips.
export const SEVERITY_HEX: Record<SecretRotationSeverity, string> = {
  ok: '#10b981',
  warn: '#f59e0b',
  critical: '#ef4444',
  unknown: '#64748b',
};

export const SEVERITY_ORDER: SecretRotationSeverity[] = ['critical', 'warn', 'ok', 'unknown'];

// English fallback labels for the raw kind enum. The component resolves these
// through i18n (`admin.secretRotation.kind.<enum>`) using the value here as the
// default, so translators can localise them and newly-added kinds still render
// their raw value before either map is updated.
export const KIND_LABELS: Record<string, string> = {
  tesla_refresh_token: 'Tesla refresh token',
  mqtt_mtls_cert: 'MQTT mTLS certificate',
  database_password: 'Database password',
  session_jwk: 'Session JWK',
  app_signing_key: 'App signing key',
  authentik_secret: 'Authentik client secret',
};

/** Stable per-row key across (kind, target) pairs. */
export function rowKey(r: SecretRotationStatus): string {
  return `${r.kind}:${r.target_id ?? ''}`;
}

/** Clip long labels so axis ticks and list rows stay one line. */
export function truncate(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
