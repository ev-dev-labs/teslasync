import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DEVICE_NOTIFICATION_PREFS,
  WEEKDAY_ALL,
  categoryFromPayload,
  evaluateNotification,
  isWithinQuietHours,
  normalizeSeverity,
  sanitizeDeviceNotificationPrefs,
  severityRank,
  vehicleIdFromPayload,
  type DeviceNotificationPrefs,
} from '../notificationPolicy'

/**
 * Device notification policy (PWA-05).
 *
 * Two properties matter most and are pinned hard:
 *   - the policy FAILS OPEN on corrupt input (a rotten preference blob must
 *     never silently swallow a critical alert), and
 *   - quiet hours SILENCE rather than suppress, so nothing is lost and the
 *     Chromium silent-push budget is not burned.
 */

const base = (patch: Partial<DeviceNotificationPrefs> = {}): DeviceNotificationPrefs =>
  sanitizeDeviceNotificationPrefs({ ...DEFAULT_DEVICE_NOTIFICATION_PREFS, ...patch })

// Sunday 2026-08-23 at 12:00 local — well outside the default quiet window.
const MIDDAY = new Date(2026, 7, 23, 12, 0, 0).getTime()

describe('normalizeSeverity', () => {
  it.each([
    ['critical', 'critical'],
    ['error', 'critical'],
    ['FATAL', 'critical'],
    ['warn', 'warn'],
    ['Warning', 'warn'],
    ['info', 'info'],
    ['anything-else', 'info'],
    [undefined, 'info'],
    [42, 'info'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeSeverity(input)).toBe(expected)
  })

  it('orders info < warn < critical', () => {
    expect(severityRank('info')).toBeLessThan(severityRank('warn'))
    expect(severityRank('warn')).toBeLessThan(severityRank('critical'))
  })
})

describe('categoryFromPayload', () => {
  it('prefers an explicit category field', () => {
    expect(categoryFromPayload({ category: 'security', tag: 'drive-1' })).toBe('security')
  })

  it.each([
    ['alert-42', 'alert'],
    ['charge-7', 'charging'],
    ['charging:7', 'charging'],
    ['drive-9', 'drive'],
    ['trip_3', 'drive'],
    ['battery-x', 'battery'],
    ['sentry-1', 'security'],
    ['system-health', 'system'],
    ['export-ready', 'export'],
  ])('infers %s from the tag prefix', (tag, expected) => {
    expect(categoryFromPayload({ tag })).toBe(expected)
  })

  it('falls back to "other" for an unknown shape', () => {
    expect(categoryFromPayload({})).toBe('other')
    expect(categoryFromPayload({ category: 'nope', tag: 'zzz-1' })).toBe('other')
  })
})

describe('vehicleIdFromPayload', () => {
  it.each([
    [{ vehicleId: 4 }, 4],
    [{ vehicle_id: 5 }, 5],
    [{ vehicle_id: '6' }, 6],
    [{ url: '/vehicles/7' }, 7],
    [{ url: '/vehicles/7/access' }, 7],
    [{ url: '/battery?vehicle_id=8' }, 8],
    [{ url: '/notifications/inbox' }, null],
    [{}, null],
    [{ vehicle_id: 0 }, null],
    [{ vehicle_id: -3 }, null],
  ])('resolves %o to %s', (payload, expected) => {
    expect(vehicleIdFromPayload(payload)).toBe(expected)
  })
})

