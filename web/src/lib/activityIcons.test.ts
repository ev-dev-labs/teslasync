import { describe, it, expect } from 'vitest'
import { getActivityVisual, type ActivityVisual } from './activityIcons'
import { Icons } from '@/lib/icons'

const FALLBACK_KEY = 'activity.action.unknown'

/** Runtime guard proving a value is a real ActivityVisual (not an inherited member). */
function isVisual(v: ActivityVisual): boolean {
  return (
    !!v &&
    typeof v.i18nKey === 'string' &&
    typeof v.fallback === 'string' &&
    typeof v.color === 'string' &&
    v.icon != null
  )
}

describe('getActivityVisual — exact matches', () => {
  it('resolves a leaf vehicle command (wake) to its full visual', () => {
    const v = getActivityVisual('vehicle.command.wake')
    expect(v.icon).toBe(Icons.power)
    expect(v.color).toBe('text-amber-300')
    expect(v.i18nKey).toBe('activity.action.vehicleCommandWake')
    expect(v.fallback).toBe('Wake vehicle')
  })

  it('resolves lock and unlock to distinct icons + keys', () => {
    expect(getActivityVisual('vehicle.command.lock').icon).toBe(Icons.locked)
    expect(getActivityVisual('vehicle.command.lock').i18nKey).toBe(
      'activity.action.vehicleCommandLock',
    )
    expect(getActivityVisual('vehicle.command.unlock').icon).toBe(Icons.unlocked)
    expect(getActivityVisual('vehicle.command.unlock').i18nKey).toBe(
      'activity.action.vehicleCommandUnlock',
    )
  })

  it('resolves representative entries across every domain group', () => {
    expect(getActivityVisual('settings.update').i18nKey).toBe('activity.action.settingsUpdate')
    expect(getActivityVisual('alert.rule.create').icon).toBe(Icons.notificationsAdd)
    expect(getActivityVisual('automation.create').i18nKey).toBe('activity.action.automationCreate')
    expect(getActivityVisual('dashboard.layout.save').icon).toBe(Icons.layoutGrid)
    expect(getActivityVisual('data_export.create').icon).toBe(Icons.download)
    expect(getActivityVisual('api_key.create').icon).toBe(Icons.key)
    expect(getActivityVisual('auth.login').i18nKey).toBe('activity.action.authLogin')
    expect(getActivityVisual('auth.logout').fallback).toBe('Signed out')
  })
})

describe('getActivityVisual — prefix fallback walking', () => {
  it('falls back from an unknown leaf to the longest known prefix', () => {
    // vehicle.command.wake.extra → vehicle.command.wake (longest own prefix)
    expect(getActivityVisual('vehicle.command.wake.extra').i18nKey).toBe(
      'activity.action.vehicleCommandWake',
    )
    // vehicle.command.<unknown verb> → vehicle.command
    expect(getActivityVisual('vehicle.command.zap').i18nKey).toBe('activity.action.vehicleCommand')
  })

  it('skips a missing intermediate prefix and keeps walking down', () => {
    // alert.rule.* leaf verbs exist, but "alert.rule" itself is NOT a key, so an
    // unknown verb must walk past it down to the registered "alert" domain.
    const v = getActivityVisual('alert.rule.silence')
    expect(v.i18nKey).toBe('activity.action.alert')
    expect(v.icon).toBe(Icons.notifications)
  })

  it('resolves single-segment domain fallbacks', () => {
    expect(getActivityVisual('settings.theme').i18nKey).toBe('activity.action.settings')
    expect(getActivityVisual('api_key.rotate').i18nKey).toBe('activity.action.apiKey')
    expect(getActivityVisual('automation.pause').i18nKey).toBe('activity.action.automation')
    expect(getActivityVisual('data_export.download').i18nKey).toBe('activity.action.dataExport')
    expect(getActivityVisual('dashboard.reset').i18nKey).toBe('activity.action.dashboard')
  })
})

