import { describe, it, expect } from 'vitest'
import { resolveLocale } from '../locale'

describe('resolveLocale', () => {
  it('returns the locale unchanged when valid', () => {
    expect(resolveLocale('en-US')).toBe('en-US')
    expect(resolveLocale('de-DE')).toBe('de-DE')
    expect(resolveLocale('ja-JP')).toBe('ja-JP')
    expect(resolveLocale('en')).toBe('en')
  })

  it('falls back to en-US for empty string', () => {
    expect(resolveLocale('')).toBe('en-US')
  })

  it('falls back to en-US for whitespace-only string', () => {
    expect(resolveLocale('   ')).toBe('en-US')
    expect(resolveLocale('\t')).toBe('en-US')
    expect(resolveLocale('\n')).toBe('en-US')
  })

  it('falls back to en-US for null and undefined', () => {
    expect(resolveLocale(null)).toBe('en-US')
    expect(resolveLocale(undefined)).toBe('en-US')
  })

  it('the resolved value is always a valid Intl tag', () => {
    // Empty / whitespace would throw — confirm the fallback is accepted.
    expect(() => new Intl.NumberFormat(resolveLocale(''))).not.toThrow()
    expect(() => new Intl.NumberFormat(resolveLocale('   '))).not.toThrow()
    expect(() => new Intl.NumberFormat(resolveLocale(undefined))).not.toThrow()
    expect(() => new Intl.DateTimeFormat(resolveLocale(''))).not.toThrow()
  })

  it('preserves leading/trailing whitespace inside otherwise-valid tags', () => {
    // Non-empty strings pass through verbatim — Intl will validate.
    expect(resolveLocale('en-US  ')).toBe('en-US  ')
  })
})
