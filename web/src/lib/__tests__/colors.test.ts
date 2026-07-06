import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ColorTheme, ModeTheme } from '@/components/ui/ThemeProvider'
import { useTheme } from '@/components/ui/ThemeProvider'

// The palette hook reads the active theme via useTheme(). Mock the provider
// module so we can drive buildChartPalette with deterministic theme/mode
// inputs without mounting the real ThemeProvider — which performs a network
// fetch and touches window.matchMedia/localStorage on mount. Only useTheme is
// needed at runtime; the ColorTheme/ModeTheme *types* still resolve against the
// real module for authoring.
vi.mock('@/components/ui/ThemeProvider', () => ({
  useTheme: vi.fn(),
}))

import {
  CHART_COLORS,
  CHART_COLORS_CB_SAFE,
  CHART_COLORS_NEON,
  CHARGER_COLORS,
  STATUS_COLORS,
  BATTERY_COLORS,
  COLOR,
  batteryColor,
  healthColor,
  efficiencyColor,
  powerColor,
  boolColor,
  boolColorMuted,
  stateHexColor,
  savingsColor,
  trendColor,
  regenColor,
  degradationColor,
  activityColor,
  statusHexColor,
  buildChartPalette,
  useThemeChartPalette,
} from '../colors'

const HEX6 = /^#[0-9a-fA-F]{6}$/

const mockedUseTheme = vi.mocked(useTheme)

const neonCyan: ColorTheme = {
  id: 'neon-cyan',
  name: 'Neon Cyan',
  primary: '#00f0ff',
  primaryRGB: '0, 240, 255',
  accent: '#4f46e5',
  accentRGB: '79, 70, 229',
}

const teslaRed: ColorTheme = {
  id: 'tesla-red',
  name: 'Tesla Red',
  primary: '#e31937',
  primaryRGB: '227, 25, 55',
  accent: '#ff4060',
  accentRGB: '255, 64, 96',
}

function makeMode(colorScheme: 'dark' | 'light'): ModeTheme {
  return {
    id: colorScheme,
    name: colorScheme,
    bg: '#0a0a0f',
    surface1: '#0f1019',
    surface2: '#151621',
    surface3: '#1a1b2e',
    glassBg: 'rgba(255, 255, 255, 0.04)',
    glassBorder: 'rgba(255, 255, 255, 0.08)',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3af',
    textMuted: '#6b7280',
    colorScheme,
  }
}

const darkMode = makeMode('dark')
const lightMode = makeMode('light')

function setTheme(theme: ColorTheme, mode: ModeTheme) {
  mockedUseTheme.mockReturnValue({
    theme,
    mode,
  } as unknown as ReturnType<typeof useTheme>)
}

/* ── Static palettes ─────────────────────────────────────────────────────── */

describe('static chart palettes', () => {
  it('CHART_COLORS defaults to the color-blind-safe Okabe-Ito palette', () => {
    expect(CHART_COLORS).toBe(CHART_COLORS_CB_SAFE)
  })

  it('CB-safe palette has 8 distinct valid hex colors starting with Okabe-Ito blue', () => {
    expect(CHART_COLORS_CB_SAFE).toHaveLength(8)
    expect(CHART_COLORS_CB_SAFE[0]).toBe('#0072B2')
    CHART_COLORS_CB_SAFE.forEach((c) => expect(c).toMatch(HEX6))
    expect(new Set(CHART_COLORS_CB_SAFE).size).toBe(8)
  })

  it('neon palette has 8 distinct valid hex colors led by neon cyan', () => {
    expect(CHART_COLORS_NEON).toHaveLength(8)
    expect(CHART_COLORS_NEON[0]).toBe('#00f0ff')
    CHART_COLORS_NEON.forEach((c) => expect(c).toMatch(HEX6))
    expect(new Set(CHART_COLORS_NEON).size).toBe(8)
  })

  it('the two palettes are different arrays', () => {
    expect(CHART_COLORS_NEON).not.toBe(CHART_COLORS_CB_SAFE)
    expect(CHART_COLORS_NEON).not.toEqual(CHART_COLORS_CB_SAFE)
  })
})

/* ── Keyed color maps ────────────────────────────────────────────────────── */

