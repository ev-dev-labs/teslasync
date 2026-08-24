/**
 * ThemeProvider — behavioural contract for the app-wide theme/mode context.
 *
 * These tests drive the provider end-to-end rather than smoke-rendering. They
 * cover every runtime export (`ThemeProvider`, `useTheme`, `modeCategoryOrder`)
 * and the branches that matter in production:
 *
 *   • initial state resolution (localStorage → defaults, invalid ids ignored)
 *   • the mount-time backend settings load (applied / ignored / failed / non-OK)
 *   • setTheme / setMode / setCustomColors: state, CSS-variable side effects,
 *     localStorage persistence, cross-tab broadcast, and the fire-and-forget
 *     backend write (plus the pre-initialisation guard that suppresses it)
 *   • `auto` mode resolution against the system `prefers-color-scheme` and a
 *     live media-query change
 *   • cross-tab mirroring via the broadcast bus WITHOUT echoing/looping
 *   • the exposed theme/mode registries and `modeCategoryOrder`
 *
 * Network is fully mocked: `@/api/client`'s `request` is a spy, and the raw
 * `fetch` used by the mount settings load is stubbed per test. The broadcast
 * bus (`@/lib/broadcast`) is mocked so we can both assert emitted envelopes and
 * synthesise inbound messages from a peer tab. `window.matchMedia` is polyfilled
 * here (jsdom ships no implementation) with a controllable listener set.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react'

// ── Broadcast bus mock (hoisted so the factory can reference the spies) ──
const busMock = vi.hoisted(() => {
  let subscriber: ((m: unknown) => void) | null = null
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((handler: (m: unknown) => void) => {
    subscriber = handler
    return unsubscribe
  })
  const broadcast = vi.fn()
  return {
    broadcast,
    subscribe,
    unsubscribe,
    emit: (m: unknown) => subscriber?.(m),
    hasSubscriber: () => subscriber !== null,
    reset: () => {
      subscriber = null
      broadcast.mockClear()
      subscribe.mockClear()
      unsubscribe.mockClear()
    },
  }
})

vi.mock('@/lib/broadcast', () => ({
  broadcast: busMock.broadcast,
  subscribe: busMock.subscribe,
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { request } from '@/api/client'
import { ThemeProvider, useTheme, modeCategoryOrder } from './ThemeProvider'
import { themeCategories } from './themePresets'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

// ── Controllable window.matchMedia (jsdom ships none) ──
let systemPrefersDark = false
const mqListeners = new Set<(e: { matches: boolean }) => void>()

function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: systemPrefersDark,
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => mqListeners.add(cb),
    removeEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => mqListeners.delete(cb),
    addListener: (cb: (e: { matches: boolean }) => void) => mqListeners.add(cb),
    removeListener: (cb: (e: { matches: boolean }) => void) => mqListeners.delete(cb),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
}

function emitSystemPreference(matches: boolean) {
  systemPrefersDark = matches
  act(() => {
    mqListeners.forEach((cb) => cb({ matches }))
  })
}

// ── fetch stubs for the mount settings load ──
function mockFetch(settings: Record<string, unknown> | null) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: settings !== null,
    json: async () => settings,
  }) as unknown as typeof fetch
}

function mockFetchRejecting() {
  global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
}

function mockFetchPending() {
  global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch
}

/** Drain microtasks/macrotasks so the mount fetch chain (and its state
 *  updates) settles inside `act`. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

function Consumer() {
  const ctx = useTheme()
  return (
    <div>
      <span data-testid="themeId">{ctx.themeId}</span>
      <span data-testid="modeId">{ctx.modeId}</span>
      <span data-testid="theme-primary">{ctx.theme.primary}</span>
      <span data-testid="theme-accent">{ctx.theme.accent}</span>
      <span data-testid="mode-bg">{ctx.mode.bg}</span>
      <span data-testid="mode-name">{ctx.mode.name}</span>
      <span data-testid="mode-scheme">{ctx.mode.colorScheme}</span>
      <span data-testid="themes-count">{Object.keys(ctx.themes).length}</span>
      <span data-testid="modes-count">{Object.keys(ctx.modes).length}</span>
      <span data-testid="custom-primary">{ctx.themes.custom.primary}</span>
      <button onClick={() => ctx.setTheme('tesla-red')}>set-red</button>
      <button onClick={() => ctx.setMode('light')}>set-light</button>
      <button onClick={() => ctx.setMode('nord')}>set-nord</button>
      <button onClick={() => ctx.setMode('auto')}>set-auto</button>
      <button onClick={() => ctx.setCustomColors('#123456', '#abcdef')}>set-custom</button>
    </div>
  )
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>,
  )
}

/** Render + let the mount settings load settle so later edits are hermetic. */
async function renderSettled() {
  const utils = renderProvider()
  await flush()
  return utils
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

beforeEach(() => {
  localStorage.clear()
  systemPrefersDark = false
  mqListeners.clear()
  installMatchMedia()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  document.body.removeAttribute('style')
  mockedRequest.mockReset()
  mockedRequest.mockResolvedValue({})
  busMock.reset()
  mockFetch(null) // default: no backend prefs, but init still flips
})

describe('useTheme guard', () => {
  it('throws a helpful error when used outside a ThemeProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used within ThemeProvider')
    spy.mockRestore()
  })

  it('returns the live context when rendered inside the provider', async () => {
    await renderSettled()
    expect(screen.getByTestId('themeId')).toHaveTextContent('neon-cyan')
    expect(screen.getByTestId('modeId')).toHaveTextContent('dark')
  })
})

