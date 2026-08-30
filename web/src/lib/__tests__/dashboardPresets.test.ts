import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  DASHBOARD_PRESET_CHANGED_EVENT,
  DASHBOARD_PRESET_PENDING_KEY,
  DASHBOARD_PRESET_PREFERENCE_KEY,
  DASHBOARD_ROLE_PRESETS,
  chooseDashboardPreset,
  clearPendingDashboardPreset,
  consumePendingDashboardPreset,
  getAppliedDashboardPresetRole,
  getDashboardPreset,
  getDashboardPresetPreference,
  hasPendingDashboardPreset,
  peekPendingDashboardPreset,
  presetWidgetIds,
  requestDashboardPresetApplication,
  setAppliedDashboardPresetRole,
  setDashboardPresetPreference,
  type DashboardPresetRole,
} from '../dashboardPresets'
import { WIDGET_REGISTRY, getWidgetDef } from '@/features/dashboard/widgets/registry'

/**
 * HELP-11. The presets are data that references another registry, which is
 * exactly the shape that rots silently: a widget gets renamed or removed, the
 * preset keeps pointing at a dead id, and the user gets a card that never
 * loads. These tests are the anti-rot mechanism.
 */

const REQUIRED_ROLES: DashboardPresetRole[] = [
  'owner',
  'fleet_operator',
  'energy_analyst',
  'maintainer',
]

describe('dashboard role presets — registry integrity', () => {
  it('defines every required role exactly once', () => {
    const roles = DASHBOARD_ROLE_PRESETS.map((preset) => preset.role)
    expect([...roles].sort()).toEqual([...REQUIRED_ROLES].sort())
    expect(new Set(roles).size).toBe(roles.length)
  })

  it('references only widget ids that exist in the widget registry', () => {
    const known = new Set(WIDGET_REGISTRY.map((widget) => widget.id))
    for (const preset of DASHBOARD_ROLE_PRESETS) {
      for (const widget of preset.widgets) {
        expect(known.has(widget.widgetId), `${preset.role} → ${widget.widgetId}`).toBe(true)
      }
    }
  })

  it('keeps every mirrored label in lock-step with the widget registry', () => {
    // The label is duplicated so the picker needs no registry import (and no
    // lazy widget chunks). This test is what makes the duplication safe.
    for (const preset of DASHBOARD_ROLE_PRESETS) {
      for (const widget of preset.widgets) {
        expect(getWidgetDef(widget.widgetId)?.name, widget.widgetId).toBe(
          widget.labelFallback,
        )
      }
    }
  })

  it('never repeats a widget within one preset', () => {
    for (const preset of DASHBOARD_ROLE_PRESETS) {
      const ids = preset.widgets.map((widget) => widget.widgetId)
      expect(new Set(ids).size, preset.role).toBe(ids.length)
    }
  })

  it('gives every preset a stated audience and rationale', () => {
    for (const preset of DASHBOARD_ROLE_PRESETS) {
      expect(preset.audienceFallback.length, preset.role).toBeGreaterThan(20)
      expect(preset.rationaleFallback.length, preset.role).toBeGreaterThan(30)
      expect(preset.widgets.length, preset.role).toBeGreaterThan(3)
    }
  })

  it('composes existing widgets rather than defining a dashboard object', () => {
    for (const preset of DASHBOARD_ROLE_PRESETS) {
      // No layout, no widget instances, no ids — a preset is a curation only.
      expect(Object.keys(preset).sort()).toEqual([
        'audienceFallback',
        'audienceKey',
        'nameFallback',
        'nameKey',
        'rationaleFallback',
        'rationaleKey',
        'role',
        'widgets',
      ])
    }
  })
})

describe('lookup helpers', () => {
  it('resolves a known role', () => {
    expect(getDashboardPreset('owner')?.role).toBe('owner')
  })

  it('returns null for an unknown role', () => {
    expect(getDashboardPreset('captain')).toBeNull()
  })

  it('returns ordered widget ids', () => {
    expect(presetWidgetIds('maintainer')[0]).toBe('system-health')
  })

  it('returns an empty list for an unknown role', () => {
    expect(presetWidgetIds('captain')).toEqual([])
  })
})

