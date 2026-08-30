import { describe, expect, it } from 'vitest'
import { isSensitiveFieldName, redactExportValue, redactSensitiveData, redactSensitiveText } from './privacy'

describe('privacy redaction', () => {
  it('removes credentials, VINs, emails, and precise locations from free-form text', () => {
    const raw = [
      'Bearer super-secret-token',
      'token=abc123456',
      'VIN 5YJ3E1EA7JF000123',
      'owner alice@example.com',
      'at 37.7749, -122.4194',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue',
    ].join(' | ')

    const redacted = redactSensitiveText(raw)

    expect(redacted).not.toContain('super-secret-token')
    expect(redacted).not.toContain('abc123456')
    expect(redacted).not.toContain('5YJ3E1EA7JF000123')
    expect(redacted).not.toContain('alice@example.com')
    expect(redacted).not.toContain('37.7749')
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(redacted).toContain('[VIN_REDACTED]')
    expect(redacted).toContain('[EMAIL_REDACTED]')
    expect(redacted).toContain('[LOCATION_REDACTED]')
  })

  it('redacts sensitive structured fields recursively without mutating safe values', () => {
    const raw = {
      vehicle_name: 'Model 3',
      vin: '5YJ3E1EA7JF000123',
      email: 'owner@example.com',
      nested: { refresh_token: 'secret-value', route: '/drives/42' },
    }

    expect(redactSensitiveData(raw)).toEqual({
      vehicle_name: 'Model 3',
      vin: '[REDACTED]',
      email: '[REDACTED]',
      nested: { refresh_token: '[REDACTED]', route: '/drives/42' },
    })
    expect(raw.vin).toBe('5YJ3E1EA7JF000123')
  })

  it('redacts push subscription secrets while retaining benign token counters', () => {
    expect(redactSensitiveData({
      subscription: { keys: { p256dh: 'public-key', auth: 'auth-secret' } },
      direct: { p256dh: 'public-key', auth: 'auth-secret' },
      tokens: 8,
      max_tokens: 32,
    })).toEqual({
      subscription: { keys: '[REDACTED]' },
      direct: { p256dh: '[REDACTED]', auth: '[REDACTED]' },
      tokens: 8,
      max_tokens: 32,
    })
  })

  it('uses the export column key to remove private values', () => {
    expect(redactExportValue('api_key', 'abc')).toBe('[REDACTED]')
    expect(redactExportValue('vehicle_name', 'Model Y')).toBe('Model Y')
  })

  it('matches sensitive key boundaries without masking ordinary driving fields', () => {
    for (const field of [
      'access_key',
      'accountKey',
      'private_key',
      'signingKey',
      'user_key',
      'key',
      'keys',
      'auth',
      'p256dh',
      'vehicle_vin',
    ]) {
      expect(isSensitiveFieldName(field)).toBe(true)
    }
    for (const field of ['savings', 'driving', 'moving', 'monkey', 'tokens', 'max_tokens', 'vehicle_name']) {
      expect(isSensitiveFieldName(field)).toBe(false)
      expect(redactExportValue(field, 'preserved')).toBe('preserved')
    }
  })
})
