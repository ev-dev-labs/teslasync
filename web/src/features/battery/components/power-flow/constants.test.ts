import { describe, expect, it } from 'vitest'

import { getDatePreset } from '@/lib/datePresets'

import { DEFAULT_SITE_ID, FLOW_COLORS, PRESET_IDS } from './constants'

/**
 * `constants.ts` is a pure data module (one colour palette, one preset-id
 * tuple, one site-id scalar) with nothing to mount — plain Vitest unit tests,
 * matching the sibling feedback-queue/constants.test.ts convention.
 *
 * The assertions pin the invariants the real consumers silently rely on:
 *   - PowerHistoryChart feeds FLOW_COLORS.{solar,battery,grid,home} straight
 *     into recharts `stroke` + `<ChartGradient color>` (an SVG stopColor); a
 *     non-hex value would render an invisible / default-black series.
 *   - PowerFlowDashboardPage feeds FLOW_COLORS.soc into `<RadialGauge color>`.
 *   - PowerFlowDashboardPage passes PRESET_IDS to `<RangePicker presetIds>`,
 *     which resolves each id through DATE_PRESETS; an unknown id yields a chip
 *     that renders nothing and no-ops on click.
 *   - DEFAULT_SITE_ID is the Tesla Energy site id every sub-component shares and
 *     every `/energy` hook sends as a query param.
 */

const HEX6 = /^#[0-9a-f]{6}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// The four stacked-area energy sources (soc is the SOC line, asserted apart).
const FLOW_SOURCES = ['solar', 'battery', 'grid', 'home'] as const

describe('FLOW_COLORS', () => {
  it('maps every energy source to a defined 6-digit hex (valid recharts stroke/fill/stopColor)', () => {
    const keys: readonly (keyof typeof FLOW_COLORS)[] = [...FLOW_SOURCES, 'soc']
    for (const key of keys) {
      expect(FLOW_COLORS[key]).toBeDefined()
      expect(FLOW_COLORS[key]).toMatch(HEX6)
    }
  })

  it('pins the documented palette (regression guard on the chart colour tokens)', () => {
    expect(FLOW_COLORS).toEqual({
      solar: '#f59e0b',
      battery: '#22c55e',
      grid: '#a855f7',
      home: '#3b82f6',
      soc: '#22c55e',
    })
  })

  it('keeps the four stacked-area sources visually distinct so the chart stays legible', () => {
    const values = FLOW_SOURCES.map((k) => FLOW_COLORS[k])
    // A duplicate hue would make two overlapping series indistinguishable.
    expect(new Set(values).size).toBe(values.length)
  })

  it('draws the SOC line in the battery hue (SOC reflects battery state)', () => {
    expect(FLOW_COLORS.soc).toBe(FLOW_COLORS.battery)
    expect(FLOW_COLORS.soc).toBe('#22c55e')
  })

  it('is frozen so a consumer reading the shared palette cannot mutate it in place', () => {
    expect(Object.isFrozen(FLOW_COLORS)).toBe(true)
    expect(() => {
      (FLOW_COLORS as unknown as Record<string, string>).solar = '#000000'
    }).toThrow()
    // The rejected write must not have altered the shared value.
    expect(FLOW_COLORS.solar).toBe('#f59e0b')
  })
})

describe('PRESET_IDS', () => {
  it('references only known date presets (RangePicker resolves each id via DATE_PRESETS)', () => {
    for (const id of PRESET_IDS) {
      expect(getDatePreset(id)).toBeDefined()
    }
  })

  it('resolves every id to an inclusive ISO range (start <= end)', () => {
    // Fixed local reference so preset resolution stays deterministic.
    const now = new Date(2026, 4, 15, 12, 0, 0)
    for (const id of PRESET_IDS) {
      const preset = getDatePreset(id)
      expect(preset).toBeDefined()
      const range = preset!.resolve(now)
      expect(range.start).toMatch(ISO_DATE)
      expect(range.end).toMatch(ISO_DATE)
      expect(range.start <= range.end).toBe(true)
    }
  })

  it('contains no duplicates and pins the documented toolbar order', () => {
    expect(new Set(PRESET_IDS).size).toBe(PRESET_IDS.length)
    expect(PRESET_IDS[0]).toBe('today')
    expect([...PRESET_IDS]).toEqual(['today', 'yesterday', '7d', '30d', '90d', 'mtd', 'ytd'])
  })

  it('is frozen so the shared toolbar preset list cannot be mutated in place', () => {
    expect(Object.isFrozen(PRESET_IDS)).toBe(true)
    expect(() => {
      (PRESET_IDS as unknown as string[]).push('all')
    }).toThrow()
    expect(PRESET_IDS).toHaveLength(7)
  })
})

describe('DEFAULT_SITE_ID', () => {
  it('is a positive integer usable as a Tesla Energy site id / query param', () => {
    expect(Number.isInteger(DEFAULT_SITE_ID)).toBe(true)
    expect(DEFAULT_SITE_ID).toBeGreaterThan(0)
    expect(Number.isNaN(DEFAULT_SITE_ID)).toBe(false)
  })

  it('pins to the single-site default (1) every sub-component shares', () => {
    expect(DEFAULT_SITE_ID).toBe(1)
  })
})