describe('CHARGER_COLORS', () => {
  it('exposes both internal keys and human display-name keys', () => {
    expect(CHARGER_COLORS.supercharger).toBe('#ef4444')
    expect(CHARGER_COLORS.dc).toBe('#f59e0b')
    expect(CHARGER_COLORS.home).toBe('#10b981')
    expect(CHARGER_COLORS.Home).toBe('#10b981')
    expect(CHARGER_COLORS.Supercharger).toBe('#ef4444')
    expect(CHARGER_COLORS['Public DC']).toBe('#a855f7')
    expect(CHARGER_COLORS['Work / L2']).toBe('#f59e0b')
    expect(CHARGER_COLORS.Other).toBe('#6366f1')
  })

  it('internal and display keys agree for the same charger type', () => {
    expect(CHARGER_COLORS.home).toBe(CHARGER_COLORS.Home)
    expect(CHARGER_COLORS.supercharger).toBe(CHARGER_COLORS.Supercharger)
  })

  it('returns undefined for an unknown charger key', () => {
    expect(CHARGER_COLORS['does-not-exist']).toBeUndefined()
  })
})

describe('STATUS_COLORS / BATTERY_COLORS', () => {
  it('map the traffic-light states to the semantic palette', () => {
    expect(STATUS_COLORS.good).toBe(COLOR.GOOD)
    expect(STATUS_COLORS.warning).toBe(COLOR.WARN)
    expect(STATUS_COLORS.critical).toBe(COLOR.BAD)
  })

  it('battery colors mirror the status colors', () => {
    expect(BATTERY_COLORS).toEqual(STATUS_COLORS)
  })
})

describe('COLOR semantic constants', () => {
  it('exposes the expected fixed hex values', () => {
    expect(COLOR.GOOD).toBe('#10b981')
    expect(COLOR.WARN).toBe('#f59e0b')
    expect(COLOR.BAD).toBe('#ef4444')
    expect(COLOR.CYAN).toBe('#00f0ff')
    expect(COLOR.PURPLE).toBe('#a855f7')
    expect(COLOR.MUTED).toBe('#6b7280')
    expect(COLOR.DARK).toBe('#374151')
  })

  it('every semantic color is a valid 6-digit hex', () => {
    Object.values(COLOR).forEach((c) => expect(c).toMatch(HEX6))
  })
})

/* ── Threshold color functions ───────────────────────────────────────────── */

describe('batteryColor', () => {
  it('is green above 60%', () => {
    expect(batteryColor(100)).toBe(COLOR.GOOD)
    expect(batteryColor(61)).toBe(COLOR.GOOD)
  })

  it('is amber in the (25, 60] band, inclusive of the 60 boundary', () => {
    expect(batteryColor(60)).toBe(COLOR.WARN)
    expect(batteryColor(26)).toBe(COLOR.WARN)
  })

  it('is red at or below 25%', () => {
    expect(batteryColor(25)).toBe(COLOR.BAD)
    expect(batteryColor(0)).toBe(COLOR.BAD)
    expect(batteryColor(-5)).toBe(COLOR.BAD)
  })
})

describe('healthColor', () => {
  it('is green at or above 90', () => {
    expect(healthColor(90)).toBe(COLOR.GOOD)
    expect(healthColor(100)).toBe(COLOR.GOOD)
  })

  it('is amber in [70, 90)', () => {
    expect(healthColor(89)).toBe(COLOR.WARN)
    expect(healthColor(70)).toBe(COLOR.WARN)
  })

  it('is red below 70', () => {
    expect(healthColor(69)).toBe(COLOR.BAD)
    expect(healthColor(0)).toBe(COLOR.BAD)
  })
})

describe('efficiencyColor', () => {
  it('uses default thresholds (good<180, warn<200) when none supplied', () => {
    expect(efficiencyColor(150)).toBe(COLOR.GOOD)
    expect(efficiencyColor(180)).toBe(COLOR.WARN)
    expect(efficiencyColor(190)).toBe(COLOR.WARN)
    expect(efficiencyColor(200)).toBe(COLOR.BAD)
  })

  it('honours custom good/warn thresholds', () => {
    expect(efficiencyColor(90, 100, 120)).toBe(COLOR.GOOD)
    expect(efficiencyColor(110, 100, 120)).toBe(COLOR.WARN)
    expect(efficiencyColor(130, 100, 120)).toBe(COLOR.BAD)
  })
})

describe('powerColor', () => {
  it('flags consumption (positive) as amber', () => {
    expect(powerColor(10)).toBe(COLOR.WARN)
  })

  it('flags regen/export (negative) as green', () => {
    expect(powerColor(-10)).toBe(COLOR.GOOD)
  })

  it('renders idle (zero) as dark neutral', () => {
    expect(powerColor(0)).toBe(COLOR.DARK)
  })
})