describe('getActivityVisual — fallback for unknown / empty input', () => {
  it('returns the generic fallback for a wholly unknown action', () => {
    const v = getActivityVisual('totally.unknown.action')
    expect(v.icon).toBe(Icons.history)
    expect(v.i18nKey).toBe(FALLBACK_KEY)
    expect(v.fallback).toBe('Activity')
  })

  it('returns the fallback for a single unknown segment', () => {
    expect(getActivityVisual('nonexistent').i18nKey).toBe(FALLBACK_KEY)
  })

  it('returns the fallback for empty, whitespace-only and nullish input', () => {
    expect(getActivityVisual('').i18nKey).toBe(FALLBACK_KEY)
    expect(getActivityVisual('   ').i18nKey).toBe(FALLBACK_KEY)
    expect(getActivityVisual(null).i18nKey).toBe(FALLBACK_KEY)
    expect(getActivityVisual(undefined).i18nKey).toBe(FALLBACK_KEY)
  })

  it('does not treat malformed dotted input as a match', () => {
    expect(getActivityVisual('.vehicle.command.').i18nKey).toBe(FALLBACK_KEY)
    expect(getActivityVisual('...').i18nKey).toBe(FALLBACK_KEY)
  })
})

describe('getActivityVisual — trims surrounding whitespace', () => {
  it('matches an action padded with spaces, tabs and newlines', () => {
    expect(getActivityVisual('  vehicle.command.wake  ').i18nKey).toBe(
      'activity.action.vehicleCommandWake',
    )
    expect(getActivityVisual('\tsettings.update\n').i18nKey).toBe('activity.action.settingsUpdate')
  })
})

describe('getActivityVisual — inherited Object.prototype keys are never matches (regression)', () => {
  // A plain object literal inherits toString/constructor/hasOwnProperty/… . A
  // naive `REGISTRY[key]` truthy check would return those inherited members as
  // if they were ActivityVisuals, and consumers reading `.icon` off a Function
  // would render `<undefined />` and crash. All of these MUST hit FALLBACK.
  const inherited = [
    'toString',
    'constructor',
    'hasOwnProperty',
    'valueOf',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    '__proto__',
  ]

  it.each(inherited)('resolves "%s" to the safe fallback, not an inherited member', (key) => {
    const v = getActivityVisual(key)
    expect(v.i18nKey).toBe(FALLBACK_KEY)
    expect(v.icon).toBe(Icons.history)
    expect(isVisual(v)).toBe(true)
    expect(typeof v.icon).not.toBe('undefined')
  })

  it('does not match an inherited name used as a prefix segment either', () => {
    expect(getActivityVisual('toString.wake').i18nKey).toBe(FALLBACK_KEY)
    expect(getActivityVisual('constructor.create').i18nKey).toBe(FALLBACK_KEY)
    expect(getActivityVisual('hasOwnProperty.update').icon).toBe(Icons.history)
  })
})

describe('getActivityVisual — result contract & purity', () => {
  const KNOWN_ACTIONS = [
    'vehicle.command',
    'vehicle.command.wake',
    'vehicle.command.honk',
    'vehicle.command.flash',
    'vehicle.command.lock',
    'vehicle.command.unlock',
    'vehicle.command.climate',
    'vehicle.command.charge',
    'settings.update',
    'settings',
    'alert.rule.create',
    'alert.rule.update',
    'alert.rule.delete',
    'alert',
    'automation.create',
    'automation.update',
    'automation.delete',
    'automation',
    'dashboard.layout.save',
    'dashboard',
    'data_export.create',
    'data_export',
    'api_key.create',
    'api_key.update',
    'api_key.delete',
    'api_key',
    'auth.login',
    'auth.logout',
    'auth',
  ]

  it('every registered action yields a well-formed ActivityVisual', () => {
    for (const action of KNOWN_ACTIONS) {
      const v = getActivityVisual(action)
      expect(isVisual(v)).toBe(true)
      expect(v.i18nKey.startsWith('activity.action.')).toBe(true)
      expect(v.color).toMatch(/^text-/)
      expect(v.fallback.length).toBeGreaterThan(0)
    }
  })

  it('is a pure lookup — identical input yields the same singleton reference', () => {
    expect(getActivityVisual('auth.login')).toBe(getActivityVisual('auth.login'))
    // Every unknown collapses onto one shared FALLBACK object.
    expect(getActivityVisual('x.y.z')).toBe(getActivityVisual('q.w.e'))
  })

  it('exposes exactly the ActivityVisual shape (type contract)', () => {
    const v: ActivityVisual = getActivityVisual('auth.login')
    expect(Object.keys(v).sort()).toEqual(['color', 'fallback', 'i18nKey', 'icon'])
  })
})
