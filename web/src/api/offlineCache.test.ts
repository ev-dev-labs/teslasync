import { describe, it, expect } from 'vitest'

import {
  OfflineWriteRejectedError,
  assertNeverQueuedOffline,
  describeOfflineSnapshot,
  isOfflineSafeRead,
  isOfflineUnsafeWrite,
  isOfflineWriteRejectedError,
  isSafeMethod,
} from './offlineCache'

describe('isSafeMethod / isOfflineSafeRead', () => {
  it('treats only read verbs as cacheable offline', () => {
    expect(isSafeMethod('GET')).toBe(true)
    expect(isSafeMethod('get')).toBe(true)
    expect(isSafeMethod(undefined)).toBe(true)
    expect(isSafeMethod('HEAD')).toBe(true)
    expect(isSafeMethod('POST')).toBe(false)
    expect(isSafeMethod('PATCH')).toBe(false)
    expect(isSafeMethod('DELETE')).toBe(false)
  })

  it('never allows a write result to be served from the offline cache', () => {
    expect(isOfflineSafeRead('GET', '/drives')).toBe(true)
    expect(isOfflineSafeRead('POST', '/drives')).toBe(false)
  })
})

describe('isOfflineUnsafeWrite', () => {
  const destructive: readonly [string, string][] = [
    ['POST', '/vehicles/12/command/door_unlock'],
    ['POST', '/vehicles/12/wake'],
    ['POST', '/vehicles/12/refresh'],
    ['POST', '/commands/climate_start'],
    ['POST', '/watch/12/command'],
    ['POST', '/guard/panic'],
    ['PUT', '/guard/config'],
    ['POST', '/data-repair/drives/5/close'],
    ['POST', '/repair-cases/7/transition'],
    ['POST', '/quarantine/restore'],
    ['POST', '/dlq/replay'],
    ['POST', '/auth/disconnect'],
    ['DELETE', '/sessions/abc'],
    ['POST', '/totp/revoke'],
    ['DELETE', '/admin/api-keys/9'],
    ['POST', '/impersonation/start'],
    ['POST', '/rbac/matrix'],
    ['DELETE', '/vehicles/12/drivers/3'],
  ]

  it.each(destructive)('classifies %s %s as never-queueable', (method, path) => {
    expect(isOfflineUnsafeWrite(method, path)).toBe(true)
  })

  it('matches regardless of an accidental /api/v1 prefix or query string', () => {
    expect(isOfflineUnsafeWrite('POST', '/api/v1/vehicles/1/command/honk')).toBe(true)
    expect(isOfflineUnsafeWrite('POST', '/data-repair/scan?dry_run=true')).toBe(true)
  })

  it('leaves benign writes alone so they can fail and be retried by hand', () => {
    expect(isOfflineUnsafeWrite('POST', '/dashboard-layouts')).toBe(false)
    expect(isOfflineUnsafeWrite('PATCH', '/notifications/12')).toBe(false)
    expect(isOfflineUnsafeWrite('POST', '/feedback')).toBe(false)
  })

  it('never classifies a read as unsafe', () => {
    expect(isOfflineUnsafeWrite('GET', '/vehicles/12/command/status')).toBe(false)
    expect(isOfflineUnsafeWrite('GET', '/data-repair/cases')).toBe(false)
  })
})

describe('assertNeverQueuedOffline', () => {
  it('rejects a destructive command while offline instead of queueing it', () => {
    expect(() =>
      assertNeverQueuedOffline('POST', '/vehicles/1/command/door_unlock', false),
    ).toThrow(OfflineWriteRejectedError)
  })

  it('explains that the action is not queued', () => {
    try {
      assertNeverQueuedOffline('POST', '/data-repair/drives/1/close', false)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(isOfflineWriteRejectedError(error)).toBe(true)
      expect((error as OfflineWriteRejectedError).message).toMatch(/never queued/i)
      expect((error as OfflineWriteRejectedError).path).toBe('/data-repair/drives/1/close')
    }
  })

  it('allows safe reads offline so cached data can still be served', () => {
    expect(() => assertNeverQueuedOffline('GET', '/vehicles', false)).not.toThrow()
  })

  it('allows everything while online', () => {
    expect(() =>
      assertNeverQueuedOffline('POST', '/vehicles/1/command/door_unlock', true),
    ).not.toThrow()
  })

  it('allows non-destructive writes offline so they fail with a real network error', () => {
    expect(() => assertNeverQueuedOffline('POST', '/feedback', false)).not.toThrow()
  })
})

describe('describeOfflineSnapshot', () => {
  const now = 1_700_000_000_000

  it('labels a cached payload with the time it was actually captured', () => {
    const snapshot = describeOfflineSnapshot(now - 60_000, false, now)
    expect(snapshot.asOf).toBe(new Date(now - 60_000).toISOString())
    expect(snapshot.ageMs).toBe(60_000)
    expect(snapshot.isSnapshot).toBe(true)
  })

  it('reports an unknown capture time as unknown rather than as "now"', () => {
    expect(describeOfflineSnapshot(null, false, now).asOf).toBeNull()
    expect(describeOfflineSnapshot(undefined, false, now).ageMs).toBeNull()
    expect(describeOfflineSnapshot(0, false, now).asOf).toBeNull()
  })

  it('is not a snapshot while online', () => {
    expect(describeOfflineSnapshot(now - 1_000, true, now).isSnapshot).toBe(false)
  })
})
