/**
 * AppearanceSettings — behavioural contract for the Appearance settings panel.
 *
 * The panel wires together three kinds of preference stores, and the tests
 * drive each end-to-end rather than smoke-rendering:
 *
 *   • Server-backed (density / time-format / chart-palette) — persisted via the
 *     full-replace `PUT /settings` endpoint through the real `useSaveSettings`
 *     hook. `@/api/client`'s `request` is mocked so we can assert the exact
 *     wire shape (path + method + partial-merge body) and prove the
 *     `next === current` guard skips a redundant save.
 *   • localStorage-backed (sidebar-style / status-bar / celebration) — driven
 *     through the real `useSyncExternalStore` stores; assertions read both the
 *     rendered switch state and the persisted JSON.
 *   • Side-effecting (product tours) — `startTour` / `resetAllTours` are mocked
 *     so we assert the launcher is invoked with the right tour id.
 *
 * Notable coverage:
 *   • Regression guard for the "always icon-only" switch: while the status bar
 *     is hidden the row is aria-disabled and the control must be INERT — a
 *     stray click must not mutate a preference the user can't see take effect.
 *   • a11y: the density / time-format / chart-palette / sidebar groups expose
 *     `role="radiogroup"` with an accessible name and `role="radio"` +
 *     `aria-checked` options.
 *   • Degraded load: before settings resolve, the server-backed options are
 *     disabled and cannot issue a save.
 *
 * `ThemePicker` is stubbed (it owns its own ThemeProvider-backed test suite);
 * we only assert AppearanceSettings delegates to it with the expected props.
 * `react-i18next` is stubbed to echo the English default so assertions read
 * against real user-visible copy. user-event is not installed in this repo, so
 * interactions use `fireEvent` (matching the sibling settings tests).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>(
    '@/api/client',
  )
  return { ...actual, request: vi.fn() }
})

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const t = (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
    const fallback =
      typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
    const opts =
      typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
        ? (fallbackOrOpts as Record<string, unknown>)
        : (maybeOpts as Record<string, unknown> | undefined)
    let result =
      fallback ??
      (typeof opts?.defaultValue === 'string' ? opts.defaultValue : key)
    if (opts) {
      for (const [k, v] of Object.entries(opts)) {
        if (k === 'defaultValue') continue
        result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
      }
    }
    return result
  }
  return {
    ...actual,
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// ThemePicker owns a ThemeProvider-backed context + its own test suite; stub it
// so this unit isolates AppearanceSettings and asserts the delegated props.
vi.mock('@/components/ui/ThemePicker', () => ({
  ThemePicker: (props: { showMode?: boolean; showCustom?: boolean }) => (
    <div
      data-testid="theme-picker"
      data-show-mode={props.showMode ? 'true' : 'false'}
      data-show-custom={props.showCustom ? 'true' : 'false'}
    />
  ),
}))

vi.mock('@/lib/tourLauncher', () => ({ startTour: vi.fn() }))

vi.mock('@/lib/tourRegistry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tourRegistry')>(
    '@/lib/tourRegistry',
  )
  return { ...actual, resetAllTours: vi.fn() }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { getSidebarStyle, setSidebarStyle } from '@/hooks/useSidebarStyle'
import { setStatusBarPrefs } from '@/components/layout'
import { setAchievementCelebrationPrefs } from '@/hooks/useAchievementCelebrationPrefs'
import { startTour } from '@/lib/tourLauncher'
import { resetAllTours } from '@/lib/tourRegistry'
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors'
import type { AppSettings } from '@/api/types'
import { AppearanceSettings } from './AppearanceSettings'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>
const mockedStartTour = startTour as unknown as ReturnType<typeof vi.fn>
const mockedResetAllTours = resetAllTours as unknown as ReturnType<typeof vi.fn>

const SIDEBAR_KEY = 'teslasync:sidebar-style:v1'
const STATUSBAR_KEY = 'teslasync-status-bar-prefs'
const CELEBRATION_KEY = 'teslasync:achievement-celebration:v1'

const settingsFixture = {
  theme: 'neon-cyan',
  mode: 'dark',
  ui_density: 'comfortable',
  time_format_default: 'relative',
  chart_palette: 'cb_safe',
} satisfies Partial<AppSettings>

function renderPanel(initial: Partial<AppSettings> | null = settingsFixture) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  if (initial) qc.setQueryData(['settings'], initial)
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AppearanceSettings />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** Find the `role="switch"` button inside a `data-testid`-tagged Toggle. */
function switchIn(testId: string): HTMLElement {
  return within(screen.getByTestId(testId)).getByRole('switch')
}

