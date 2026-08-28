import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useDashboardLayout } from '../useDashboardLayout'
import {
  getAppliedDashboardPresetRole,
  layoutMatchesPreset,
  presetWidgetIds,
  resolveAppliedPresetRole,
} from '@/lib/dashboardPresets'
import { WIDGET_REGISTRY } from '../../widgets/registry'

/**
 * HELP-11 application behaviour (correction round).
 *
 * The original slice persisted a preset preference that nothing ever read, so
 * the picker was decorative. These tests pin the two properties that make the
 * integration correct rather than merely present:
 *
 *   1. the ACTIVE dashboard's widgets become the preset's widgets, and
 *   2. no additional dashboard is created — the requirement was explicit that
 *      presets compose the dashboard you already have.
 */

vi.mock('@/api/hooks/useSettings', () => ({
  useDashboardLayouts: () => ({ data: undefined }),
  useSaveDashboardLayouts: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/lib/broadcast', () => ({
  broadcast: vi.fn(),
  subscribe: () => () => undefined,
}))

beforeEach(() => {
  window.localStorage.clear()
})

describe('useDashboardLayout — applyRolePreset', () => {
  it('replaces the ACTIVE dashboard widgets with the preset composition', () => {
    const { result } = renderHook(() => useDashboardLayout())

    expect(result.current.activeDashboard.widgets.length).toBeGreaterThan(0)

    act(() => {
      result.current.applyRolePreset('energy_analyst')
    })

    expect(result.current.activeDashboard.widgets.map((w) => w.widgetId)).toEqual(
      presetWidgetIds('energy_analyst'),
    )
  })

  it('does NOT clone or create an additional dashboard', () => {
    const { result } = renderHook(() => useDashboardLayout())
    const idsBefore = result.current.dashboards.map((d) => d.id)
    const activeBefore = result.current.activeId

    act(() => {
      result.current.applyRolePreset('maintainer')
    })

    expect(result.current.dashboards.map((d) => d.id)).toEqual(idsBefore)
    expect(result.current.dashboards).toHaveLength(idsBefore.length)
    expect(result.current.activeId).toBe(activeBefore)
  })

  it('builds a layout item for every widget at every breakpoint', () => {
    const { result } = renderHook(() => useDashboardLayout())

    act(() => {
      result.current.applyRolePreset('owner')
    })

    const { widgets, layouts } = result.current.activeDashboard
    const instanceIds = new Set(widgets.map((w) => w.id))
    for (const [breakpoint, items] of Object.entries(layouts)) {
      expect(items.length, breakpoint).toBe(widgets.length)
      for (const item of items) {
        expect(instanceIds.has(item.i), `${breakpoint}:${item.i}`).toBe(true)
      }
    }
  })

  it('records the applied role so the Help panel can stop saying "chosen"', () => {
    const { result } = renderHook(() => useDashboardLayout())
    expect(getAppliedDashboardPresetRole()).toBeNull()

    act(() => {
      result.current.applyRolePreset('fleet_operator')
    })

    expect(getAppliedDashboardPresetRole()).toBe('fleet_operator')
  })

  // ── The applied marker must track the LIVE layout, not the last apply ────
  //
  // A one-shot marker survived undo, dashboard switch, backend hydration and
  // manual widget edits, so the Help panel kept claiming "Selected" for a
  // layout that no longer existed.

  it('clears the applied marker when the preset application is undone', () => {
    const { result } = renderHook(() => useDashboardLayout())
    act(() => {
      result.current.applyRolePreset('energy_analyst')
    })
    expect(getAppliedDashboardPresetRole()).toBe('energy_analyst')

    act(() => {
      result.current.undo()
    })

    expect(getAppliedDashboardPresetRole()).toBeNull()
  })

  it('restores the applied marker when the undo is redone', () => {
    const { result } = renderHook(() => useDashboardLayout())
    act(() => {
      result.current.applyRolePreset('energy_analyst')
    })
    act(() => {
      result.current.undo()
    })
    act(() => {
      result.current.redo()
    })

    expect(getAppliedDashboardPresetRole()).toBe('energy_analyst')
  })

  it('clears the applied marker when a single widget is removed', () => {
    const { result } = renderHook(() => useDashboardLayout())
    act(() => {
      result.current.applyRolePreset('maintainer')
    })
    expect(getAppliedDashboardPresetRole()).toBe('maintainer')

    const victim = result.current.activeDashboard.widgets[0]
    act(() => {
      result.current.removeWidget(victim.id)
    })

    // The layout is now the user's own composition, not the preset's.
    expect(getAppliedDashboardPresetRole()).toBeNull()
  })

  it('clears the applied marker after switching to a non-matching dashboard', () => {
    const { result } = renderHook(() => useDashboardLayout())
    act(() => {
      result.current.applyRolePreset('owner')
    })
    expect(getAppliedDashboardPresetRole()).toBe('owner')

    let createdId = ''
    act(() => {
      createdId = result.current.createDashboard('Scratch') ?? ''
    })
    act(() => {
      result.current.switchDashboard(createdId)
    })

    expect(result.current.activeId).toBe(createdId)
    expect(getAppliedDashboardPresetRole()).toBeNull()
  })

  it('is order-insensitive — dragging widgets around does not clear the marker', () => {
    const { result } = renderHook(() => useDashboardLayout())
    act(() => {
      result.current.applyRolePreset('owner')
    })

    // Reordering is a layout concern, not a composition change.
    const reversed = [...result.current.activeDashboard.widgets].reverse()
    expect(resolveAppliedPresetRole(reversed.map((w) => w.widgetId))).toBe('owner')
  })

  it('preserves the instance id of a widget the preset keeps', () => {
    const { result } = renderHook(() => useDashboardLayout())

    // `vehicle-hero` is in both the seeded default and the owner preset.
    const kept = result.current.activeDashboard.widgets.find(
      (w) => w.widgetId === 'vehicle-hero',
    )
    expect(kept).toBeDefined()

    act(() => {
      result.current.applyRolePreset('owner')
    })

    const after = result.current.activeDashboard.widgets.find(
      (w) => w.widgetId === 'vehicle-hero',
    )
    // Same instance id ⇒ reconcileLayouts matched it and kept its geometry.
    expect(after?.id).toBe(kept?.id)
  })

  it('only emits widget ids that exist in the widget registry', () => {
    const known = new Set(WIDGET_REGISTRY.map((w) => w.id))
    const { result } = renderHook(() => useDashboardLayout())

    act(() => {
      result.current.applyRolePreset('maintainer')
    })

    for (const widget of result.current.activeDashboard.widgets) {
      expect(known.has(widget.widgetId), widget.widgetId).toBe(true)
    }
  })

  it('is a no-op for an unknown role and leaves the dashboard untouched', () => {
    const { result } = renderHook(() => useDashboardLayout())
    const before = result.current.activeDashboard.widgets.map((w) => w.widgetId)

    let applied = true
    act(() => {
      applied = result.current.applyRolePreset(
        'captain' as unknown as Parameters<typeof result.current.applyRolePreset>[0],
      )
    })

    expect(applied).toBe(false)
    expect(result.current.activeDashboard.widgets.map((w) => w.widgetId)).toEqual(before)
    expect(getAppliedDashboardPresetRole()).toBeNull()
  })

  it('is undoable — the previous composition is pushed onto the undo stack', () => {
    const { result } = renderHook(() => useDashboardLayout())
    const before = result.current.activeDashboard.widgets.map((w) => w.widgetId)

    act(() => {
      result.current.applyRolePreset('energy_analyst')
    })
    expect(result.current.canUndo).toBe(true)

    act(() => {
      result.current.undo()
    })
    expect(result.current.activeDashboard.widgets.map((w) => w.widgetId)).toEqual(before)
  })
})

