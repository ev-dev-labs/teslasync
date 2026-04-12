import { describe, it, expect } from 'vitest'
import { safe, fmt } from './Charts'
import { CHART_COLORS } from '../../lib/colors'

describe('safe', () => {
  it('converts number to number', () => expect(safe(42)).toBe(42))
  it('converts negative numbers', () => expect(safe(-5)).toBe(-5))
  it('converts zero', () => expect(safe(0)).toBe(0))
  it('converts null to 0', () => expect(safe(null)).toBe(0))
  it('converts undefined to 0', () => expect(safe(undefined)).toBe(0))
  it('converts NaN to 0', () => expect(safe(NaN)).toBe(0))
  it('converts Infinity to 0', () => expect(safe(Infinity)).toBe(0))
  it('converts string to 0', () => expect(safe('3.14')).toBe(0))
  it('converts boolean to 0', () => expect(safe(true)).toBe(0))
})

describe('fmt', () => {
  it('formats with 1 decimal by default', () => expect(fmt(3.14159)).toBe('3.1'))
  it('formats with specified decimals', () => expect(fmt(3.14159, 2)).toBe('3.14'))
  it('handles null', () => expect(fmt(null)).toBe('0.0'))
  it('handles undefined', () => expect(fmt(undefined)).toBe('0.0'))
  it('handles zero', () => expect(fmt(0)).toBe('0.0'))
  it('formats with 0 decimals', () => expect(fmt(3.7, 0)).toBe('4'))
})

describe('CHART_COLORS', () => {
  it('has at least 6 colors', () => expect(CHART_COLORS.length).toBeGreaterThanOrEqual(6))
  it('all colors are hex strings', () => {
    CHART_COLORS.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
  })
})