describe('boolColor / boolColorMuted', () => {
  it('boolColor is green when on, amber when off', () => {
    expect(boolColor(true)).toBe(COLOR.GOOD)
    expect(boolColor(false)).toBe(COLOR.WARN)
  })

  it('boolColorMuted is green when on, muted grey when off', () => {
    expect(boolColorMuted(true)).toBe(COLOR.GOOD)
    expect(boolColorMuted(false)).toBe(COLOR.MUTED)
  })
})

describe('stateHexColor', () => {
  it('maps known vehicle states, case-insensitively', () => {
    expect(stateHexColor('driving')).toBe(COLOR.CYAN)
    expect(stateHexColor('Driving')).toBe(COLOR.CYAN)
    expect(stateHexColor('charging')).toBe(COLOR.GOOD)
    expect(stateHexColor('online')).toBe(COLOR.GOOD)
    expect(stateHexColor('ONLINE')).toBe(COLOR.GOOD)
  })

  it('falls back to muted grey for unknown / missing states', () => {
    expect(stateHexColor('parked')).toBe(COLOR.MUTED)
    expect(stateHexColor('')).toBe(COLOR.MUTED)
    expect(stateHexColor(null)).toBe(COLOR.MUTED)
    expect(stateHexColor(undefined)).toBe(COLOR.MUTED)
  })
})

describe('savingsColor', () => {
  it('is green for non-negative savings (including exactly zero)', () => {
    expect(savingsColor(100)).toBe(COLOR.GOOD)
    expect(savingsColor(0)).toBe(COLOR.GOOD)
  })

  it('is red when savings go negative', () => {
    expect(savingsColor(-0.01)).toBe(COLOR.BAD)
    expect(savingsColor(-50)).toBe(COLOR.BAD)
  })
})

describe('trendColor', () => {
  it('treats "up" as bad and "down" as good (cost-oriented semantics)', () => {
    expect(trendColor('up')).toBe(COLOR.BAD)
    expect(trendColor('down')).toBe(COLOR.GOOD)
  })

  it('is muted for flat / unknown / undefined trends', () => {
    expect(trendColor('flat')).toBe(COLOR.MUTED)
    expect(trendColor(undefined)).toBe(COLOR.MUTED)
  })
})

describe('regenColor', () => {
  it('is green at or above 25%', () => {
    expect(regenColor(30)).toBe(COLOR.GOOD)
    expect(regenColor(25)).toBe(COLOR.GOOD)
  })

  it('is amber in [15, 25)', () => {
    expect(regenColor(24)).toBe(COLOR.WARN)
    expect(regenColor(15)).toBe(COLOR.WARN)
  })

  it('is red below 15%', () => {
    expect(regenColor(14)).toBe(COLOR.BAD)
    expect(regenColor(0)).toBe(COLOR.BAD)
  })
})

describe('degradationColor', () => {
  it('is green below 10% degradation', () => {
    expect(degradationColor(0)).toBe(COLOR.GOOD)
    expect(degradationColor(9.9)).toBe(COLOR.GOOD)
  })

  it('is amber at or above 10% degradation', () => {
    expect(degradationColor(10)).toBe(COLOR.WARN)
    expect(degradationColor(20)).toBe(COLOR.WARN)
  })
})

describe('activityColor', () => {
  it('maps each polling-engine activity to its color', () => {
    expect(activityColor('active')).toBe(COLOR.GOOD)
    expect(activityColor('critical')).toBe(COLOR.GOOD)
    expect(activityColor('moderate')).toBe('#3b82f6')
    expect(activityColor('low')).toBe(COLOR.WARN)
    expect(activityColor('idle')).toBe(COLOR.MUTED)
    expect(activityColor('sleeping')).toBe('#4b5563')
  })

  it('falls back to muted for unknown or nullish activity (hardened)', () => {
    expect(activityColor('unknown')).toBe(COLOR.MUTED)
    expect(activityColor('')).toBe(COLOR.MUTED)
    expect(activityColor(null)).toBe(COLOR.MUTED)
    expect(activityColor(undefined)).toBe(COLOR.MUTED)
  })
})