describe('preset matching — set semantics', () => {
  it('matches a layout containing exactly the preset widgets in any order', () => {
    const ids = presetWidgetIds('owner')
    expect(layoutMatchesPreset('owner', ids)).toBe(true)
    expect(layoutMatchesPreset('owner', [...ids].reverse())).toBe(true)
  })

  it('does not match when a widget is missing or added', () => {
    const ids = presetWidgetIds('owner')
    expect(layoutMatchesPreset('owner', ids.slice(1))).toBe(false)
    expect(layoutMatchesPreset('owner', [...ids, 'quick-nav', 'alert-feed'])).toBe(false)
  })

  it('does not match a different role’s composition', () => {
    expect(layoutMatchesPreset('owner', presetWidgetIds('maintainer'))).toBe(false)
  })

  it('is null-safe and rejects unknown roles', () => {
    expect(layoutMatchesPreset('owner', null)).toBe(false)
    expect(layoutMatchesPreset('owner', undefined)).toBe(false)
    expect(layoutMatchesPreset('captain', presetWidgetIds('owner'))).toBe(false)
  })

  it('resolves the matching role, or null for a bespoke layout', () => {
    expect(resolveAppliedPresetRole(presetWidgetIds('maintainer'))).toBe('maintainer')
    expect(resolveAppliedPresetRole(['battery-gauge'])).toBeNull()
    expect(resolveAppliedPresetRole([])).toBeNull()
  })
})
