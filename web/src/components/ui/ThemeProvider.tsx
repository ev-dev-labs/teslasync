import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { getApiBase } from '@/lib/resilience'
import { request } from '@/api/client'
import { broadcast, subscribe } from '@/lib/broadcast'
import { themePresets, themeCategories } from './themePresets'

export type ThemeId = 'neon-cyan' | 'tesla-red' | 'matrix-green' | 'royal-purple' | 'solar-amber' | 'custom'
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
 * High-contrast foreground (near-black or white) for text/icons sitting on a
 * solid accent fill. Bright accents (neon cyan, matrix green, solar amber) get
 * dark text; dark accents (tesla red, royal purple) get white — so primary
 * buttons stay readable whichever accent the user picks.
 */
function readableForeground(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.6 ? '#0a0a0f' : '#ffffff'
}

const defaultCustomPrimary = '#00b4d8'
const defaultCustomAccent = '#e63946'

function loadCustomColors(): { primary: string; accent: string } {
  const p = localStorage.getItem('teslasync-custom-primary') || defaultCustomPrimary
  const a = localStorage.getItem('teslasync-custom-accent') || defaultCustomAccent
  return { primary: p, accent: a }
}

function buildCustomTheme(primary: string, accent: string): ColorTheme {
  return {
    id: 'custom',
    name: 'Custom',
    primary,
    primaryRGB: hexToRGB(primary),
    accent,
    accentRGB: hexToRGB(accent),
  }
}

const themes: Record<ThemeId, ColorTheme> = {
  'neon-cyan': {
    id: 'neon-cyan',
    name: 'Neon Cyan',
    primary: '#00f0ff',
    primaryRGB: '0, 240, 255',
    accent: '#4f46e5',
    accentRGB: '79, 70, 229',
  },
  'tesla-red': {
    id: 'tesla-red',
    name: 'Tesla Red',
    primary: '#e31937',
    primaryRGB: '227, 25, 55',
    accent: '#ff4060',
    accentRGB: '255, 64, 96',
  },
  'matrix-green': {
    id: 'matrix-green',
    name: 'Matrix Green',
    primary: '#00ff41',
    primaryRGB: '0, 255, 65',
    accent: '#10b981',
    accentRGB: '16, 185, 129',
  },
  'royal-purple': {
    id: 'royal-purple',
    name: 'Royal Purple',
    primary: '#a855f7',
    primaryRGB: '168, 85, 247',
    accent: '#7c3aed',
    accentRGB: '124, 58, 237',
  },
  'solar-amber': {
    id: 'solar-amber',
    name: 'Solar Amber',
    primary: '#f59e0b',
    primaryRGB: '245, 158, 11',
    accent: '#d97706',
    accentRGB: '217, 119, 6',
  },
  'custom': buildCustomTheme(loadCustomColors().primary, loadCustomColors().accent),
}

const builtinModes: Record<string, ModeTheme> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    bg: '#0a0a0f',
    surface1: '#0f1019',
    surface2: '#151621',
    surface3: '#1a1b2e',
    glassBg: 'rgba(255, 255, 255, 0.04)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
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
    bg: '#0a0a0f',
    surface1: '#0f1019',
    surface2: '#151621',
    surface3: '#1a1b2e',
    glassBg: 'rgba(255, 255, 255, 0.04)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
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
  setTheme: (id: ThemeId) => void
  setMode: (id: ModeId) => void
  setCustomColors: (primary: string, accent: string) => void
  themes: typeof themes
  modes: typeof modes
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

