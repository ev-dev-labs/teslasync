/**
 * HELP-11 end-to-end preset adoption (correction round).
 *
 * ## The bug this file exists to prevent
 *
 * "Pending" used to be derived as `preference !== appliedMarker`. Once the
 * applied marker became *derived from the live widget set*, that expression
 * stayed permanently true after any customisation — the preference still said
 * `owner`, the layout no longer matched, so every subsequent DashboardPage
 * mount concluded "pending" and silently re-applied the preset. Navigating to
 * the dashboard restored widgets the user had deleted, reversed their undo,
 * and overwrote whichever dashboard they had switched to.
 *
 * The existing DashboardPage suite could not catch it: it mocks
 * `useDashboardLayout` and never mounts the page twice. This file uses the
 * REAL hook and the REAL page and remounts — the only way the defect is
 * visible. Only leaf UI and network are stubbed; every piece of adoption logic
 * (`consumePendingDashboardPreset` → `applyRolePreset` → reconciliation) runs
 * for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

import {
  chooseDashboardPreset,
  getAppliedDashboardPresetRole,
  hasPendingDashboardPreset,
  peekPendingDashboardPreset,
  presetWidgetIds,
  requestDashboardPresetApplication,
} from '@/lib/dashboardPresets'

// ── i18n: echo the English fallback ───────────────────────────────────
vi.mock('react-i18next', () => {
  const translate = (key: string, arg2?: unknown) =>
    typeof arg2 === 'string' ? arg2 : key
  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => {} },
  }
})

// ── Network-backed hooks ──────────────────────────────────────────────
vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    // At least one vehicle: the widget grid only renders for a non-empty
    // fleet, and the grid is the surface whose composition these tests assert.
    useVehicles: () => ({
      data: [
        {
          id: 1,
          vehicle_id: 1,
          vin: '5YJ3E1EA7KF000001',
          display_name: 'Test Car',
          state: 'online',
          healthy: true,
        },
      ],
      isLoading: false,
    }),
    useSyncVehicles: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

vi.mock('@/api/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useAuthStatus: () => ({ data: { authenticated: true }, isLoading: false }),
    // The real layout hook uses these; keep them inert so nothing is persisted
    // to a backend during the test.
    useDashboardLayouts: () => ({ data: undefined }),
    useSaveDashboardLayouts: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

vi.mock('@/hooks/useRealtimeEvents', () => ({ useRealtimeEvents: () => undefined }))
vi.mock('@/lib/broadcast', () => ({ broadcast: vi.fn(), subscribe: () => () => undefined }))

vi.mock('@/components/ui/ThemeProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useTheme: () => ({
      themeId: 'neon-cyan',
      modeId: 'dark',
      theme: {},
      mode: {},
      setTheme: vi.fn(),
      setMode: vi.fn(),
      setCustomColors: vi.fn(),
      themes: {},
      modes: {},
    }),
  }
})

// NOTE: `useDashboardLayout` is deliberately NOT mocked — it is the code under
// test. Only its sibling hooks are.
vi.mock('../../hooks/useKioskMode', () => ({
  useKioskMode: () => ({
    config: { enabled: false },
    updateConfig: vi.fn(),
    isKiosk: false,
    enterKiosk: vi.fn(),
    exitKiosk: vi.fn(),
  }),
}))
vi.mock('../../hooks/useLayoutKeyboard', () => ({ useLayoutKeyboard: () => undefined }))
vi.mock('@/features/onboarding/checklist', () => ({
  markCustomizeDashboardCompleted: vi.fn(),
}))
vi.mock('@/components/feedback/LiveStaleDataBanner', () => ({
  LiveStaleDataBanner: () => null,
}))

// ── Heavy leaf components → inert stubs ───────────────────────────────
vi.mock('../../components/DashboardGrid', () => ({
  DashboardGrid: () => <div data-testid="dashboard-grid" />,
}))
vi.mock('../../components/WidgetPicker', () => ({ WidgetPicker: () => null }))
vi.mock('../../components/WidgetSettingsModal', () => ({ WidgetSettingsModal: () => null }))
vi.mock('../../components/LayoutManager', () => ({ LayoutManager: () => null }))
vi.mock('../../components/LayoutSwitcher', () => ({ LayoutSwitcher: () => null }))
vi.mock('../../components/TemplateGallery', () => ({ TemplateGallery: () => null }))
vi.mock('../../components/ExportModal', () => ({ ExportModal: () => null }))
vi.mock('../../components/ImportPreviewModal', () => ({ ImportPreviewModal: () => null }))
vi.mock('../../components/DashboardSettingsModal', () => ({
  DashboardSettingsModal: () => null,
}))
vi.mock('../../components/KioskSettingsModal', () => ({ KioskSettingsModal: () => null }))
vi.mock('../../components/AddWidgetButton', () => ({ AddWidgetButton: () => null }))
vi.mock('../../components/WidgetCatalogueDialog', () => ({
  WidgetCatalogueDialog: () => null,
}))
vi.mock('../../components/FleetOperationsBrief', () => ({
  FleetOperationsBrief: () => null,
}))

import DashboardPage from '../DashboardPage'
import { useDashboardLayout } from '../../hooks/useDashboardLayout'

const DASHBOARDS_KEY = 'teslasync-dashboards'
const ACTIVE_KEY = 'teslasync-active-dashboard'

/** Mount the real page, as the router does. */
function mountDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * Widget ids on the persisted ACTIVE dashboard.
 *
 * Read from localStorage rather than the DOM because the grid is stubbed —
 * this is the same store the next mount hydrates from, so it is exactly what a
 * remount would see.
 */