describe('sanitizeDeviceNotificationPrefs', () => {
  it('fails open on garbage so a corrupt blob never mutes a critical alert', () => {
    for (const garbage of [null, undefined, 'nope', 42, [], { version: 99 }]) {
      const prefs = sanitizeDeviceNotificationPrefs(garbage)
      expect(prefs.enabled).toBe(true)
      expect(prefs.minSeverity).toBe('info')
      expect(prefs.vehicleScope).toBe('all')
      expect(Object.values(prefs.categories).every(Boolean)).toBe(true)
    }
  })

  it('repairs individual invalid fields without discarding the valid ones', () => {
    const prefs = sanitizeDeviceNotificationPrefs({
      enabled: false,
      minSeverity: 'catastrophic',
      vehicleScope: 'nonsense',
      vehicleIds: [3, '4', 0, -1, 3, 'x'],
      categories: { alert: false, charging: 'yes', unknown: true },
      quietHours: {
        enabled: true,
        startLocal: '25:00',
        endLocal: '07:30',
        weekdays: 999,
        bypassSeverities: ['error', 'warning'],
      },
    })

    expect(prefs.enabled).toBe(false)
    expect(prefs.minSeverity).toBe('info')
    expect(prefs.vehicleScope).toBe('all')
    expect(prefs.vehicleIds).toEqual([3, 4])
    expect(prefs.categories.alert).toBe(false)
    expect(prefs.categories.charging).toBe(true)
    expect(prefs.quietHours.startLocal).toBe('22:00')
    expect(prefs.quietHours.endLocal).toBe('07:30')
    expect(prefs.quietHours.weekdays).toBe(WEEKDAY_ALL)
    expect(prefs.quietHours.bypassSeverities).toEqual(['critical', 'warn'])
  })

  it('never returns a reference into the frozen defaults', () => {
    const a = sanitizeDeviceNotificationPrefs(undefined)
    const b = sanitizeDeviceNotificationPrefs(undefined)
    a.vehicleIds.push(1)
    a.categories.alert = false
    expect(b.vehicleIds).toEqual([])
    expect(b.categories.alert).toBe(true)
  })
})

describe('isWithinQuietHours', () => {
  const quiet = {
    enabled: true,
    startLocal: '22:00',
    endLocal: '07:00',
    weekdays: WEEKDAY_ALL,
    bypassSeverities: ['critical' as const],
  }

  it('is inert while disabled', () => {
    expect(isWithinQuietHours({ ...quiet, enabled: false }, 3, 23 * 60)).toBe(false)
  })

  it('covers a window that wraps past midnight', () => {
    expect(isWithinQuietHours(quiet, 3, 22 * 60)).toBe(true)
    expect(isWithinQuietHours(quiet, 3, 23 * 60 + 59)).toBe(true)
    expect(isWithinQuietHours(quiet, 3, 6 * 60 + 59)).toBe(true)
    expect(isWithinQuietHours(quiet, 3, 7 * 60)).toBe(false)
    expect(isWithinQuietHours(quiet, 3, 12 * 60)).toBe(false)
  })

  it('handles a same-day window', () => {
    const day = { ...quiet, startLocal: '09:00', endLocal: '17:00' }
    expect(isWithinQuietHours(day, 2, 8 * 60 + 59)).toBe(false)
    expect(isWithinQuietHours(day, 2, 9 * 60)).toBe(true)
    expect(isWithinQuietHours(day, 2, 16 * 60 + 59)).toBe(true)
    expect(isWithinQuietHours(day, 2, 17 * 60)).toBe(false)
  })

  it('attributes the post-midnight tail of a wrapping window to the previous day', () => {
    // Mondays only (bit 1). 01:00 on Tuesday belongs to Monday's window.
    const mondayOnly = { ...quiet, weekdays: 1 << 1 }
    expect(isWithinQuietHours(mondayOnly, 1, 23 * 60)).toBe(true)
    expect(isWithinQuietHours(mondayOnly, 2, 1 * 60)).toBe(true)
    expect(isWithinQuietHours(mondayOnly, 2, 23 * 60)).toBe(false)
    expect(isWithinQuietHours(mondayOnly, 1, 1 * 60)).toBe(false)
  })
})

