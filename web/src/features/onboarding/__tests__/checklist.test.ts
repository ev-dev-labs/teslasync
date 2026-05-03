import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ── Mock react-i18next ──────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

// ── Mock data hooks ─────────────────────────────────────────────────────────
let mockVehicles: { id: number }[] = []
let mockAlertRules: { id: number }[] = []
let mockChannels: { id: number }[] = []
let mockThemeId = 'neon-cyan'

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: mockVehicles }),
}))

vi.mock('@/api/hooks/useNotifications', () => ({
  useAlertRules: () => ({ data: mockAlertRules }),
  useNotificationChannels: () => ({ data: mockChannels }),
}))

vi.mock('@/components/ui/ThemeProvider', () => ({
  useTheme: () => ({ themeId: mockThemeId }),
}))

import {
  CHECKLIST_DISMISSED_KEY,
  CHECKLIST_COMPLETED_AT_KEY,
  CP_DISCOVERED_KEY,
  CUSTOMIZE_DASHBOARD_KEY,
  CELEBRATION_WINDOW_MS,
  COMMAND_PALETTE_CTA,
  isChecklistDismissed,
  isCommandPaletteDiscovered,
  isCustomizeDashboardCompleted,
  markCommandPaletteDiscovered,
  markCustomizeDashboardCompleted,
  restartChecklist,
  setChecklistCompletedAt,
  setChecklistDismissed,
  shouldHideChecklist,
  useChecklistTasks,
} from '../checklist'