describe('initial state resolution', () => {
  it('falls back to the neon-cyan / dark defaults and applies them to :root', async () => {
    await renderSettled()
    expect(screen.getByTestId('themeId')).toHaveTextContent('neon-cyan')
    expect(screen.getByTestId('modeId')).toHaveTextContent('dark')
    expect(screen.getByTestId('theme-primary')).toHaveTextContent('#3b82f6')
    expect(screen.getByTestId('mode-bg')).toHaveTextContent('#0b0d12')

    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-primary')).toBe('#3b82f6')
    expect(root.style.getPropertyValue('--bg')).toBe('#0b0d12')
    expect(root.style.getPropertyValue('--bg-app')).toBe('#0b0d12')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light-mode')).toBe(false)
  })

  it('restores a valid persisted theme + mode from localStorage', async () => {
    localStorage.setItem('teslasync-theme', 'matrix-green')
    localStorage.setItem('teslasync-mode', 'oled')
    await renderSettled()
    expect(screen.getByTestId('themeId')).toHaveTextContent('matrix-green')
    expect(screen.getByTestId('modeId')).toHaveTextContent('oled')
    expect(screen.getByTestId('theme-primary')).toHaveTextContent('#00ff41')
    expect(screen.getByTestId('mode-bg')).toHaveTextContent('#000000')
  })

  it('ignores unknown persisted ids and uses the defaults', async () => {
    localStorage.setItem('teslasync-theme', 'not-a-theme')
    localStorage.setItem('teslasync-mode', 'not-a-mode')
    await renderSettled()
    expect(screen.getByTestId('themeId')).toHaveTextContent('neon-cyan')
    expect(screen.getByTestId('modeId')).toHaveTextContent('dark')
  })
})