function persistedActiveWidgetIds(): string[] {
  const raw = window.localStorage.getItem(DASHBOARDS_KEY)
  if (!raw) return []
  const dashboards = JSON.parse(raw) as Array<{
    id: string
    widgets: Array<{ widgetId: string }>
  }>
  const activeId = window.localStorage.getItem(ACTIVE_KEY)
  const active = dashboards.find((d) => d.id === activeId) ?? dashboards[0]
  return (active?.widgets ?? []).map((w) => w.widgetId)
}

function persistedDashboardIds(): string[] {
  const raw = window.localStorage.getItem(DASHBOARDS_KEY)
  if (!raw) return []
  return (JSON.parse(raw) as Array<{ id: string }>).map((d) => d.id)
}

/**
 * Drive the real layout hook directly for edits the stubbed UI cannot make.
 *
 * Steps run against ONE mounted instance, each in its own `act()` with the API
 * re-read in between. That matters for undo/redo: the undo stack lives in the
 * hook's own state, not in localStorage, so two separate mounts would each
 * start with an empty history and `undo()` would silently no-op.
 */
function withLayout(...steps: Array<(api: ReturnType<typeof useDashboardLayout>) => void>) {
  let api: ReturnType<typeof useDashboardLayout> | null = null
  function Probe() {
    api = useDashboardLayout()
    return null
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  for (const step of steps) {
    act(() => {
      step(api!)
    })
  }
  utils.unmount()
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('preset adoption — one-shot across real DashboardPage mounts', () => {
  it('applies once on the first mount after the user chooses a role', () => {
    act(() => {
      chooseDashboardPreset('owner')
    })
    expect(hasPendingDashboardPreset()).toBe(true)

    mountDashboard()

    expect(screen.getByTestId('dashboard-grid')).toBeInTheDocument()
    expect(persistedActiveWidgetIds()).toEqual(presetWidgetIds('owner'))
    expect(getAppliedDashboardPresetRole()).toBe('owner')
    // The one-shot request is spent.
    expect(hasPendingDashboardPreset()).toBe(false)
  })

  it('does NOT restore a removed widget on the next mount', () => {
    // THE regression: choose → apply → customise → navigate away → come back.
    act(() => {
      chooseDashboardPreset('owner')
    })
    mountDashboard()
    cleanup()

    let removedWidgetId = ''
    withLayout((api) => {
      const victim = api.activeDashboard.widgets[0]
      removedWidgetId = victim.widgetId
      api.removeWidget(victim.id)
    })

    const afterRemoval = persistedActiveWidgetIds()
    expect(afterRemoval).not.toContain(removedWidgetId)
    expect(getAppliedDashboardPresetRole()).toBeNull()
    // The preference is retained for the Help UI — but it is NOT an instruction.
    expect(hasPendingDashboardPreset()).toBe(false)

    mountDashboard()

    expect(persistedActiveWidgetIds()).toEqual(afterRemoval)
    expect(persistedActiveWidgetIds()).not.toContain(removedWidgetId)
  })

  it('preserves an undo across a remount', () => {
    act(() => {
      chooseDashboardPreset('energy_analyst')
    })
    mountDashboard()
    cleanup()
    expect(persistedActiveWidgetIds()).toEqual(presetWidgetIds('energy_analyst'))

    // Apply + undo must share one hook instance: the undo stack is component
    // state, so a fresh mount starts with an empty history. This reproduces
    // "the user undid the preset on the dashboard".
    withLayout(
      (api) => api.applyRolePreset('owner'),
      (api) => api.undo(),
    )
    const afterUndo = persistedActiveWidgetIds()
    expect(afterUndo).toEqual(presetWidgetIds('energy_analyst'))
    expect(getAppliedDashboardPresetRole()).toBe('energy_analyst')

    // No pending request survives, so returning to the dashboard changes nothing.
    expect(hasPendingDashboardPreset()).toBe(false)
    mountDashboard()

    expect(persistedActiveWidgetIds()).toEqual(afterUndo)
  })

  it('does not re-apply after an undo that leaves a non-matching layout', () => {
    act(() => {
      chooseDashboardPreset('owner')
    })
    mountDashboard()
    cleanup()

    // Remove a widget, then undo the removal, then remove again — ending on a
    // layout that matches no preset while the preference still says `owner`.
    withLayout(
      (api) => api.removeWidget(api.activeDashboard.widgets[0].id),
      (api) => api.removeWidget(api.activeDashboard.widgets[0].id),
    )
    const customised = persistedActiveWidgetIds()
    expect(customised).not.toEqual(presetWidgetIds('owner'))
    expect(getAppliedDashboardPresetRole()).toBeNull()

    mountDashboard()

    expect(persistedActiveWidgetIds()).toEqual(customised)
  })

  it('does not overwrite a different dashboard after switching', () => {
    act(() => {
      chooseDashboardPreset('owner')
    })
    mountDashboard()
    cleanup()

    let scratchId = ''
    withLayout(
      (api) => {
        scratchId = api.createDashboard('Scratch') ?? ''
      },
      (api) => api.switchDashboard(scratchId),
    )

    const scratchWidgets = persistedActiveWidgetIds()
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBe(scratchId)

    mountDashboard()

    // Dashboard B is untouched by the remount.
    expect(window.localStorage.getItem(ACTIVE_KEY)).toBe(scratchId)
    expect(persistedActiveWidgetIds()).toEqual(scratchWidgets)
    expect(persistedActiveWidgetIds()).not.toEqual(presetWidgetIds('owner'))
  })

  it('never clones a dashboard — identity and count are preserved', () => {
    act(() => {
      chooseDashboardPreset('maintainer')
    })
    mountDashboard()
    const idsAfterApply = persistedDashboardIds()
    expect(idsAfterApply).toHaveLength(1)
    cleanup()

    mountDashboard()

    expect(persistedDashboardIds()).toEqual(idsAfterApply)
  })

  it('selecting a DIFFERENT role queues exactly one new application', () => {
    act(() => {
      chooseDashboardPreset('owner')
    })
    const first = peekPendingDashboardPreset()
    mountDashboard()
    cleanup()
    expect(hasPendingDashboardPreset()).toBe(false)

    act(() => {
      chooseDashboardPreset('maintainer')
    })
    const second = peekPendingDashboardPreset()
    expect(second?.role).toBe('maintainer')
    // A distinguishable event, not a re-read of the old one.
    expect(second?.nonce).not.toBe(first?.nonce)

    mountDashboard()

    expect(persistedActiveWidgetIds()).toEqual(presetWidgetIds('maintainer'))
    expect(hasPendingDashboardPreset()).toBe(false)
  })

  it('applies an explicit re-apply exactly once, then stops', () => {
    act(() => {
      chooseDashboardPreset('owner')
    })
    mountDashboard()
    cleanup()

    withLayout((api) => {
      api.removeWidget(api.activeDashboard.widgets[0].id)
    })
    expect(getAppliedDashboardPresetRole()).toBeNull()

    // The explicit action the Help panel exposes once the layout diverges.
    act(() => {
      requestDashboardPresetApplication('owner')
    })
    expect(hasPendingDashboardPreset()).toBe(true)

    mountDashboard()
    expect(persistedActiveWidgetIds()).toEqual(presetWidgetIds('owner'))
    expect(getAppliedDashboardPresetRole()).toBe('owner')
    cleanup()

    // …and it does not keep re-applying afterwards.
    withLayout((api) => {
      api.removeWidget(api.activeDashboard.widgets[0].id)
    })
    const customised = persistedActiveWidgetIds()

    mountDashboard()
    expect(persistedActiveWidgetIds()).toEqual(customised)
  })

  it('unchoosing a preset cancels a queued application', () => {
    act(() => {
      chooseDashboardPreset('owner')
    })
    expect(hasPendingDashboardPreset()).toBe(true)

    act(() => {
      chooseDashboardPreset(null)
    })
    expect(hasPendingDashboardPreset()).toBe(false)

    mountDashboard()

    expect(persistedActiveWidgetIds()).not.toEqual(presetWidgetIds('owner'))
    expect(getAppliedDashboardPresetRole()).toBeNull()
  })

  it('does nothing at all when no preset was ever chosen', () => {
    mountDashboard()
    cleanup()

    // Nothing was requested, so nothing was applied — the page must not have
    // written a preset composition, and must claim no applied role.
    expect(getAppliedDashboardPresetRole()).toBeNull()
    const afterFirst = persistedActiveWidgetIds()
    expect(afterFirst).not.toEqual(presetWidgetIds('owner'))

    mountDashboard()

    expect(persistedActiveWidgetIds()).toEqual(afterFirst)
    expect(getAppliedDashboardPresetRole()).toBeNull()
  })
})