describe('evaluateNotification', () => {
  it('delivers everything with the shipped defaults', () => {
    const decision = evaluateNotification(
      { severity: 'info', tag: 'alert-1' },
      base(),
      MIDDAY,
    )
    expect(decision).toMatchObject({
      show: true,
      silent: false,
      requireInteraction: false,
      reason: 'delivered',
    })
  })

  it('keeps critical alerts sticky', () => {
    expect(
      evaluateNotification({ severity: 'critical' }, base(), MIDDAY).requireInteraction,
    ).toBe(true)
  })

  it('honours the master switch first', () => {
    const decision = evaluateNotification({ severity: 'critical' }, base({ enabled: false }), MIDDAY)
    expect(decision).toMatchObject({ show: false, reason: 'device-disabled' })
  })

  it('suppresses a muted category', () => {
    const prefs = base()
    prefs.categories.charging = false
    expect(
      evaluateNotification({ tag: 'charge-3', severity: 'warn' }, prefs, MIDDAY),
    ).toMatchObject({ show: false, reason: 'category-muted' })
    // A different category is unaffected.
    expect(
      evaluateNotification({ tag: 'alert-3', severity: 'warn' }, prefs, MIDDAY).show,
    ).toBe(true)
  })

  it('applies the severity floor', () => {
    const prefs = base({ minSeverity: 'critical' })
    expect(evaluateNotification({ severity: 'warn' }, prefs, MIDDAY)).toMatchObject({
      show: false,
      reason: 'below-min-severity',
    })
    expect(evaluateNotification({ severity: 'critical' }, prefs, MIDDAY).show).toBe(true)
  })

  it('applies vehicle scope', () => {
    const prefs = base({ vehicleScope: 'selected', vehicleIds: [2] })
    expect(
      evaluateNotification({ url: '/vehicles/9', severity: 'warn' }, prefs, MIDDAY),
    ).toMatchObject({ show: false, reason: 'vehicle-out-of-scope' })
    expect(
      evaluateNotification({ url: '/vehicles/2', severity: 'warn' }, prefs, MIDDAY).show,
    ).toBe(true)
  })

  it('never filters a fleet-wide notification by vehicle scope', () => {
    const prefs = base({ vehicleScope: 'selected', vehicleIds: [2] })
    // "Fleet telemetry offline" has no vehicle id and is exactly the alert a
    // scoped device most needs to see.
    expect(
      evaluateNotification({ tag: 'system-outage', severity: 'critical' }, prefs, MIDDAY),
    ).toMatchObject({ show: true, vehicleId: null })
  })

  it('silences rather than suppresses inside quiet hours', () => {
    const prefs = base({
      quietHours: {
        enabled: true,
        startLocal: '22:00',
        endLocal: '07:00',
        weekdays: WEEKDAY_ALL,
        bypassSeverities: ['critical'],
      },
    })
    const decision = evaluateNotification({ severity: 'warn' }, prefs, MIDDAY, {
      weekday: 3,
      minutesOfDay: 23 * 60,
    })
    expect(decision).toMatchObject({
      show: true,
      silent: true,
      requireInteraction: false,
      reason: 'quiet-hours-silenced',
    })
  })

  it('lets a bypass severity ring through quiet hours', () => {
    const prefs = base({
      quietHours: {
        enabled: true,
        startLocal: '22:00',
        endLocal: '07:00',
        weekdays: WEEKDAY_ALL,
        bypassSeverities: ['critical'],
      },
    })
    expect(
      evaluateNotification({ severity: 'critical' }, prefs, MIDDAY, {
        weekday: 3,
        minutesOfDay: 23 * 60,
      }),
    ).toMatchObject({
      show: true,
      silent: false,
      requireInteraction: true,
      reason: 'quiet-hours-bypassed',
    })
  })

  it('evaluates hard mutes before quiet hours', () => {
    const prefs = base({
      minSeverity: 'critical',
      quietHours: {
        enabled: true,
        startLocal: '00:00',
        endLocal: '23:59',
        weekdays: WEEKDAY_ALL,
        bypassSeverities: ['critical'],
      },
    })
    expect(
      evaluateNotification({ severity: 'info' }, prefs, MIDDAY).reason,
    ).toBe('below-min-severity')
  })

  it('reports the resolved context on every decision', () => {
    const decision = evaluateNotification(
      { severity: 'warn', tag: 'drive-1', vehicle_id: 5 },
      base(),
      MIDDAY,
    )
    expect(decision.category).toBe('drive')
    expect(decision.severity).toBe('warn')
    expect(decision.vehicleId).toBe(5)
  })
})