describe('applyThemeCSS side effects', () => {
  it('switches to the light palette + light-mode class and away from dark', async () => {
    await renderSettled()
    fireEvent.click(screen.getByText('set-light'))

    expect(screen.getByTestId('modeId')).toHaveTextContent('light')
    expect(screen.getByTestId('mode-scheme')).toHaveTextContent('light')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--bg')).toBe('#f8fafc')
    expect(root.style.getPropertyValue('--text-muted')).toBe('#64748b')
    expect(contrastRatio('#64748b', '#f8fafc')).toBeGreaterThanOrEqual(4.5)
    expect(root.style.getPropertyValue('color-scheme')).toBe('light')
    expect(root.classList.contains('light-mode')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(document.body.style.background).not.toBe('')
  })
})

describe('backend settings load', () => {
  it('adopts theme, mode, and custom colours returned by the backend', async () => {
    mockFetch({
      theme: 'royal-purple',
      mode: 'midnight',
      custom_primary: '#111111',
      custom_accent: '#222222',
    })
    await renderSettled()

    expect(screen.getByTestId('themeId')).toHaveTextContent('royal-purple')
    expect(screen.getByTestId('modeId')).toHaveTextContent('midnight')
    expect(localStorage.getItem('teslasync-theme')).toBe('royal-purple')
    expect(localStorage.getItem('teslasync-mode')).toBe('midnight')
    expect(localStorage.getItem('teslasync-custom-primary')).toBe('#111111')
    expect(screen.getByTestId('custom-primary')).toHaveTextContent('#111111')
  })

  it('ignores backend settings that name unknown theme/mode ids', async () => {
    mockFetch({ theme: 'bogus', mode: 'bogus' })
    await renderSettled()
    expect(screen.getByTestId('themeId')).toHaveTextContent('neon-cyan')
    expect(screen.getByTestId('modeId')).toHaveTextContent('dark')
  })

  it('requests the settings endpoint without an /api/v1 double prefix', async () => {
    await renderSettled()
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/settings')
  })

  it('tolerates a failed settings fetch yet still unlocks backend writes', async () => {
    mockFetchRejecting()
    await renderSettled()
    // Defaults survive the failure…
    expect(screen.getByTestId('themeId')).toHaveTextContent('neon-cyan')
    // …and `initialized` still flipped (finally), so an edit now persists.
    fireEvent.click(screen.getByText('set-red'))
    await waitFor(() => expect(mockedRequest).toHaveBeenCalled())
  })
})

describe('setTheme / setMode / setCustomColors', () => {
  it('persists a theme change, broadcasts it, and writes it back to the backend', async () => {
    await renderSettled()
    mockedRequest.mockClear()
    fireEvent.click(screen.getByText('set-red'))

    expect(screen.getByTestId('themeId')).toHaveTextContent('tesla-red')
    expect(localStorage.getItem('teslasync-theme')).toBe('tesla-red')
    expect(busMock.broadcast).toHaveBeenCalledWith({
      type: 'theme.changed',
      themeId: 'tesla-red',
      modeId: 'dark',
    })

    await waitFor(() =>
      expect(
        mockedRequest.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PUT'),
      ).toBe(true),
    )
    const put = mockedRequest.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
    )!
    expect(put[0]).toBe('/settings')
    expect(JSON.parse((put[1] as RequestInit).body as string)).toMatchObject({
      theme: 'tesla-red',
      mode: 'dark',
    })
  })

  it('reflects and broadcasts a mode change', async () => {
    await renderSettled()
    fireEvent.click(screen.getByText('set-nord'))

    expect(screen.getByTestId('modeId')).toHaveTextContent('nord')
    expect(screen.getByTestId('mode-name')).toHaveTextContent('Nord')
    expect(screen.getByTestId('mode-bg')).toHaveTextContent('#2e3440')
    expect(busMock.broadcast).toHaveBeenCalledWith({
      type: 'theme.changed',
      themeId: 'neon-cyan',
      modeId: 'nord',
    })
  })

  it('captures custom colours, switches to the custom theme, persists, and broadcasts both events', async () => {
    await renderSettled()
    busMock.broadcast.mockClear()
    fireEvent.click(screen.getByText('set-custom'))

    expect(screen.getByTestId('themeId')).toHaveTextContent('custom')
    expect(screen.getByTestId('theme-primary')).toHaveTextContent('#123456')
    expect(screen.getByTestId('theme-accent')).toHaveTextContent('#abcdef')
    expect(localStorage.getItem('teslasync-custom-primary')).toBe('#123456')
    expect(localStorage.getItem('teslasync-custom-accent')).toBe('#abcdef')
    // hexToRGB('#123456') → "18, 52, 86" reaches the CSS custom property.
    expect(document.documentElement.style.getPropertyValue('--theme-primary-rgb')).toBe('18, 52, 86')
    expect(busMock.broadcast).toHaveBeenCalledWith({
      type: 'theme.customColors',
      primary: '#123456',
      accent: '#abcdef',
    })
    expect(busMock.broadcast).toHaveBeenCalledWith({
      type: 'theme.changed',
      themeId: 'custom',
      modeId: 'dark',
    })
  })

  it('suppresses the backend write until the initial settings load resolves', async () => {
    mockFetchPending() // `initialized` never flips
    await renderSettled()
    fireEvent.click(screen.getByText('set-red'))

    // State + cross-tab broadcast still happen…
    expect(screen.getByTestId('themeId')).toHaveTextContent('tesla-red')
    expect(busMock.broadcast).toHaveBeenCalledWith({
      type: 'theme.changed',
      themeId: 'tesla-red',
      modeId: 'dark',
    })
    // …but the backend write is gated behind initialisation.
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

describe('auto mode + system preference', () => {
  it('resolves auto mode to the dark palette when the system prefers dark', async () => {
    systemPrefersDark = true
    await renderSettled()
    fireEvent.click(screen.getByText('set-auto'))

    expect(screen.getByTestId('modeId')).toHaveTextContent('auto')
    expect(screen.getByTestId('mode-scheme')).toHaveTextContent('dark')
    expect(screen.getByTestId('mode-bg')).toHaveTextContent('#0b0d12')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('resolves auto mode to the light palette when the system prefers light', async () => {
    systemPrefersDark = false
    await renderSettled()
    fireEvent.click(screen.getByText('set-auto'))

    expect(screen.getByTestId('mode-scheme')).toHaveTextContent('light')
    expect(screen.getByTestId('mode-bg')).toHaveTextContent('#f8fafc')
    expect(document.documentElement.classList.contains('light-mode')).toBe(true)
  })

  it('reacts to a live system colour-scheme change while in auto mode', async () => {
    systemPrefersDark = false
    await renderSettled()
    fireEvent.click(screen.getByText('set-auto'))
    expect(screen.getByTestId('mode-scheme')).toHaveTextContent('light')

    emitSystemPreference(true)

    expect(screen.getByTestId('mode-scheme')).toHaveTextContent('dark')
    expect(screen.getByTestId('mode-bg')).toHaveTextContent('#0b0d12')
  })
})

describe('cross-tab sync', () => {
  it('mirrors a theme.changed message from a peer tab without echoing it back', async () => {
    await renderSettled()
    busMock.broadcast.mockClear()
    mockedRequest.mockClear()

    act(() => busMock.emit({ type: 'theme.changed', themeId: 'solar-amber', modeId: 'oled' }))

    expect(screen.getByTestId('themeId')).toHaveTextContent('solar-amber')
    expect(screen.getByTestId('modeId')).toHaveTextContent('oled')
    // Mirroring must NOT re-broadcast or re-persist (that would loop across tabs).
    expect(busMock.broadcast).not.toHaveBeenCalled()
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('ignores a cross-tab message that names an unknown theme or mode', async () => {
    await renderSettled()
    act(() => busMock.emit({ type: 'theme.changed', themeId: 'ghost', modeId: 'phantom' }))
    expect(screen.getByTestId('themeId')).toHaveTextContent('neon-cyan')
    expect(screen.getByTestId('modeId')).toHaveTextContent('dark')
  })

  it('mirrors a cross-tab custom-colour update into the custom palette', async () => {
    await renderSettled()
    busMock.broadcast.mockClear()

    act(() => busMock.emit({ type: 'theme.customColors', primary: '#0f0f0f', accent: '#f0f0f0' }))

    expect(screen.getByTestId('custom-primary')).toHaveTextContent('#0f0f0f')
    expect(busMock.broadcast).not.toHaveBeenCalled()
  })

  it('subscribes on mount and unsubscribes on unmount', async () => {
    const { unmount } = renderProvider()
    expect(busMock.subscribe).toHaveBeenCalledTimes(1)
    expect(busMock.hasSubscriber()).toBe(true)
    await flush()

    unmount()
    expect(busMock.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('exposed registries', () => {
  it('provides the full theme + mode maps through context', async () => {
    await renderSettled()
    // 5 colour presets + the synthesised `custom` entry.
    expect(screen.getByTestId('themes-count')).toHaveTextContent('6')
    // The 130+ generated preset modes merge with the core built-ins.
    expect(Number(screen.getByTestId('modes-count').textContent)).toBeGreaterThan(100)
  })

  it('modeCategoryOrder puts Core first, then every generated category', () => {
    expect(modeCategoryOrder[0]).toBe('Core')
    expect(modeCategoryOrder).toEqual(['Core', ...themeCategories])
    expect(modeCategoryOrder).toContain('Accessible')
  })
})
