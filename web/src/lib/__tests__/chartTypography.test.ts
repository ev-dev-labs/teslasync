/**
 * chartTypography helper tests.
 *
 * These helpers feed SVG/canvas text (Recharts ticks, Leaflet overlays) that
 * cannot use Tailwind, so they must resolve the live `--font-*` CSS variables
 * written by FontProvider and degrade safely when those vars are missing,
 * malformed, or unreadable (SSR / getComputedStyle throwing). The suite drives
 * every export through the real `document.documentElement` style pipeline for
 * the happy paths and a stubbed `getComputedStyle` for the edge/failure paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getChartFontFamily,
  getChartFontScale,
  getChartFontSize,
} from '../chartTypography'

const FONT_SANS = '--font-sans'
const FONT_SCALE = '--font-scale'

function setVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value)
}

function clearVars(): void {
  document.documentElement.style.removeProperty(FONT_SANS)
  document.documentElement.style.removeProperty(FONT_SCALE)
}

/**
 * Replace getComputedStyle with a stub that returns a fixed map of custom
 * properties. Lets us exercise whitespace/empty/non-numeric branches without
 * depending on how jsdom normalises `style.setProperty` values.
 */
function stubComputed(map: Record<string, string>): void {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (prop: string) => map[prop] ?? '',
  } as unknown as CSSStyleDeclaration)
}

/** Make getComputedStyle throw, exercising the rootStyle() try/catch → null path. */
function throwOnComputed(): void {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
    throw new Error('getComputedStyle unavailable')
  })
}

beforeEach(() => {
  clearVars()
})

afterEach(() => {
  clearVars()
  vi.restoreAllMocks()
})

describe('getChartFontFamily', () => {
  it('resolves the live --font-sans stack', () => {
    setVar(FONT_SANS, "'Roboto', sans-serif")
    expect(getChartFontFamily()).toBe("'Roboto', sans-serif")
  })

  it('trims surrounding whitespace from the resolved value', () => {
    stubComputed({ [FONT_SANS]: "   'Source Sans 3', sans-serif   " })
    expect(getChartFontFamily()).toBe("'Source Sans 3', sans-serif")
  })

  it('falls back to the Inter system stack when the var is unset', () => {
    const family = getChartFontFamily()
    expect(family).toContain('Inter')
    expect(family).toContain('sans-serif')
  })

  it('falls back when the var is present but only whitespace', () => {
    stubComputed({ [FONT_SANS]: '    ' })
    expect(getChartFontFamily()).toContain('Inter')
  })

  it('falls back to the Inter stack when getComputedStyle throws', () => {
    throwOnComputed()
    const family = getChartFontFamily()
    expect(family).toContain('Inter')
    expect(family).toContain('system-ui')
  })
})

describe('getChartFontScale', () => {
  it('reads the live --font-scale multiplier', () => {
    setVar(FONT_SCALE, '1.25')
    expect(getChartFontScale()).toBe(1.25)
  })

  it('defaults to 1 when the var is unset', () => {
    expect(getChartFontScale()).toBe(1)
  })

  it('defaults to 1 for a non-numeric value', () => {
    stubComputed({ [FONT_SCALE]: 'not-a-number' })
    expect(getChartFontScale()).toBe(1)
  })

  it('defaults to 1 for a zero scale', () => {
    stubComputed({ [FONT_SCALE]: '0' })
    expect(getChartFontScale()).toBe(1)
  })

  it('defaults to 1 for a negative scale', () => {
    stubComputed({ [FONT_SCALE]: '-1.5' })
    expect(getChartFontScale()).toBe(1)
  })

  it('parses a value with a trailing unit via parseFloat leniency', () => {
    stubComputed({ [FONT_SCALE]: '1.2px' })
    expect(getChartFontScale()).toBe(1.2)
  })

  it('clamps an absurdly large scale to the defensive ceiling', () => {
    setVar(FONT_SCALE, '50')
    expect(getChartFontScale()).toBe(3)
  })

  it('passes a value exactly at the ceiling through unchanged', () => {
    setVar(FONT_SCALE, '3')
    expect(getChartFontScale()).toBe(3)
  })

  it('defaults to 1 when getComputedStyle throws', () => {
    throwOnComputed()
    expect(getChartFontScale()).toBe(1)
  })
})

describe('getChartFontSize', () => {
  it('returns the historical 11px default at scale 1', () => {
    expect(getChartFontSize()).toBe(11)
  })

  it('returns the requested base size unchanged at scale 1', () => {
    expect(getChartFontSize(12)).toBe(12)
    expect(getChartFontSize(10)).toBe(10)
  })

  it('scales the base size by --font-scale', () => {
    setVar(FONT_SCALE, '1.25')
    expect(getChartFontSize(12)).toBe(15)
  })

  it('rounds the scaled size to the nearest integer', () => {
    setVar(FONT_SCALE, '1.25')
    // 11 * 1.25 = 13.75 → 14
    expect(getChartFontSize(11)).toBe(14)
    expect(Number.isInteger(getChartFontSize(10))).toBe(true)
  })

  it('falls back to the default base for a NaN base', () => {
    expect(getChartFontSize(Number.NaN)).toBe(11)
  })

  it('falls back to the default base for a non-positive base', () => {
    expect(getChartFontSize(0)).toBe(11)
    expect(getChartFontSize(-8)).toBe(11)
  })

  it('falls back to the default base for a non-finite base', () => {
    expect(getChartFontSize(Number.POSITIVE_INFINITY)).toBe(11)
  })

  it('applies the current scale even when the base falls back', () => {
    setVar(FONT_SCALE, '2')
    // invalid base → default 11, then 11 * 2 = 22
    expect(getChartFontSize(Number.NaN)).toBe(22)
  })
})
