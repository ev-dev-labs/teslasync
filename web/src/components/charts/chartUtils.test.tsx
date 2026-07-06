import { describe, it, expect } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { CartesianGrid } from 'recharts'
import {
  safe,
  fmt,
  axisTick,
  axisTickSm,
  chartGrid,
  chartAnimation,
  chartMargin,
  chartMarginLabeled,
  CHART_COLORS,
  NEON_COLORS,
} from './chartUtils'
import { CHART_COLORS as SRC_CHART_COLORS, CHART_COLORS_NEON } from '../../lib/colors'
import { chartTokens } from '../../lib/tokens'

const HEX6 = /^#[0-9a-fA-F]{6}$/

describe('safe', () => {
  it('returns finite numbers unchanged', () => {
    expect(safe(42)).toBe(42)
    expect(safe(-5.5)).toBe(-5.5)
    expect(safe(0)).toBe(0)
    expect(safe(1e-9)).toBe(1e-9)
  })

  it('coerces non-finite numbers to 0', () => {
    expect(safe(NaN)).toBe(0)
    expect(safe(Infinity)).toBe(0)
    expect(safe(-Infinity)).toBe(0)
  })

  it('coerces non-number types (never coercing numeric strings) to 0', () => {
    expect(safe(null)).toBe(0)
    expect(safe(undefined)).toBe(0)
    expect(safe('42')).toBe(0)
    expect(safe('')).toBe(0)
    expect(safe(true)).toBe(0)
    expect(safe({})).toBe(0)
    expect(safe([1, 2])).toBe(0)
  })

  it('always returns a primitive number so downstream arithmetic is safe', () => {
    expect(typeof safe(undefined)).toBe('number')
    expect(typeof safe('nope')).toBe('number')
  })
})

describe('fmt', () => {
  it('defaults to a single decimal place', () => {
    expect(fmt(3.14159)).toBe('3.1')
    expect(fmt(2)).toBe('2.0')
  })

  it('honors an explicit decimal count (and rounds)', () => {
    expect(fmt(3.14159, 2)).toBe('3.14')
    expect(fmt(3.7, 0)).toBe('4')
    expect(fmt(3.14159, 3)).toBe('3.142')
  })

  it('routes nullish / non-numeric input through safe() to 0', () => {
    expect(fmt(null)).toBe('0.0')
    expect(fmt(undefined)).toBe('0.0')
    expect(fmt(NaN)).toBe('0.0')
    expect(fmt('nope')).toBe('0.0')
  })

  it('adds locale grouping separators for large magnitudes', () => {
    expect(fmt(1234567, 0)).toBe('1,234,567')
  })

  it('clamps out-of-range precision instead of throwing a RangeError', () => {
    // Recharts invokes fmt() inside tick/label formatters; an unclamped
    // negative or >20 precision would throw inside Intl.NumberFormat and blank
    // the chart. The clamp maps <0 -> 0 and >20 -> 20.
    expect(() => fmt(5, -1)).not.toThrow()
    expect(fmt(5, -1)).toBe('5')
    expect(() => fmt(5, 999)).not.toThrow()
    expect(fmt(1.5, 999)).toContain('1.5')
  })
})

describe('axisTick / axisTickSm', () => {
  it('axisTick uses the theme-aware axis stroke at 11px', () => {
    expect(axisTick).toEqual({ fill: chartTokens.axisStroke, fontSize: 11 })
    expect(axisTick.fill).toBe('var(--text-muted)')
  })

  it('axisTickSm is a smaller 10px variant sharing the same fill', () => {
    expect(axisTickSm).toEqual({ fill: chartTokens.axisStroke, fontSize: 10 })
    expect(axisTickSm.fill).toBe(axisTick.fill)
    expect(axisTickSm.fontSize).toBeLessThan(axisTick.fontSize)
  })
})

describe('chartGrid', () => {
  it('is a valid CartesianGrid element', () => {
    expect(isValidElement(chartGrid)).toBe(true)
    expect(chartGrid.type).toBe(CartesianGrid)
  })

  it('is dashed, theme-aware, and semi-transparent', () => {
    const props = (chartGrid as ReactElement<Record<string, unknown>>).props
    expect(props.strokeDasharray).toBe('3 3')
    expect(props.stroke).toBe(chartTokens.gridStroke)
    expect(props.stroke).toBe('var(--border-subtle)')
    expect(props.strokeOpacity).toBe(0.4)
  })
})

describe('chartAnimation', () => {
  it('animates over 800ms with ease-out easing', () => {
    expect(chartAnimation.animationDuration).toBe(800)
    expect(chartAnimation.animationEasing).toBe('ease-out')
  })
})

describe('chartMargin / chartMarginLabeled', () => {
  it('chartMargin is a tight all-around margin', () => {
    expect(chartMargin).toEqual({ top: 10, right: 10, left: 0, bottom: 0 })
  })

  it('chartMarginLabeled reserves extra room for axis labels', () => {
    expect(chartMarginLabeled).toEqual({ top: 10, right: 20, left: 10, bottom: 5 })
    expect(chartMarginLabeled.left).toBeGreaterThan(chartMargin.left)
    expect(chartMarginLabeled.bottom).toBeGreaterThan(chartMargin.bottom)
    expect(chartMarginLabeled.right).toBeGreaterThan(chartMargin.right)
  })
})

describe('color re-exports', () => {
  it('re-exports the canonical CHART_COLORS palette by reference', () => {
    expect(CHART_COLORS).toBe(SRC_CHART_COLORS)
    expect(CHART_COLORS.length).toBeGreaterThanOrEqual(6)
    CHART_COLORS.forEach((c) => expect(c).toMatch(HEX6))
  })

  it('aliases CHART_COLORS_NEON as NEON_COLORS and keeps it distinct', () => {
    expect(NEON_COLORS).toBe(CHART_COLORS_NEON)
    expect(NEON_COLORS).not.toBe(CHART_COLORS)
    expect(NEON_COLORS.length).toBeGreaterThanOrEqual(6)
    NEON_COLORS.forEach((c) => expect(c).toMatch(HEX6))
  })
})