beforeEach(() => {
  localStorage.clear()
  mockVehicles = []
  mockAlertRules = []
  mockChannels = []
  mockThemeId = 'neon-cyan'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('checklist storage helpers', () => {
  it('marks command palette as discovered', () => {
    expect(isCommandPaletteDiscovered()).toBe(false)
    markCommandPaletteDiscovered()
    expect(isCommandPaletteDiscovered()).toBe(true)
    expect(localStorage.getItem(CP_DISCOVERED_KEY)).toBe('1')
  })

  it('is idempotent — repeated mark calls do not crash or duplicate', () => {
    markCommandPaletteDiscovered()
    markCommandPaletteDiscovered()
    markCommandPaletteDiscovered()
    expect(localStorage.getItem(CP_DISCOVERED_KEY)).toBe('1')
  })

  it('round-trips dismissed state through localStorage', () => {
    expect(isChecklistDismissed()).toBe(false)
    setChecklistDismissed(true)
    expect(isChecklistDismissed()).toBe(true)
    expect(localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBe('1')
    setChecklistDismissed(false)
    expect(isChecklistDismissed()).toBe(false)
    expect(localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBeNull()
  })

  it('restartChecklist clears dismissed and completedAt flags', () => {
    setChecklistDismissed(true)
    setChecklistCompletedAt(123456789)
    restartChecklist()
    expect(isChecklistDismissed()).toBe(false)
    expect(localStorage.getItem(CHECKLIST_COMPLETED_AT_KEY)).toBeNull()
  })

  it('exposes the command-palette sentinel for the widget to intercept', () => {
    expect(COMMAND_PALETTE_CTA).toBe('#open-command-palette')
  })
})

describe('shouldHideChecklist', () => {
  it('hides when dismissed regardless of completion', () => {
    expect(
      shouldHideChecklist({
        dismissed: true,
        allComplete: false,
        completedAt: null,
      }),
    ).toBe(true)
  })

  it('keeps the celebration visible inside the 24h window', () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000
    expect(
      shouldHideChecklist({
        dismissed: false,
        allComplete: true,
        completedAt: tenMinutesAgo,
      }),
    ).toBe(false)
  })

  it('hides after the 24h celebration window has elapsed', () => {
    const longAgo = Date.now() - (CELEBRATION_WINDOW_MS + 60_000)
    expect(
      shouldHideChecklist({
        dismissed: false,
        allComplete: true,
        completedAt: longAgo,
      }),
    ).toBe(true)
  })

  it('does not hide when incomplete', () => {
    expect(
      shouldHideChecklist({
        dismissed: false,
        allComplete: false,
        completedAt: null,
      }),
    ).toBe(false)
  })

  it('does not hide if 100% but completedAt is unrecorded', () => {
    // Defensive: if the writer effect failed, still show the widget so the
    // user gets the celebration the next time.
    expect(
      shouldHideChecklist({
        dismissed: false,
        allComplete: true,
        completedAt: null,
      }),
    ).toBe(false)
  })
})

describe('useChecklistTasks', () => {
  it('returns the default 7 tasks all incomplete on a fresh install', () => {
    const { result } = renderHook(() => useChecklistTasks())
    expect(result.current.totalCount).toBe(7)
    expect(result.current.completeCount).toBe(0)
    expect(result.current.allComplete).toBe(false)
    expect(result.current.tasks.map((task) => task.id)).toEqual([
      'connect-vehicle',
      'pick-theme',
      'first-alert',
      'notification-channel',
      'try-command-palette',
      'enable-push',
      'customize-dashboard',
    ])
    for (const task of result.current.tasks) {
      expect(task.complete).toBe(false)
    }
  })

  it('marks connect-vehicle complete when at least one vehicle exists', () => {
    mockVehicles = [{ id: 1 }]
    const { result } = renderHook(() => useChecklistTasks())
    const task = result.current.tasks.find((entry) => entry.id === 'connect-vehicle')
    expect(task?.complete).toBe(true)
    expect(result.current.completeCount).toBe(1)
  })

  it('marks pick-theme complete when themeId differs from the default', () => {
    mockThemeId = 'tesla-red'
    const { result } = renderHook(() => useChecklistTasks())
    const task = result.current.tasks.find((entry) => entry.id === 'pick-theme')
    expect(task?.complete).toBe(true)
  })

  it('marks first-alert complete when at least one alert rule exists', () => {
    mockAlertRules = [{ id: 1 }]
    const { result } = renderHook(() => useChecklistTasks())
    const task = result.current.tasks.find((entry) => entry.id === 'first-alert')
    expect(task?.complete).toBe(true)
  })

  it('marks notification-channel complete when at least one channel exists', () => {
    mockChannels = [{ id: 1 }]
    const { result } = renderHook(() => useChecklistTasks())
    const task = result.current.tasks.find((entry) => entry.id === 'notification-channel')
    expect(task?.complete).toBe(true)
  })

  it('marks try-command-palette complete when the discovered flag is set', () => {
    localStorage.setItem(CP_DISCOVERED_KEY, '1')
    const { result } = renderHook(() => useChecklistTasks())
    const task = result.current.tasks.find((entry) => entry.id === 'try-command-palette')
    expect(task?.complete).toBe(true)
  })

  it('marks customize-dashboard complete when the dashboard customization flag is set', () => {
    // Phase-45 / Prompt 25: flag is flipped by the WidgetCatalogueDialog when
    // the user adds their first widget; the task ticks over on the next
    // render of the checklist.
    expect(isCustomizeDashboardCompleted()).toBe(false)
    markCustomizeDashboardCompleted()
    expect(isCustomizeDashboardCompleted()).toBe(true)
    expect(localStorage.getItem(CUSTOMIZE_DASHBOARD_KEY)).toBe('1')
    const { result } = renderHook(() => useChecklistTasks())
    const task = result.current.tasks.find((entry) => entry.id === 'customize-dashboard')
    expect(task?.complete).toBe(true)
  })

  it('exposes a stable visibleTasks list equal to tasks (no gating yet)', () => {
    const { result } = renderHook(() => useChecklistTasks())
    expect(result.current.visibleTasks).toEqual(result.current.tasks)
  })

  it('records completedAt the first time all tasks complete', async () => {
    mockVehicles = [{ id: 1 }]
    mockAlertRules = [{ id: 1 }]
    mockChannels = [{ id: 1 }]
    mockThemeId = 'tesla-red'
    localStorage.setItem(CP_DISCOVERED_KEY, '1')
    localStorage.setItem(CUSTOMIZE_DASHBOARD_KEY, '1')
    // Web push needs both `serviceWorker` in navigator and Notification grant.
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: { permission: 'granted' },
    })
    // jsdom doesn't ship a ServiceWorker — patch it for the gate.
    if (!('serviceWorker' in navigator)) {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {},
      })
    }

    const { result } = renderHook(() => useChecklistTasks())
    expect(result.current.allComplete).toBe(true)
    // Effect runs after mount — flush microtasks.
    await act(async () => {
      await Promise.resolve()
    })
    const stamp = localStorage.getItem(CHECKLIST_COMPLETED_AT_KEY)
    expect(stamp).not.toBeNull()
    expect(Number(stamp)).toBeGreaterThan(0)
  })

  it('restart() exposed by the hook clears the dismissed/completedAt flags', async () => {
    setChecklistDismissed(true)
    setChecklistCompletedAt(Date.now())
    const { result } = renderHook(() => useChecklistTasks())
    act(() => {
      result.current.restart()
    })
    expect(localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBeNull()
    expect(localStorage.getItem(CHECKLIST_COMPLETED_AT_KEY)).toBeNull()
  })

  it('dismiss() exposed by the hook persists the flag', () => {
    const { result } = renderHook(() => useChecklistTasks())
    act(() => {
      result.current.dismiss()
    })
    expect(localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBe('1')
  })
})
