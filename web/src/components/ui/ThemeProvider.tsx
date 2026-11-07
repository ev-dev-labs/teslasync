import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { request } from '@/api/client'
import { getBootstrapSettings } from '@/api/settingsBootstrap'
import { broadcast, subscribe } from '@/lib/broadcast'
import { DEFAULT_BRAND_ACCENT, DEFAULT_CUSTOM_PRIMARY, DEFAULT_CUSTOM_ACCENT } from '@/lib/themeDefaults'
import { themePresets, themeCategories } from './themePresets'

const accentPresets = {
  'neon-cyan': ['Blue', DEFAULT_BRAND_ACCENT],
  'tesla-red': ['Red', '#ef4444'],
  'matrix-green': ['Green', '#22c55e'],
  'royal-purple': ['Purple', '#8b5cf6'],
  'solar-amber': ['Amber', '#f59e0b'],
  'sky-blue': ['Sky', '#0ea5e9'],
  'ocean-teal': ['Teal', '#14b8a6'],
  'emerald-green': ['Emerald', '#10b981'],
  'forest-green': ['Forest', '#16a34a'],
  'lime-green': ['Lime', '#84cc16'],
  'sunny-yellow': ['Yellow', '#eab308'],
  'sunset-orange': ['Orange', '#f97316'],
  coral: ['Coral', '#fb7185'],
  'rose-pink': ['Pink', '#ec4899'],
  magenta: ['Magenta', '#d946ef'],
  lavender: ['Lavender', '#a78bfa'],
  indigo: ['Indigo', '#6366f1'],
  'navy-blue': ['Navy', '#1e40af'],
  gold: ['Gold', '#ca8a04'],
  'slate-gray': ['Slate', '#64748b'],
} as const

export type ThemeId = keyof typeof accentPresets | 'custom'
// Core modes are always present; `string` allows the 130+ generated display-mode presets.
export type ModeId = 'dark' | 'light' | 'oled' | 'midnight' | 'auto' | 'sunset' | 'nord' | (string & {})

export interface ColorTheme {
  id: ThemeId
  name: string
  primary: string
  primaryRGB: string
  accent: string
  accentRGB: string
}

export interface ModeTheme {
  id: ModeId
  name: string
  bg: string
  surface1: string
  surface2: string
  surface3: string
  glassBg: string
  glassBorder: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  colorScheme: 'dark' | 'light'
  /** Grouping label for the display-mode picker (e.g. 'Editor', 'Core'). */
  category?: string
}