function applyThemeCSS(theme: ColorTheme, mode: ModeTheme) {
  const root = document.documentElement
  root.style.setProperty('--theme-primary', theme.primary)
  root.style.setProperty('--theme-primary-rgb', theme.primaryRGB)
  root.style.setProperty('--theme-accent', theme.accent)
  root.style.setProperty('--theme-accent-rgb', theme.accentRGB)
  // Contrasting foreground for solid accent fills (primary buttons, FAB, etc.)
  // so text/icons stay legible whichever accent the user picks.
  root.style.setProperty('--theme-on-primary', readableForeground(theme.primary))
  root.style.setProperty('--theme-on-accent', readableForeground(theme.accent))
  root.style.setProperty('--bg', mode.bg)
  root.style.setProperty('--surface-1', mode.surface1)
  root.style.setProperty('--surface-2', mode.surface2)
  root.style.setProperty('--surface-3', mode.surface3)
  root.style.setProperty('--glass-bg', mode.glassBg)
  root.style.setProperty('--glass-border', mode.glassBorder)
  root.style.setProperty('--text-primary', mode.textPrimary)
  root.style.setProperty('--text-secondary', mode.textSecondary)
  root.style.setProperty('--text-muted', mode.textMuted)
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

  // Load theme from backend settings on first mount.
  // Uses raw fetch intentionally — ThemeProvider mounts before auth context
  // is available, so request() (which handles 401 token refresh) may not work.
  useEffect(() => {
    fetch(`${getApiBase()}/api/v1/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(settings => {
        if (!settings) return
        if (settings.theme && settings.theme in themes) {
          setThemeId(settings.theme as ThemeId)
          localStorage.setItem('teslasync-theme', settings.theme)
        }
        if (settings.mode && settings.mode in modes) {
          setModeId(settings.mode as ModeId)
          localStorage.setItem('teslasync-mode', settings.mode)
        }
        if (settings.custom_primary && settings.custom_accent) {
          setCustomColorsState({ primary: settings.custom_primary, accent: settings.custom_accent })
          localStorage.setItem('teslasync-custom-primary', settings.custom_primary)
          localStorage.setItem('teslasync-custom-accent', settings.custom_accent)
        }
      })
      .catch(() => {})
      .finally(() => setInitialized(true))
  }, [])

  const currentThemes = useMemo(
    () => ({ ...themes, custom: buildCustomTheme(customColors.primary, customColors.accent) }),
    [customColors.primary, customColors.accent],
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
  }, [theme, mode, themeId, modeId])

  // Persist theme changes to backend (fire-and-forget)
  const saveThemeToBackend = useCallback((t: ThemeId, m: ModeId, cp: string, ca: string) => {
    if (!initialized) return
    request<Record<string, unknown>>('/settings').then(current => {
      if (!current) return
      request('/settings', {
        method: 'PUT',
        body: JSON.stringify({ ...current, theme: t, mode: m, custom_primary: cp, custom_accent: ca }),
      }).catch(() => {})
    }).catch(() => {})
  }, [initialized])

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id)
    saveThemeToBackend(id, modeId, customColors.primary, customColors.accent)
    broadcast({ type: 'theme.changed', themeId: id, modeId })
  }, [saveThemeToBackend, modeId, customColors.primary, customColors.accent])

  const setMode = useCallback((id: ModeId) => {
    setModeId(id)
    saveThemeToBackend(themeId, id, customColors.primary, customColors.accent)
    broadcast({ type: 'theme.changed', themeId, modeId: id })
  }, [saveThemeToBackend, themeId, customColors.primary, customColors.accent])

  const setCustomColors = useCallback((primary: string, accent: string) => {
    localStorage.setItem('teslasync-custom-primary', primary)
    localStorage.setItem('teslasync-custom-accent', accent)
    setCustomColorsState({ primary, accent })
    setThemeId('custom')
    saveThemeToBackend('custom', modeId, primary, accent)
    broadcast({ type: 'theme.customColors', primary, accent })
    broadcast({ type: 'theme.changed', themeId: 'custom', modeId })
  }, [saveThemeToBackend, modeId])

  // Cross-tab theme sync: mirror changes from other tabs without rebroadcasting
  // or re-persisting, which would loop and duplicate backend writes.
  const themesRef = useRef(themes)
  const modesRef = useRef(modes)
  themesRef.current = themes
  modesRef.current = modes
  useEffect(() => {
    return subscribe((m) => {
      if (m.type === 'theme.changed') {
        if (m.themeId in themesRef.current) setThemeId(m.themeId as ThemeId)
        if (m.modeId in modesRef.current) setModeId(m.modeId as ModeId)
      } else if (m.type === 'theme.customColors') {
        setCustomColorsState({ primary: m.primary, accent: m.accent })
      }
    })
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ themeId, modeId, theme, mode, setTheme, setMode, setCustomColors, themes: currentThemes, modes }),
    [themeId, modeId, theme, mode, setTheme, setMode, setCustomColors, currentThemes],
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}