describe('preference persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts unset — no role is assumed on the user’s behalf', () => {
    expect(getDashboardPresetPreference()).toBeNull()
  })

  it('round-trips a valid role', () => {
    setDashboardPresetPreference('energy_analyst')
    expect(getDashboardPresetPreference()).toBe('energy_analyst')
    expect(window.localStorage.getItem(DASHBOARD_PRESET_PREFERENCE_KEY)).toBe('energy_analyst')
  })

  it('clears the preference with null', () => {
    setDashboardPresetPreference('owner')
    setDashboardPresetPreference(null)
    expect(getDashboardPresetPreference()).toBeNull()
    expect(window.localStorage.getItem(DASHBOARD_PRESET_PREFERENCE_KEY)).toBeNull()
  })

  it('ignores a corrupt stored value rather than returning it', () => {
    window.localStorage.setItem(DASHBOARD_PRESET_PREFERENCE_KEY, 'not-a-role')
    expect(getDashboardPresetPreference()).toBeNull()
  })

  it('refuses to persist an unknown role', () => {
    setDashboardPresetPreference('captain' as DashboardPresetRole)
    expect(window.localStorage.getItem(DASHBOARD_PRESET_PREFERENCE_KEY)).toBeNull()
  })

  it('announces the change so open surfaces can react', () => {
    const listener = vi.fn()
    window.addEventListener(DASHBOARD_PRESET_CHANGED_EVENT, listener)
    setDashboardPresetPreference('maintainer')
    window.removeEventListener(DASHBOARD_PRESET_CHANGED_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => setDashboardPresetPreference('owner')).not.toThrow()
  })
})

describe('one-shot adoption requests', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('starts with nothing queued', () => {
    expect(hasPendingDashboardPreset()).toBe(false)
    expect(peekPendingDashboardPreset()).toBeNull()
  })

  it('NEVER becomes pending merely because the layout stopped matching', () => {
    // This is the defect. A durable preference plus a derived applied marker
    // must not, between them, imply an instruction. Only an explicit user
    // action queues one.
    setDashboardPresetPreference('owner')
    setAppliedDashboardPresetRole(null)

    expect(getDashboardPresetPreference()).toBe('owner')
    expect(getAppliedDashboardPresetRole()).toBeNull()
    expect(hasPendingDashboardPreset()).toBe(false)
  })

  it('queues a request with a role and a nonce when the user chooses', () => {
    const request = chooseDashboardPreset('maintainer')
    expect(request?.role).toBe('maintainer')
    expect(typeof request?.nonce).toBe('string')
    expect(request?.nonce.length).toBeGreaterThan(0)
    expect(hasPendingDashboardPreset()).toBe(true)
    // …and the durable preference is recorded too.
    expect(getDashboardPresetPreference()).toBe('maintainer')
  })

  it('consumes exactly once', () => {
    chooseDashboardPreset('owner')
    expect(consumePendingDashboardPreset()?.role).toBe('owner')
    expect(consumePendingDashboardPreset()).toBeNull()
    expect(hasPendingDashboardPreset()).toBe(false)
  })

  it('gives every selection a distinct nonce', () => {
    const first = chooseDashboardPreset('owner')
    consumePendingDashboardPreset()
    const second = chooseDashboardPreset('owner')
    expect(second?.nonce).not.toBe(first?.nonce)
  })

  it('lets an explicit re-apply queue a fresh request after consumption', () => {
    chooseDashboardPreset('owner')
    consumePendingDashboardPreset()
    expect(hasPendingDashboardPreset()).toBe(false)

    const again = requestDashboardPresetApplication('owner')
    expect(again?.role).toBe('owner')
    expect(hasPendingDashboardPreset()).toBe(true)
    // The preference is untouched by a re-apply — it was already `owner`.
    expect(getDashboardPresetPreference()).toBe('owner')
  })

  it('refuses to queue an unknown role', () => {
    expect(
      requestDashboardPresetApplication('captain' as DashboardPresetRole),
    ).toBeNull()
    expect(hasPendingDashboardPreset()).toBe(false)
  })

  it('cancels the queued request when the preference is cleared', () => {
    chooseDashboardPreset('owner')
    chooseDashboardPreset(null)
    expect(hasPendingDashboardPreset()).toBe(false)
    expect(getDashboardPresetPreference()).toBeNull()
  })

  it('ignores a corrupt or malformed stored request', () => {
    window.localStorage.setItem(DASHBOARD_PRESET_PENDING_KEY, '{not json')
    expect(peekPendingDashboardPreset()).toBeNull()

    window.localStorage.setItem(
      DASHBOARD_PRESET_PENDING_KEY,
      JSON.stringify({ role: 'captain', nonce: 'x' }),
    )
    expect(peekPendingDashboardPreset()).toBeNull()

    window.localStorage.setItem(
      DASHBOARD_PRESET_PENDING_KEY,
      JSON.stringify({ role: 'owner' }),
    )
    expect(peekPendingDashboardPreset()).toBeNull()
  })

  it('can be dropped without applying', () => {
    chooseDashboardPreset('owner')
    clearPendingDashboardPreset()
    expect(hasPendingDashboardPreset()).toBe(false)
    // Preference survives — the user still likes the preset.
    expect(getDashboardPresetPreference()).toBe('owner')
  })
})