function findPutCall() {
  return mockedRequest.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // Reset the module-scoped localStorage snapshots to their documented
  // defaults so each case is hermetic (these stores cache a snapshot at
  // import time and mutate it in place).
  setSidebarStyle('linear')
  setStatusBarPrefs({ enabled: true, iconOnly: false })
  setAchievementCelebrationPrefs({
    showToasts: true,
    playSound: false,
    showOnDashboard: true,
    pushOnUnlock: true,
  })
  mockedRequest.mockResolvedValue(settingsFixture)
})

describe('AppearanceSettings — structure & delegation', () => {
  it('renders the Appearance header and delegates to ThemePicker with both sections enabled', () => {
    renderPanel()
    expect(
      screen.getByRole('heading', { name: 'Appearance' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Customize colors and display mode'),
    ).toBeInTheDocument()
    const picker = screen.getByTestId('theme-picker')
    expect(picker).toHaveAttribute('data-show-mode', 'true')
    expect(picker).toHaveAttribute('data-show-custom', 'true')
  })

  it('renders every preference section label', () => {
    renderPanel()
    expect(screen.getByText('Information density')).toBeInTheDocument()
    expect(screen.getByText('Sidebar style')).toBeInTheDocument()
    expect(screen.getByText('Default time format')).toBeInTheDocument()
    expect(screen.getByText('Chart palette')).toBeInTheDocument()
    expect(screen.getByText('Status bar')).toBeInTheDocument()
    expect(screen.getByText('Celebration')).toBeInTheDocument()
  })

  it('exposes the four option groups as named radiogroups (a11y)', () => {
    renderPanel()
    expect(
      screen.getByRole('radiogroup', { name: 'Information density' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radiogroup', { name: 'Sidebar style' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radiogroup', { name: 'Default time format' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radiogroup', { name: 'Chart palette' }),
    ).toBeInTheDocument()
  })
})

describe('AppearanceSettings — information density', () => {
  it('reflects the persisted density as the checked radio', () => {
    renderPanel({ ...settingsFixture, ui_density: 'spacious' })
    const group = screen.getByRole('radiogroup', { name: 'Information density' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
    expect(within(group).getByRole('radio', { name: /Spacious/i })).toBeChecked()
    expect(
      within(group).getByRole('radio', { name: /Compact/i }),
    ).not.toBeChecked()
  })

  it('persists a new density via a full-merge PUT /settings', async () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Information density' })
    const compact = within(group).getByRole('radio', { name: /Compact/i })
    expect(compact).toBeEnabled()
    fireEvent.click(compact)

    await waitFor(() => expect(findPutCall()).toBeTruthy())
    const put = findPutCall()!
    expect(put[0]).toBe('/settings')
    expect((put[1] as RequestInit).method).toBe('PUT')
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({
      ...settingsFixture,
      ui_density: 'compact',
    })
  })

  it('does not issue a save when the already-active density is clicked', () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Information density' })
    fireEvent.click(within(group).getByRole('radio', { name: /Comfortable/i }))
    // Seeded cache + Infinity staleTime → no mount fetch, and the guard skips
    // the redundant mutation, so the client is never touched at all.
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

describe('AppearanceSettings — default time format', () => {
  it('shows the persisted default as checked', () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Default time format' })
    expect(within(group).getByRole('radio', { name: /Relative/i })).toBeChecked()
    expect(
      within(group).getByRole('radio', { name: /Absolute/i }),
    ).not.toBeChecked()
  })

  it('persists the alternate time format via PUT /settings', async () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Default time format' })
    fireEvent.click(within(group).getByRole('radio', { name: /Absolute/i }))

    await waitFor(() => expect(findPutCall()).toBeTruthy())
    expect(JSON.parse((findPutCall()![1] as RequestInit).body as string)).toEqual({
      ...settingsFixture,
      time_format_default: 'absolute',
    })
  })
})

describe('AppearanceSettings — chart palette', () => {
  it('renders both palettes with their full swatch sets and the CB-safe default checked', () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Chart palette' })
    expect(
      within(group).getByRole('radio', { name: /Color-blind safe/i }),
    ).toBeChecked()
    expect(
      within(group).getByRole('radio', { name: /Stylistic neon/i }),
    ).not.toBeChecked()
    // Each palette renders one swatch per colour constant.
    expect(group.querySelectorAll('span.rounded-full')).toHaveLength(
      CHART_COLORS_CB_SAFE.length + CHART_COLORS_NEON.length,
    )
  })

  it('persists the neon palette via PUT /settings', async () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Chart palette' })
    fireEvent.click(within(group).getByRole('radio', { name: /Stylistic neon/i }))

    await waitFor(() => expect(findPutCall()).toBeTruthy())
    expect(JSON.parse((findPutCall()![1] as RequestInit).body as string)).toEqual({
      ...settingsFixture,
      chart_palette: 'neon',
    })
  })
})

describe('AppearanceSettings — sidebar style (localStorage-backed)', () => {
  it('defaults to Minimal and switches selection + persistence on click', () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Sidebar style' })
    expect(within(group).getByRole('radio', { name: /Minimal/i })).toBeChecked()

    fireEvent.click(within(group).getByRole('radio', { name: /Classic/i }))

    expect(getSidebarStyle()).toBe('legacy')
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('legacy')
    expect(within(group).getByRole('radio', { name: /Classic/i })).toBeChecked()
    expect(
      within(group).getByRole('radio', { name: /Minimal/i }),
    ).not.toBeChecked()
  })

  it('never touches the network for a client-only preference', () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Sidebar style' })
    fireEvent.click(within(group).getByRole('radio', { name: /All groups/i }))
    expect(getSidebarStyle()).toBe('notion')
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

describe('AppearanceSettings — status bar (localStorage-backed)', () => {
  it('toggles visibility and persists the preference', () => {
    renderPanel()
    const sw = switchIn('statusbar-toggle-enabled')
    expect(sw).toBeChecked()

    fireEvent.click(sw)

    expect(sw).not.toBeChecked()
    const stored = JSON.parse(localStorage.getItem(STATUSBAR_KEY) as string)
    expect(stored.enabled).toBe(false)
  })

  it('flips the icon-only preference while the bar is visible', () => {
    renderPanel()
    const wrap = screen.getByTestId('statusbar-toggle-icon-only')
    expect(wrap).toHaveAttribute('aria-disabled', 'false')
    const sw = within(wrap).getByRole('switch')
    expect(sw).not.toBeChecked()

    fireEvent.click(sw)

    expect(sw).toBeChecked()
    expect(
      JSON.parse(localStorage.getItem(STATUSBAR_KEY) as string).iconOnly,
    ).toBe(true)
  })

  it('keeps the icon-only switch INERT while the bar is hidden (regression)', () => {
    // Arrange: bar hidden → the icon-only sub-preference is meaningless.
    setStatusBarPrefs({ enabled: false, iconOnly: false })
    renderPanel()

    const wrap = screen.getByTestId('statusbar-toggle-icon-only')
    expect(wrap).toHaveAttribute('aria-disabled', 'true')
    const sw = within(wrap).getByRole('switch')
    expect(sw).not.toBeChecked()

    fireEvent.click(sw)

    // Bug fix: a click on the dimmed/aria-disabled control does nothing.
    expect(sw).not.toBeChecked()
    expect(
      JSON.parse(localStorage.getItem(STATUSBAR_KEY) as string).iconOnly,
    ).toBe(false)
  })
})

describe('AppearanceSettings — achievement celebrations (localStorage-backed)', () => {
  it('renders the four celebration switches at their documented defaults', () => {
    renderPanel()
    expect(switchIn('celebration-toggle-toasts')).toBeChecked()
    expect(switchIn('celebration-toggle-sound')).not.toBeChecked()
    expect(switchIn('celebration-toggle-dashboard')).toBeChecked()
    expect(switchIn('celebration-toggle-push')).toBeChecked()
  })

  it('opts into the unlock sound and persists it', () => {
    renderPanel()
    const sw = switchIn('celebration-toggle-sound')
    expect(sw).not.toBeChecked()

    fireEvent.click(sw)

    expect(sw).toBeChecked()
    expect(
      JSON.parse(localStorage.getItem(CELEBRATION_KEY) as string).playSound,
    ).toBe(true)
  })
})

describe('AppearanceSettings — product tours', () => {
  it('replays each registered tour by id', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('replay-tour-main'))
    expect(mockedStartTour).toHaveBeenCalledWith('main')
    fireEvent.click(screen.getByTestId('replay-tour-debugger'))
    expect(mockedStartTour).toHaveBeenCalledWith('debugger')
    fireEvent.click(screen.getByTestId('replay-tour-automations'))
    expect(mockedStartTour).toHaveBeenCalledWith('automations')
    expect(mockedStartTour).toHaveBeenCalledTimes(3)
  })

  it('resets every tour on demand', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('reset-all-tours'))
    expect(mockedResetAllTours).toHaveBeenCalledTimes(1)
  })
})

describe('AppearanceSettings — degraded load', () => {
  it('disables server-backed options and cannot save before settings resolve', () => {
    mockedRequest.mockReset()
    mockedRequest.mockReturnValue(new Promise<never>(() => {})) // never resolves → loading
    renderPanel(null)

    const group = screen.getByRole('radiogroup', { name: 'Information density' })
    const compact = within(group).getByRole('radio', { name: /Compact/i })
    expect(compact).toBeDisabled()

    fireEvent.click(compact)

    // No settings loaded → the guard prevents a PUT even if the click lands.
    expect(
      mockedRequest.mock.calls.some(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      ),
    ).toBe(false)
  })
})