function hexToRGB(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r}, ${g}, ${b}`
}

/**
 * High-contrast foreground (black or white) for text/icons sitting on a
 * solid accent fill. Bright accents (neon cyan, matrix green, solar amber) get
 * dark text; dark accents (tesla red, royal purple) get white — so primary
 * buttons stay readable whichever accent the user picks.
 */
function parseHexColor(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return null
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ]
}

function relativeLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  if (foregroundLuminance == null || backgroundLuminance == null) return 0
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function readableForeground(hex: string): string {
  return contrastRatio('#000000', hex) >= contrastRatio('#ffffff', hex) ? '#000000' : '#ffffff'
}

function mixHex(from: string, to: string, amount: number): string {
  const start = parseHexColor(from)
  const end = parseHexColor(to)
  if (!start || !end) return to
  const channels = start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * amount),
  )
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function accessibleMutedForeground(mode: ModeTheme): string {
  const surfaces = [mode.bg, mode.surface1, mode.surface2, mode.surface3]
  const meetsContrast = (color: string) =>
    surfaces.every((surface) => contrastRatio(color, surface) >= 4.5)
  if (meetsContrast(mode.textMuted)) return mode.textMuted

  const target = meetsContrast(mode.textPrimary)
    ? mode.textPrimary
    : mode.colorScheme === 'dark'
      ? '#ffffff'
      : '#000000'
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(mode.textMuted, target, step / 20)
    if (meetsContrast(candidate)) return candidate
  }
  return target
}

/** Saved palettes remain raw; only CSS presentation is restrained. */
function presentationMode(mode: ModeTheme): ModeTheme {
  const base = builtinModes[mode.colorScheme]
  const highContrast = mode.id === 'hc-dark' || mode.id === 'hc-light'
  const surface = (raw: string, neutral: string) =>
    highContrast || ['dark', 'light', 'auto', 'oled'].includes(mode.id) ? raw : mixHex(raw, neutral, 0.85)
  return {
    ...mode,
    bg: surface(mode.bg, base.bg),
    surface1: mode.id === 'light' ? '#fafbfc' : surface(mode.surface1, base.surface1),
    surface2: surface(mode.surface2, base.surface2),
    surface3: surface(mode.surface3, base.surface3),
    textPrimary: highContrast ? mode.textPrimary : base.textPrimary,
    textSecondary: highContrast ? mode.textSecondary : base.textSecondary,
    textMuted: highContrast ? mode.textMuted : mode.colorScheme === 'dark' ? '#8490a2' : '#64748b',
  }
}

function loadCustomColors(): { primary: string; accent: string } {
  // Module scope runs in Node during Playwright collection (and SSR): fall
  // back to defaults when there is no DOM storage.
  if (typeof localStorage === 'undefined') {
    return { primary: DEFAULT_CUSTOM_PRIMARY, accent: DEFAULT_CUSTOM_ACCENT }
  }
  const p = localStorage.getItem('teslasync-custom-primary') || DEFAULT_CUSTOM_PRIMARY
  const a = localStorage.getItem('teslasync-custom-accent') || DEFAULT_CUSTOM_ACCENT
  return { primary: p, accent: a }
}

function themeColors(primary: string) {
  const rgb = hexToRGB(primary)
  return { primary, primaryRGB: rgb, accent: primary, accentRGB: rgb }
}

function buildCustomTheme(primary: string): ColorTheme {
  return { id: 'custom', name: 'Custom', ...themeColors(primary) }
}

const presetThemes = Object.fromEntries(
  Object.entries(accentPresets).map(([id, [name, primary]]) =>
    [id, { id, name, ...themeColors(primary) }]),
) as Record<Exclude<ThemeId, 'custom'>, ColorTheme>

const themes: Record<ThemeId, ColorTheme> = {
  ...presetThemes,
  'custom': buildCustomTheme(loadCustomColors().primary),
}

const builtinModes: Record<string, ModeTheme> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    bg: '#0b0d12',
    surface1: '#11151c',
    surface2: '#171c25',
    surface3: '#202733',
    glassBg: 'rgba(255, 255, 255, 0.025)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#f4f7fb',
    textSecondary: '#aab4c3',
    textMuted: '#758195',
    colorScheme: 'dark',
  },
  light: {
    id: 'light',
    name: 'Light',
    bg: '#f8fafc',
    surface1: '#ffffff',
    surface2: '#f1f5f9',
    surface3: '#e2e8f0',
    glassBg: 'rgba(255, 255, 255, 0.8)',
    glassBorder: 'rgba(0, 0, 0, 0.08)',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    colorScheme: 'light',
  },
  oled: {
    id: 'oled',
    name: 'OLED Black',
    bg: '#000000',
    surface1: '#050505',
    surface2: '#0a0a0a',
    surface3: '#111111',
    glassBg: 'rgba(255, 255, 255, 0.03)',
    glassBorder: 'rgba(255, 255, 255, 0.05)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
    colorScheme: 'dark',
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Blue',
    bg: '#0a0e1a',
    surface1: '#0f1425',
    surface2: '#141a30',
    surface3: '#1a2240',
    glassBg: 'rgba(100, 150, 255, 0.04)',
    glassBorder: 'rgba(100, 150, 255, 0.08)',
    textPrimary: '#e0e7ff',
    textSecondary: '#94a3c8',
    textMuted: '#6875a0',
    colorScheme: 'dark',
  },
  auto: {
    id: 'auto',
    name: 'Auto (System)',
    bg: '#0b0d12',
    surface1: '#11151c',
    surface2: '#171c25',
    surface3: '#202733',
    glassBg: 'rgba(255, 255, 255, 0.025)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#f4f7fb',
    textSecondary: '#aab4c3',
    textMuted: '#758195',
    colorScheme: 'dark',
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    bg: '#1a0e0a',
    surface1: '#241410',
    surface2: '#2e1a14',
    surface3: '#3a221a',
    glassBg: 'rgba(255, 160, 100, 0.04)',
    glassBorder: 'rgba(255, 160, 100, 0.10)',
    textPrimary: '#fff0e0',
    textSecondary: '#c8a894',
    textMuted: '#a07860',
    colorScheme: 'dark',
  },
  nord: {
    id: 'nord',
    name: 'Nord',
    bg: '#2e3440',
    surface1: '#3b4252',
    surface2: '#434c5e',
    surface3: '#4c566a',
    glassBg: 'rgba(136, 192, 208, 0.04)',
    glassBorder: 'rgba(136, 192, 208, 0.10)',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    textMuted: '#81a1c1',
    colorScheme: 'dark',
  },
}

// Merge the 130+ generated presets with the core built-ins. Built-ins win any id
// collision (they carry hand-tuned palettes); every core mode is tagged 'Core'.
for (const m of Object.values(builtinModes)) m.category = 'Core'
const presetModes: Record<string, ModeTheme> = Object.fromEntries(
  themePresets.map(p => [p.id, p]),
)
const modes: Record<string, ModeTheme> = { ...presetModes, ...builtinModes }

/** Category display order for the picker: Core first, then generated families. */
export const modeCategoryOrder: string[] = ['Core', ...themeCategories]

interface ThemeContextValue {
  themeId: ThemeId
  modeId: ModeId
  theme: ColorTheme
  mode: ModeTheme
  persistenceError: boolean
  setTheme: (id: ThemeId) => void
  setMode: (id: ModeId) => void
  setCustomColors: (primary: string, accent?: string) => void
  themes: typeof themes
  modes: typeof modes
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

/**
 * The primary/accent tokens are exactly the hex the user selected (preset or
 * custom): never darkened, lightened, snapped to a palette or contrast-shifted.
 * Contrast is handled only by choosing the text/icon colour drawn on top
 * (`--theme-on-primary` / `--theme-on-accent`).
 */
function applyThemeCSS(theme: ColorTheme, savedMode: ModeTheme) {
  const mode = presentationMode(savedMode)
  const primary = theme.primary.toLowerCase()
  const root = document.documentElement
  root.style.setProperty('--theme-primary', primary)
  root.style.setProperty('--theme-primary-rgb', hexToRGB(primary))
  root.style.setProperty('--theme-accent', primary)
  root.style.setProperty('--theme-accent-rgb', hexToRGB(primary))
  // Contrasting foreground for solid accent fills (primary buttons, FAB, etc.)
  // so text/icons stay legible whichever accent the user picks.
  root.style.setProperty('--theme-on-primary', readableForeground(primary))
  root.style.setProperty('--theme-on-accent', readableForeground(primary))
  root.style.setProperty('--bg', mode.bg)
  root.style.setProperty('--bg-app', mode.bg)
  root.style.setProperty('--surface-1', mode.surface1)
  root.style.setProperty('--surface-2', mode.surface2)
  root.style.setProperty('--surface-3', mode.surface3)
  root.style.setProperty('--glass-bg', mode.surface1)
  root.style.setProperty('--glass-border', 'var(--border-default)')
  root.style.setProperty('--text-primary', mode.textPrimary)
  root.style.setProperty('--text-secondary', mode.textSecondary)
  root.style.setProperty('--text-muted', accessibleMutedForeground(mode))
  root.style.setProperty('color-scheme', mode.colorScheme)
  document.body.style.background = mode.bg
  // Keep Tailwind dark: utilities aligned with the selected app theme, not the static index.html default.
  root.classList.toggle('dark', mode.colorScheme === 'dark')
  root.classList.toggle('light-mode', mode.colorScheme === 'light')
}

/**
 * System `prefers-color-scheme: dark` lookup that never throws. `matchMedia`
 * is unavailable in some embedded webviews, SSR passes, and test environments;
 * when it is missing we fall back to the app's dark-first default so `auto`
 * mode still resolves to a sensible palette instead of crashing the provider
 * on its very first render.
 */
function prefersDarkScheme(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('teslasync-theme')
    return (saved && saved in themes) ? saved as ThemeId : 'neon-cyan'
  })

  const [modeId, setModeId] = useState<ModeId>(() => {
    const saved = localStorage.getItem('teslasync-mode')
    return (saved && saved in modes) ? saved as ModeId : 'dark'
  })

  const [customColors, setCustomColorsState] = useState(loadCustomColors)
  const [initialized, setInitialized] = useState(false)
  const [persistenceError, setPersistenceError] = useState(false)
  // Event handlers can update multiple preferences before React commits a render.
  const selection = useRef({ themeId, modeId, customColors })
  const persistenceErrorRef = useRef(false)
  const pendingInitialChanges = useRef<{
    theme?: boolean
    mode?: boolean
    customPrimary?: boolean
    customAccent?: boolean
  } | null>(null)
  const pendingSave = useRef<{ theme: ThemeId; mode: ModeId; customPrimary: string; customAccent: string } | null>(null)
  const saving = useRef(false)

  // Load theme from backend settings on first mount.
  useEffect(() => {
    getBootstrapSettings()
      .then(settings => {
        if (!settings) return
        const pending = pendingInitialChanges.current
        if (!pending?.theme && settings.theme && settings.theme in themes) {
          selection.current = { ...selection.current, themeId: settings.theme as ThemeId }
          setThemeId(settings.theme as ThemeId)
          localStorage.setItem('teslasync-theme', settings.theme)
        }
        if (!pending?.mode && settings.mode && settings.mode in modes) {
          selection.current = { ...selection.current, modeId: settings.mode as ModeId }
          setModeId(settings.mode as ModeId)
          localStorage.setItem('teslasync-mode', settings.mode)
        }
        const primary = pending?.customPrimary ? undefined : settings.custom_primary
        const accent = pending?.customAccent ? undefined : settings.custom_accent
        if (primary || accent) {
          const nextColors = {
            primary: primary || selection.current.customColors.primary,
            accent: accent || selection.current.customColors.accent,
          }
          selection.current = { ...selection.current, customColors: nextColors }
          setCustomColorsState(nextColors)
          if (primary) localStorage.setItem('teslasync-custom-primary', primary)
          if (accent) localStorage.setItem('teslasync-custom-accent', accent)
        }
      })
      .catch(error => console.warn('Unable to load theme preferences:', error))
      .finally(() => setInitialized(true))
  }, [])

  const currentThemes = useMemo(
    () => ({ ...themes, custom: buildCustomTheme(customColors.primary) }),
    [customColors.primary],
  )
  const theme = currentThemes[themeId]

  // Auto mode: resolve to light or dark based on system preference
  const [systemDark, setSystemDark] = useState(prefersDarkScheme)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolvedMode = modeId === 'auto' ? (systemDark ? modes.dark : modes.light) : (modes[modeId] ?? modes.dark)
  const mode = resolvedMode

  useEffect(() => {
    applyThemeCSS(theme, mode)
    localStorage.setItem('teslasync-theme', themeId)
    localStorage.setItem('teslasync-mode', modeId)
    localStorage.setItem('teslasync-theme-primary', theme.primary)
  }, [theme, mode, themeId, modeId])

  const saveThemeToBackend = useCallback((t: ThemeId, m: ModeId, cp: string, ca: string) => {
    if (!initialized) return
    pendingSave.current = { theme: t, mode: m, customPrimary: cp, customAccent: ca }
    if (saving.current) return
    saving.current = true
    const drain = async () => {
      while (pendingSave.current) {
        const next = pendingSave.current
        pendingSave.current = null
        try {
          const current = await request<Record<string, unknown>>('/settings')
          if (!current) throw new Error('Empty settings response')
          await request('/settings', {
            method: 'PUT',
            body: JSON.stringify({
              ...current,
              theme: next.theme,
              mode: next.mode,
              custom_primary: next.customPrimary,
              custom_accent: next.customAccent,
            }),
          })
          if (persistenceErrorRef.current) {
            persistenceErrorRef.current = false
            setPersistenceError(false)
          }
        } catch (error) {
          console.error('Unable to save theme preferences:', error)
          persistenceErrorRef.current = true
          setPersistenceError(true)
        }
      }
      saving.current = false
    }
    void drain()
  }, [initialized])

  useEffect(() => {
    if (!initialized || !pendingInitialChanges.current) return
    pendingInitialChanges.current = null
    saveThemeToBackend(themeId, modeId, customColors.primary, customColors.accent)
  }, [initialized, saveThemeToBackend, themeId, modeId, customColors])

  const setTheme = useCallback((id: ThemeId) => {
    if (!initialized) pendingInitialChanges.current = { ...pendingInitialChanges.current, theme: true }
    const next = { ...selection.current, themeId: id }
    selection.current = next
    setThemeId(id)
    saveThemeToBackend(id, next.modeId, next.customColors.primary, next.customColors.accent)
    broadcast({ type: 'theme.changed', themeId: id, modeId: next.modeId })
  }, [initialized, saveThemeToBackend])

  const setMode = useCallback((id: ModeId) => {
    if (!initialized) pendingInitialChanges.current = { ...pendingInitialChanges.current, mode: true }
    const next = { ...selection.current, modeId: id }
    selection.current = next
    setModeId(id)
    saveThemeToBackend(next.themeId, id, next.customColors.primary, next.customColors.accent)
    broadcast({ type: 'theme.changed', themeId: next.themeId, modeId: id })
  }, [initialized, saveThemeToBackend])

  const setCustomColors = useCallback((primary: string, accent?: string) => {
    const resolvedAccent = accent ?? selection.current.customColors.accent
    if (!initialized) {
      pendingInitialChanges.current = {
        ...pendingInitialChanges.current,
        theme: true,
        customPrimary: true,
        customAccent: accent !== undefined || pendingInitialChanges.current?.customAccent,
      }
    }
    localStorage.setItem('teslasync-custom-primary', primary)
    localStorage.setItem('teslasync-custom-accent', resolvedAccent)
    const next = { ...selection.current, themeId: 'custom' as const, customColors: { primary, accent: resolvedAccent } }
    selection.current = next
    setCustomColorsState({ primary, accent: resolvedAccent })
    setThemeId('custom')
    saveThemeToBackend('custom', next.modeId, primary, resolvedAccent)
    broadcast({ type: 'theme.customColors', primary, accent: resolvedAccent })
    broadcast({ type: 'theme.changed', themeId: 'custom', modeId: next.modeId })
  }, [initialized, saveThemeToBackend])

  // Cross-tab theme sync: mirror changes from other tabs without rebroadcasting
  // or re-persisting, which would loop and duplicate backend writes.
  const themesRef = useRef(themes)
  const modesRef = useRef(modes)
  themesRef.current = themes
  modesRef.current = modes
  useEffect(() => {
    return subscribe((m) => {
      if (m.type === 'theme.changed') {
        if (m.themeId in themesRef.current) {
          selection.current = { ...selection.current, themeId: m.themeId as ThemeId }
          setThemeId(m.themeId as ThemeId)
        }
        if (m.modeId in modesRef.current) {
          selection.current = { ...selection.current, modeId: m.modeId as ModeId }
          setModeId(m.modeId as ModeId)
        }
      } else if (m.type === 'theme.customColors') {
        selection.current = { ...selection.current, customColors: { primary: m.primary, accent: m.accent } }
        setCustomColorsState({ primary: m.primary, accent: m.accent })
      }
    })
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ themeId, modeId, theme, mode, persistenceError, setTheme, setMode, setCustomColors, themes: currentThemes, modes }),
    [themeId, modeId, theme, mode, persistenceError, setTheme, setMode, setCustomColors, currentThemes],
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
