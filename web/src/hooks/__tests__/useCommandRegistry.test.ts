import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

/**
 * useCommandRegistry wires the pure, declarative command registry to live React
 * handles (navigate / theme / toast / queryClient / i18n). We mock only those
 * *provider* seams — the registry and scorer under test stay real — so we can
 * assert the exact side effect each command fires when invoked.
 *
 * Every mocked hook returns a *stable* reference so the hook's useMemo/useCallback
 * memoisation is exercised faithfully (a fresh object per render would defeat it).
 */
const mocks = vi.hoisted(() => {
  const navigate = vi.fn()
  const setMode = vi.fn()
  const setTheme = vi.fn()
  const setVehicleId = vi.fn()
  const invalidateQueries = vi.fn(() => Promise.resolve())
  const toastSuccess = vi.fn()
  const toastError = vi.fn()
  const toastInfo = vi.fn()
  const t = (key: string, fallback?: unknown): string => {
    if (typeof fallback === 'string') return fallback
    if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) {
      return String((fallback as { defaultValue: unknown }).defaultValue)
    }
    return key
  }
  return {
    navigate,
    setMode,
    setTheme,
    setVehicleId,
    invalidateQueries,
    toastSuccess,
    toastError,
    toastInfo,
    t,
    // Stable objects handed back by the provider hooks.
    queryClient: { invalidateQueries },
    theme: { setMode, setTheme },
    toast: { success: toastSuccess, error: toastError, info: toastInfo },
    vehicleStore: { vehicleId: null as number | null, setVehicleId },
  }
})

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mocks.navigate }
})

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return { ...actual, useQueryClient: () => mocks.queryClient }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return { ...actual, useTranslation: () => ({ t: mocks.t }) }
})

vi.mock('@/components/ui/ThemeProvider', () => ({ useTheme: () => mocks.theme }))
vi.mock('@/components/feedback/Toast', () => ({ useToast: () => mocks.toast }))
vi.mock('@/store/selectedVehicle', () => ({
  useSelectedVehicleStore: () => mocks.vehicleStore,
}))

import { useCommandRegistry } from '../useCommandRegistry'
import { commandRegistry, scoreCommand } from '@/lib/commandRegistry'

afterEach(() => {
  vi.clearAllMocks()
})

function mount() {
  return renderHook(() => useCommandRegistry())
}

describe('useCommandRegistry', () => {
  describe('commands', () => {
    it('resolves one ResolvedCommand per registry entry, all tagged as registry source', () => {
      const { result } = mount()
      const { commands } = result.current

      expect(commands).toHaveLength(commandRegistry.length)
      expect(commands.every((c) => c.source === 'registry')).toBe(true)
      // keywords are always a real array (def.keywords ?? []) — safe to .map/.filter.
      expect(commands.every((c) => Array.isArray(c.keywords))).toBe(true)
      // every label is a non-empty resolved string, never the raw i18n key stub.
      expect(commands.every((c) => typeof c.label === 'string' && c.label.length > 0)).toBe(true)
    })

    it('resolves labels via t() fallback and preserves id/section/icon', () => {
      const { result } = mount()
      const dark = result.current.commands.find((c) => c.id === 'pref.theme.dark')

      expect(dark).toBeDefined()
      expect(dark?.label).toBe('Theme: Dark')
      expect(dark?.section).toBe('preferences')
      expect(dark?.icon).toBeDefined()
    })

    it('exposes shortcut hints only where the registry defines them', () => {
      const { result } = mount()
      const themePicker = result.current.commands.find((c) => c.id === 'pref.themePicker')
      const settings = result.current.commands.find((c) => c.id === 'action.settings')

      expect(themePicker?.shortcut).toBe('T')
      expect(settings?.shortcut).toBeUndefined()
    })
  })

  describe('getById', () => {
    it('returns the matching command by stable id', () => {
      const { result } = mount()
      const cmd = result.current.getById('action.settings')

      expect(cmd?.id).toBe('action.settings')
      expect(cmd?.label).toBe('Open settings')
    })

    it('returns undefined for an unknown id', () => {
      const { result } = mount()
      expect(result.current.getById('does.not.exist')).toBeUndefined()
    })
  })

  describe('filter', () => {
    it('returns the full, unfiltered list for empty or whitespace-only queries', () => {
      const { result } = mount()

      expect(result.current.filter('')).toHaveLength(commandRegistry.length)
      expect(result.current.filter('   ')).toHaveLength(commandRegistry.length)
    })

    it('ranks an exact label match ahead of weaker matches', () => {
      const { result } = mount()
      const matches = result.current.filter('Open settings')

      expect(matches.length).toBeGreaterThan(0)
      expect(matches[0].id).toBe('action.settings')
    })

    it('matches on keywords, not just labels', () => {
      const { result } = mount()
      // "night" is a keyword of pref.theme.dark but appears in no label.
      const ids = result.current.filter('night').map((c) => c.id)

      expect(ids).toContain('pref.theme.dark')
    })

    it('returns results sorted by descending relevance score', () => {
      const { result } = mount()
      const matches = result.current.filter('theme')

      expect(matches.length).toBeGreaterThan(1)
      const scores = matches.map((c) => scoreCommand('theme', c.label, c.keywords))
      const descending = [...scores].sort((a, b) => b - a)
      expect(scores).toEqual(descending)
    })

    it('returns an empty array when nothing matches', () => {
      const { result } = mount()
      expect(result.current.filter('zzzzzz-no-such-command')).toEqual([])
    })
  })

  describe('invoke wires each command to live context', () => {
    it('dispatches setMode for a theme-mode command', () => {
      const { result } = mount()
      void result.current.getById('pref.theme.dark')!.invoke()

      expect(mocks.setMode).toHaveBeenCalledWith('dark')
      expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it('navigates for a page/action command', () => {
      const { result } = mount()
      void result.current.getById('action.settings')!.invoke()

      expect(mocks.navigate).toHaveBeenCalledWith('/settings')
    })

    it('switches theme and surfaces a toast for a named-theme command', () => {
      const { result } = mount()
      void result.current.getById('pref.theme.teslaRed')!.invoke()

      expect(mocks.setTheme).toHaveBeenCalledWith('tesla-red')
      expect(mocks.toastInfo).toHaveBeenCalledWith('Switched to Tesla Red')
    })

    it('invalidates all queries then toasts success on refresh', async () => {
      const { result } = mount()
      await result.current.getById('action.refresh')!.invoke()

      expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1)
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Data refreshed')
    })

    it('propagates a rejection from invalidateAll and skips the success toast', async () => {
      mocks.invalidateQueries.mockRejectedValueOnce(new Error('offline'))
      const { result } = mount()

      await expect(result.current.getById('action.refresh')!.invoke()).rejects.toThrow('offline')
      expect(mocks.toastSuccess).not.toHaveBeenCalled()
    })

    it('dispatches a decoupled window event for the feedback command', () => {
      const listener = vi.fn()
      window.addEventListener('open-feedback-modal', listener)

      const { result } = mount()
      void result.current.getById('feedback.open')!.invoke()

      expect(listener).toHaveBeenCalledTimes(1)
      window.removeEventListener('open-feedback-modal', listener)
    })
  })

  describe('referential stability', () => {
    it('keeps commands/getById/filter stable across renders when inputs are unchanged', () => {
      const { result, rerender } = mount()
      const first = result.current

      rerender()

      expect(result.current.commands).toBe(first.commands)
      expect(result.current.getById).toBe(first.getById)
      expect(result.current.filter).toBe(first.filter)
    })
  })
})
