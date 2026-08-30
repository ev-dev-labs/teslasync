/**
 * ThemePicker — behavioural contract for the shared theme / mode / custom-colour
 * picker. `AppearanceSettings.test.tsx` deliberately stubs this component and
 * defers to THIS suite for the real coverage.
 *
 * `useTheme` is backed by a small stateful harness rather than the production
 * `ThemeProvider` so the tests can (a) assert the exact `setTheme` / `setMode` /
 * `setCustomColors` calls with vi spies, and (b) drive real state transitions
 * (e.g. picking "Custom" flips `themeId` → the colour builder appears) without
 * touching the network, `matchMedia`, `BroadcastChannel`, or `localStorage`
 * persistence that the provider owns and tests separately. `useToast` and
 * `react-i18next` are stubbed; the i18n stub echoes the English default so
 * assertions read against real user-visible copy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useRef, useState, type ReactNode } from 'react'
import type { ThemeId, ModeId, ModeTheme, ColorTheme } from './ThemeProvider'

interface TestThemeContext {
  themeId: ThemeId
  modeId: ModeId
  theme: ColorTheme
  mode: ModeTheme
  setTheme: (id: ThemeId) => void
  setMode: (id: ModeId) => void
  setCustomColors: (primary: string, accent: string) => void
  themes: Record<string, ColorTheme>
  modes: Record<string, ModeTheme>
}

const { toastInfo, themeHolder } = vi.hoisted(() => ({
  toastInfo: vi.fn(),
  themeHolder: { current: null as TestThemeContext | null },
}))

// Stateful useTheme: reads the harness-managed context. `...actual` keeps the
// real `modeCategoryOrder` (drives category ordering) + the exported types.
vi.mock('./ThemeProvider', async () => {
  const actual = await vi.importActual<typeof import('./ThemeProvider')>('./ThemeProvider')
  return { ...actual, useTheme: () => themeHolder.current }
})

vi.mock('@/components/feedback/Toast', () => {
  const toast = {
    info: toastInfo,
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
  };
  return {
    useToast: () => toast,
    useOptionalToast: () => toast,
  };
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const t = (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
    const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
    const opts =
      typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
        ? (fallbackOrOpts as Record<string, unknown>)
        : (maybeOpts as Record<string, unknown> | undefined)
    let result = fallback ?? (typeof opts?.defaultValue === 'string' ? opts.defaultValue : key)
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

import { ThemePicker, type ThemePickerProps } from './ThemePicker'

const DEFAULT_PRIMARY = '#00b4d8'
const DEFAULT_ACCENT = '#e63946'

function makeMode(id: string, name: string, colorScheme: 'dark' | 'light', category?: string): ModeTheme {
  return {
    id,
    name,
    category,
    colorScheme,
    bg: '#0a0a0f',
    surface1: '#101018',
    surface2: '#151521',
    surface3: '#1a1b2e',
    glassBg: 'rgba(255,255,255,0.04)',
    glassBorder: 'rgba(255,255,255,0.08)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
  }
}

function makeTheme(id: ThemeId, name: string, primary: string, accent: string): ColorTheme {
  return { id, name, primary, primaryRGB: '0, 0, 0', accent, accentRGB: '0, 0, 0' }
}

const THEMES: Record<string, ColorTheme> = {
  'neon-cyan': makeTheme('neon-cyan', 'Neon Cyan', '#00f0ff', '#4f46e5'),
  'tesla-red': makeTheme('tesla-red', 'Tesla Red', '#e31937', '#ff4060'),
  'matrix-green': makeTheme('matrix-green', 'Matrix Green', '#00ff41', '#10b981'),
  custom: makeTheme('custom', 'Custom', DEFAULT_PRIMARY, DEFAULT_ACCENT),
}

// Two Core modes, one Editor, one uncategorised (→ the appended "Other" bucket).
const MODES: Record<string, ModeTheme> = {
  dark: makeMode('dark', 'Dark', 'dark', 'Core'),
  light: makeMode('light', 'Light', 'light', 'Core'),
  dracula: makeMode('dracula', 'Dracula', 'dark', 'Editor'),
  plain: makeMode('plain', 'Plain', 'dark'),
}

type Spies = {
  setTheme: ReturnType<typeof vi.fn>
  setMode: ReturnType<typeof vi.fn>
  setCustomColors: ReturnType<typeof vi.fn>
}

let capturedSpies: Spies = { setTheme: vi.fn(), setMode: vi.fn(), setCustomColors: vi.fn() }

function makeDefaultContext(): TestThemeContext {
  return {
    themeId: 'neon-cyan',
    modeId: 'dark',
    theme: THEMES['neon-cyan'],
    mode: MODES.dark,
    setTheme: vi.fn(),
    setMode: vi.fn(),
    setCustomColors: vi.fn(),
    themes: THEMES,
    modes: MODES,
  }
}

interface HarnessProps {
  initialThemeId?: ThemeId
  initialModeId?: ModeId
  picker?: ThemePickerProps
}

function Harness({ initialThemeId = 'neon-cyan', initialModeId = 'dark', picker = {} }: HarnessProps) {
  const [themeId, setThemeId] = useState<ThemeId>(initialThemeId)
  const [modeId, setModeId] = useState<ModeId>(initialModeId)
  const [custom, setCustom] = useState({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT })

  const spies = useRef<Spies>({
    setTheme: vi.fn((id: ThemeId) => setThemeId(id)),
    setMode: vi.fn((id: ModeId) => setModeId(id)),
    setCustomColors: vi.fn((primary: string, accent: string) => {
      setCustom({ primary, accent })
      setThemeId('custom')
    }),
  }).current
  capturedSpies = spies

  const themes: Record<string, ColorTheme> = {
    ...THEMES,
    custom: { ...THEMES.custom, primary: custom.primary, accent: custom.accent },
  }

  themeHolder.current = {
    themeId,
    modeId,
    theme: themes[themeId] ?? THEMES['neon-cyan'],
    mode: MODES[modeId] ?? MODES.dark,
    setTheme: spies.setTheme,
    setMode: spies.setMode,
    setCustomColors: spies.setCustomColors,
    themes,
    modes: MODES,
  }

  return <ThemePicker {...picker} />
}

function renderPicker(opts: HarnessProps = {}) {
  const result = render(<Harness {...opts} />)
  return { ...result, spies: capturedSpies }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  themeHolder.current = makeDefaultContext()
})

describe('ThemePicker — display-mode section', () => {
  it('renders the grouped modes, the live count, and per-category totals', () => {
    renderPicker()
    expect(screen.getByText('Display Mode')).toBeInTheDocument()
    expect(screen.getByText('4 modes')).toBeInTheDocument()
    // Core has two modes; the uncategorised one lands in the appended "Other".
    expect(screen.getByText('Core').textContent).toContain('(2)')
    expect(screen.getByText('Other').textContent).toContain('(1)')
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plain' })).toBeInTheDocument()
  })

  it('orders categories Core → Editor → Other via the real modeCategoryOrder', () => {
    renderPicker()
    const dark = screen.getByRole('button', { name: 'Dark' })
    const dracula = screen.getByRole('button', { name: 'Dracula' })
    const plain = screen.getByRole('button', { name: 'Plain' })
    // DOCUMENT_POSITION_FOLLOWING (4) is set when the argument node comes later.
    expect(dark.compareDocumentPosition(dracula) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dracula.compareDocumentPosition(plain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('marks the active mode with aria-pressed and switches it on selection', () => {
    const onModeChange = vi.fn()
    const { spies } = renderPicker({ picker: { onModeChange } })
    expect(screen.getByRole('button', { name: 'Dark', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light', pressed: false })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Light' }))

    expect(spies.setMode).toHaveBeenCalledWith('light')
    expect(onModeChange).toHaveBeenCalledWith('light')
    expect(toastInfo).toHaveBeenCalledWith('Mode: Light')
    // State transition flowed back through the harness context.
    expect(screen.getByRole('button', { name: 'Light', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark', pressed: false })).toBeInTheDocument()
  })
})

describe('ThemePicker — mode search', () => {
  it('filters modes by name and hides the non-matching categories', () => {
    renderPicker()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'drac' } })
    expect(screen.getByRole('button', { name: 'Dracula' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Plain' })).toBeNull()
    expect(screen.queryByText('Core')).toBeNull()
    expect(screen.getByText('Editor')).toBeInTheDocument()
  })

  it('also matches on the category label, not just the mode name', () => {
    renderPicker()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'core' } })
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dracula' })).toBeNull()
  })

  it('shows the empty state when nothing matches', () => {
    renderPicker()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzzz' } })
    expect(screen.getByText('No display modes match your search.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dracula' })).toBeNull()
  })
})

describe('ThemePicker — accent themes', () => {
  it('lists every non-custom accent and never the custom entry inside the grid', () => {
    renderPicker()
    expect(screen.getByText('Accent Color')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Neon Cyan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tesla Red' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Matrix Green' })).toBeInTheDocument()
    // "Custom" only ever renders via the dedicated custom swatch, not the grid.
    const customButtons = screen.getAllByRole('button', { name: 'Custom' })
    expect(customButtons).toHaveLength(1)
  })

  it('applies a theme, fires onChange, toasts, and moves the aria-pressed flag', () => {
    const onChange = vi.fn()
    const { spies } = renderPicker({ picker: { onChange } })
    expect(screen.getByRole('button', { name: 'Neon Cyan', pressed: true })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tesla Red' }))

    expect(spies.setTheme).toHaveBeenCalledWith('tesla-red')
    expect(onChange).toHaveBeenCalledWith('tesla-red')
    expect(toastInfo).toHaveBeenCalledWith('Theme: Tesla Red')
    expect(screen.getByRole('button', { name: 'Tesla Red', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Neon Cyan', pressed: false })).toBeInTheDocument()
  })
})

describe('ThemePicker — custom colour builder', () => {
  it('opens the builder after picking Custom and commits the current colours', () => {
    const onChange = vi.fn()
    const { spies } = renderPicker({ picker: { onChange } })
    // Builder is hidden until the custom theme is active.
    expect(screen.queryByLabelText('Primary')).toBeNull()
    expect(screen.getByRole('button', { name: 'Custom', pressed: false })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))

    expect(spies.setCustomColors).toHaveBeenCalledWith(DEFAULT_PRIMARY, DEFAULT_ACCENT)
    expect(onChange).toHaveBeenCalledWith('custom')
    expect(toastInfo).toHaveBeenCalledWith('Theme: Custom')
    expect(screen.getByRole('button', { name: 'Custom', pressed: true })).toBeInTheDocument()
    expect(screen.getByLabelText('Primary')).toBeInTheDocument()
    expect(screen.getByLabelText('Accent')).toBeInTheDocument()
  })

  it('commits new primary colour (new primary + existing accent) as the user edits', () => {
    const onChange = vi.fn()
    const { spies } = renderPicker({ picker: { onChange }, initialThemeId: 'custom' })
    const primary = screen.getByLabelText('Primary') as HTMLInputElement
    expect(primary.type).toBe('color')

    fireEvent.change(primary, { target: { value: '#123456' } })

    expect(spies.setCustomColors).toHaveBeenLastCalledWith('#123456', DEFAULT_ACCENT)
    expect(onChange).toHaveBeenLastCalledWith('custom')
    expect(screen.getByText('#123456')).toBeInTheDocument()
    expect((screen.getByLabelText('Primary') as HTMLInputElement).value).toBe('#123456')
  })

  it('seeds the builder from persisted custom colours in localStorage', () => {
    localStorage.setItem('teslasync-custom-primary', '#abcabc')
    localStorage.setItem('teslasync-custom-accent', '#fedcba')
    renderPicker({ initialThemeId: 'custom' })
    expect((screen.getByLabelText('Primary') as HTMLInputElement).value).toBe('#abcabc')
    expect((screen.getByLabelText('Accent') as HTMLInputElement).value).toBe('#fedcba')
    expect(screen.getByText('#abcabc')).toBeInTheDocument()
  })
})

describe('ThemePicker — prop toggles', () => {
  it('hides the entire mode section when showMode is false', () => {
    renderPicker({ picker: { showMode: false } })
    expect(screen.queryByText('Display Mode')).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull()
    // Accent section still renders.
    expect(screen.getByText('Accent Color')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Neon Cyan' })).toBeInTheDocument()
  })

  it('hides the custom swatch and its builder when showCustom is false', () => {
    renderPicker({ picker: { showCustom: false }, initialThemeId: 'custom' })
    expect(screen.queryByRole('button', { name: 'Custom' })).toBeNull()
    // Even with the custom theme active, the builder must not appear.
    expect(screen.queryByLabelText('Primary')).toBeNull()
    expect(screen.getByRole('button', { name: 'Neon Cyan' })).toBeInTheDocument()
  })

  it('applies a compact layout ceiling to the mode list and forwards className', () => {
    const { container } = renderPicker({ picker: { compact: true, className: 'my-picker' } })
    expect(container.querySelector('.max-h-72')).not.toBeNull()
    expect(container.querySelector('.max-h-\\[28rem\\]')).toBeNull()
    expect((container.firstChild as HTMLElement).className).toContain('my-picker')
  })
})

describe('ThemePicker — accessibility', () => {
  it('gives the search and colour inputs real accessible names', () => {
    renderPicker({ initialThemeId: 'custom' })
    expect(
      screen.getByRole('searchbox', { name: 'Search display modes…' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Primary')).toBeInTheDocument()
    expect(screen.getByLabelText('Accent')).toBeInTheDocument()
  })
})
