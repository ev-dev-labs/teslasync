import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type ThemeId = 'neon-cyan' | 'tesla-red' | 'matrix-green' | 'royal-purple' | 'solar-amber'
export type ModeId = 'dark' | 'light' | 'oled' | 'midnight'

interface ColorTheme {
  id: ThemeId
  name: string
  primary: string
  primaryRGB: string
  accent: string
  accentRGB: string
}

interface ModeTheme {
  id: ModeId
  name: string
  bg: string
  surface1: string
  surface2: string
  surface3: string
  glassBorder: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  colorScheme: 'dark' | 'light'
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
}

const modes: Record<ModeId, ModeTheme> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    bg: '#0a0a0f',
    surface1: '#0f1019',
    surface2: '#151621',
    surface3: '#1a1b2e',
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
    glassBorder: 'rgba(0, 0, 0, 0.08)',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    colorScheme: 'light',
  },
  oled: {
    id: 'oled',
    name: 'OLED Black',
    bg: '#000000',
    surface1: '#050505',
    surface2: '#0a0a0a',
    surface3: '#111111',
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
    glassBorder: 'rgba(100, 150, 255, 0.08)',
    textPrimary: '#e0e7ff',
    textSecondary: '#94a3c8',
    textMuted: '#6875a0',
    colorScheme: 'dark',
  },
}

interface ThemeContextValue {
  themeId: ThemeId
  modeId: ModeId
  theme: ColorTheme
  mode: ModeTheme
  setTheme: (id: ThemeId) => void
  setMode: (id: ModeId) => void
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
  root.style.setProperty('--bg', mode.bg)
  root.style.setProperty('--surface-1', mode.surface1)
  root.style.setProperty('--surface-2', mode.surface2)
  root.style.setProperty('--surface-3', mode.surface3)
  root.style.setProperty('--glass-border', mode.glassBorder)
  root.style.setProperty('--text-primary', mode.textPrimary)
  root.style.setProperty('--text-secondary', mode.textSecondary)
  root.style.setProperty('--text-muted', mode.textMuted)
  root.style.setProperty('color-scheme', mode.colorScheme)
  document.body.style.background = mode.bg
  // Toggle class for light mode CSS overrides
  root.classList.toggle('light-mode', mode.colorScheme === 'light')
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

  const theme = themes[themeId]
  const mode = modes[modeId]

  useEffect(() => {
    applyThemeCSS(theme, mode)
    localStorage.setItem('teslasync-theme', themeId)
    localStorage.setItem('teslasync-mode', modeId)
  }, [theme, mode, themeId, modeId])

  const setTheme = (id: ThemeId) => setThemeId(id)
  const setMode = (id: ModeId) => setModeId(id)

  return (
    <ThemeContext.Provider value={{ themeId, modeId, theme, mode, setTheme, setMode, themes, modes }}>
      {children}
    </ThemeContext.Provider>
  )
}
