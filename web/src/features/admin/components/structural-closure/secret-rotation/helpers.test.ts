import { describe, expect, it } from 'vitest';
import { gaugeTone } from '@/lib/tokens';
import {
  KIND_LABELS,
  SEVERITY_HEX,
  SEVERITY_ORDER,
  SEVERITY_VARIANT,
} from './helpers';

describe('secret rotation helper presentation', () => {
  it('maps all four severities to shared restrained semantic paint', () => {
    expect(SEVERITY_HEX).toEqual({
      ok: gaugeTone.success,
      warn: gaugeTone.warning,
      critical: gaugeTone.danger,
      unknown: gaugeTone.neutral,
    });
  });

  it('preserves severity variants without reclassifying server tiers', () => {
    expect(SEVERITY_VARIANT).toEqual({
      ok: 'success',
      warn: 'warning',
      critical: 'danger',
      unknown: 'neutral',
    });
  });

  it('preserves severity ordering independently of chart paint', () => {
    expect(SEVERITY_ORDER).toEqual(['critical', 'warn', 'ok', 'unknown']);
  });

  it('preserves every known kind fallback label', () => {
    expect(KIND_LABELS).toEqual({
      tesla_refresh_token: 'Tesla refresh token',
      mqtt_mtls_cert: 'MQTT mTLS certificate',
      database_password: 'Database password',
      session_jwk: 'Session JWK',
      app_signing_key: 'App signing key',
      authentik_secret: 'Authentik client secret',
    });
  });
});
