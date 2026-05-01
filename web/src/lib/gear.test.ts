import { describe, it, expect } from 'vitest'
import { parseGear, GEAR_COLORS, GEAR_BADGE_COLORS } from './gear'

describe('parseGear', () => {
  it('parses ShiftStateD → D', () => expect(parseGear('ShiftStateD')).toBe('D'))
  it('parses ShiftStateR → R', () => expect(parseGear('ShiftStateR')).toBe('R'))
  it('parses ShiftStateP → P', () => expect(parseGear('ShiftStateP')).toBe('P'))
  it('parses ShiftStateN → N', () => expect(parseGear('ShiftStateN')).toBe('N'))
  it('parses ShiftStateDrive → D', () => expect(parseGear('ShiftStateDrive')).toBe('D'))
  it('parses ShiftStatePark → P', () => expect(parseGear('ShiftStatePark')).toBe('P'))
  it('parses single letter D', () => expect(parseGear('D')).toBe('D'))
  it('parses single letter P', () => expect(parseGear('P')).toBe('P'))
  it('returns null for empty', () => expect(parseGear('')).toBeNull())
  it('returns null for nil', () => expect(parseGear('<nil>')).toBeNull())
  it('returns null for null', () => expect(parseGear(null)).toBeNull())
  it('returns null for undefined', () => expect(parseGear(undefined)).toBeNull())
  it('returns null for unknown', () => expect(parseGear('Unknown')).toBeNull())
})

describe('GEAR_COLORS', () => {
  it('has color for D', () => expect(GEAR_COLORS.D).toBe('text-emerald-300'))
  it('has color for R', () => expect(GEAR_COLORS.R).toBe('text-rose-300'))
  it('has color for P', () => expect(GEAR_COLORS.P).toBe('text-cyan-300'))
  it('has color for N', () => expect(GEAR_COLORS.N).toBe('text-amber-300'))
})

describe('GEAR_BADGE_COLORS', () => {
  it('has badge for D', () => expect(GEAR_BADGE_COLORS.D).toBe('green'))
  it('has badge for R', () => expect(GEAR_BADGE_COLORS.R).toBe('red'))
  it('has badge for P', () => expect(GEAR_BADGE_COLORS.P).toBe('cyan'))
  it('has badge for N', () => expect(GEAR_BADGE_COLORS.N).toBe('amber'))
})