describe('statusHexColor', () => {
  it('maps healthy statuses to green', () => {
    expect(statusHexColor('ok')).toBe(COLOR.GOOD)
    expect(statusHexColor('healthy')).toBe(COLOR.GOOD)
    expect(statusHexColor('connected')).toBe(COLOR.GOOD)
    expect(statusHexColor('active')).toBe(COLOR.GOOD)
  })

  it('maps degraded statuses to amber and failed statuses to red', () => {
    expect(statusHexColor('warning')).toBe(COLOR.WARN)
    expect(statusHexColor('degraded')).toBe(COLOR.WARN)
    expect(statusHexColor('slow')).toBe(COLOR.WARN)
    expect(statusHexColor('error')).toBe(COLOR.BAD)
    expect(statusHexColor('critical')).toBe(COLOR.BAD)
    expect(statusHexColor('down')).toBe(COLOR.BAD)
    expect(statusHexColor('failed')).toBe(COLOR.BAD)
  })

  it('is case-insensitive', () => {
    expect(statusHexColor('HEALTHY')).toBe(COLOR.GOOD)
    expect(statusHexColor('Down')).toBe(COLOR.BAD)
  })

  it('returns muted for null/undefined/empty without throwing (bug fix)', () => {
    expect(() => statusHexColor(null)).not.toThrow()
    expect(statusHexColor(null)).toBe(COLOR.MUTED)
    expect(statusHexColor(undefined)).toBe(COLOR.MUTED)
    expect(statusHexColor('')).toBe(COLOR.MUTED)
    expect(statusHexColor('mystery')).toBe(COLOR.MUTED)
  })
})

/* ── buildChartPalette (pure) ────────────────────────────────────────────── */

describe('buildChartPalette', () => {
  it('echoes the theme primary/accent and yields an 8-color valid hex series', () => {
    const p = buildChartPalette(neonCyan, darkMode)
    expect(p.primary).toBe('#00f0ff')
    expect(p.accent).toBe('#4f46e5')
    expect(p.series).toHaveLength(8)
    p.series.forEach((c) => expect(c).toMatch(HEX6))
  })

  it('keeps semantic colors constant regardless of theme', () => {
    const p = buildChartPalette(teslaRed, darkMode)
    expect(p.positive).toBe(COLOR.GOOD)
    expect(p.negative).toBe(COLOR.BAD)
    expect(p.warning).toBe(COLOR.WARN)
    expect(p.neutral).toBe(COLOR.MUTED)
  })

  it('is deterministic — identical inputs deep-equal', () => {
    expect(buildChartPalette(neonCyan, darkMode)).toEqual(
      buildChartPalette(neonCyan, darkMode),
    )
  })

  it('produces a different series for a different theme', () => {
    const a = buildChartPalette(neonCyan, darkMode)
    const b = buildChartPalette(teslaRed, darkMode)
    expect(b.series).not.toEqual(a.series)
    // ...but the semantic colors stay pinned.
    expect(b.positive).toBe(a.positive)
  })

  it('adapts series lightness to light vs dark mode', () => {
    const dark = buildChartPalette(neonCyan, darkMode)
    const light = buildChartPalette(neonCyan, lightMode)
    expect(light.series).not.toEqual(dark.series)
  })

  it('handles a degenerate primary===accent theme without producing invalid hex', () => {
    const mono: ColorTheme = {
      ...neonCyan,
      primary: '#123456',
      accent: '#123456',
    }
    const p = buildChartPalette(mono, darkMode)
    expect(p.series).toHaveLength(8)
    p.series.forEach((c) => expect(c).toMatch(HEX6))
  })
})

/* ── useThemeChartPalette (hook) ─────────────────────────────────────────── */

describe('useThemeChartPalette', () => {
  beforeEach(() => {
    mockedUseTheme.mockReset()
  })

  it('derives the palette from the active theme via useTheme()', () => {
    setTheme(neonCyan, darkMode)
    const { result } = renderHook(() => useThemeChartPalette())
    expect(result.current).toEqual(buildChartPalette(neonCyan, darkMode))
    expect(result.current.series).toHaveLength(8)
  })

  it('keeps semantic colors constant through the hook', () => {
    setTheme(teslaRed, darkMode)
    const { result } = renderHook(() => useThemeChartPalette())
    expect(result.current.positive).toBe(COLOR.GOOD)
    expect(result.current.negative).toBe(COLOR.BAD)
  })

  it('returns a referentially stable palette across re-renders (memoised)', () => {
    setTheme(neonCyan, darkMode)
    const { result, rerender } = renderHook(() => useThemeChartPalette())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('re-derives the palette when the theme changes', () => {
    setTheme(neonCyan, darkMode)
    const { result, rerender } = renderHook(() => useThemeChartPalette())
    const first = result.current
    setTheme(teslaRed, darkMode)
    rerender()
    expect(result.current).not.toBe(first)
    expect(result.current.primary).toBe('#e31937')
  })
})
