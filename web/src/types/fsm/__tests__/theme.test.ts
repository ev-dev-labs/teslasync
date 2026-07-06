import { describe, it, expect } from 'vitest'
import type { BadgeVariant, StateStyle } from '../types'
import { VARIANT_THEME, resolveStyle, DEFAULT_STATE } from '../theme'

const VARIANTS: BadgeVariant[] = ['success', 'warning', 'danger', 'info', 'neutral']
const STYLE_KEYS: (keyof StateStyle)[] = ['badgeDot', 'bg', 'text', 'dot']

describe('VARIANT_THEME', () => {
  it('defines an entry for every BadgeVariant and no extras', () => {
    expect(Object.keys(VARIANT_THEME).sort()).toEqual([...VARIANTS].sort())
  })

  it.each(VARIANTS)('%s carries all four non-empty StateStyle class keys', (variant) => {
    const style = VARIANT_THEME[variant]
    for (const key of STYLE_KEYS) {
      expect(typeof style[key]).toBe('string')
      expect(style[key].length).toBeGreaterThan(0)
    }
  })

  it('maps semantic variants to their expected Tailwind hues', () => {
    expect(VARIANT_THEME.success.badgeDot).toBe('bg-green-400')
    expect(VARIANT_THEME.warning.bg).toBe('bg-amber-500/10')
    expect(VARIANT_THEME.danger.text).toBe('text-red-400')
    expect(VARIANT_THEME.info.dot).toBe('bg-blue-400')
  })

  it('routes neutral body text through the theme CSS var, not a hardcoded color', () => {
    expect(VARIANT_THEME.neutral.text).toBe('text-[var(--text-muted)]')
    expect(VARIANT_THEME.neutral.text).not.toMatch(/text-(?:white|black|gray-\d)/)
  })
})

describe('resolveStyle', () => {
  it('resolves a bare entry to its theme defaults plus the variant tag', () => {
    const resolved = resolveStyle({ variant: 'success' })
    expect(resolved).toEqual({ variant: 'success', ...VARIANT_THEME.success })
  })

  it('applies partial overrides on top of the theme base (override wins, rest preserved)', () => {
    // vehicle.driving is semantically 'success' but tinted blue — see the
    // StateEntry.overrides doc in ../types.ts.
    const resolved = resolveStyle({
      variant: 'success',
      overrides: { text: 'text-blue-400', dot: 'bg-blue-400' },
    })
    expect(resolved.text).toBe('text-blue-400')
    expect(resolved.dot).toBe('bg-blue-400')
    // Untouched keys fall back to the base theme.
    expect(resolved.bg).toBe(VARIANT_THEME.success.bg)
    expect(resolved.badgeDot).toBe(VARIANT_THEME.success.badgeDot)
    expect(resolved.variant).toBe('success')
  })

  it('treats an empty overrides object as a no-op', () => {
    expect(resolveStyle({ variant: 'warning', overrides: {} })).toEqual(
      resolveStyle({ variant: 'warning' }),
    )
  })

  it('returns a fresh object each call and never mutates VARIANT_THEME', () => {
    const a = resolveStyle({ variant: 'danger' })
    const b = resolveStyle({ variant: 'danger' })
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
    const original = VARIANT_THEME.danger.text
    a.text = 'text-purple-400'
    expect(VARIANT_THEME.danger.text).toBe(original)
  })

  it('falls back to the neutral theme for an unknown variant (no undefined class keys)', () => {
    const resolved = resolveStyle({ variant: 'mystery' as BadgeVariant })
    for (const key of STYLE_KEYS) {
      expect(resolved[key]).toBe(VARIANT_THEME.neutral[key])
    }
    // Original tag is preserved for debugging even when the style falls back.
    expect(resolved.variant).toBe('mystery')
  })

  it('keeps every variant fully populated after resolution', () => {
    for (const variant of VARIANTS) {
      const resolved = resolveStyle({ variant })
      expect(resolved.variant).toBe(variant)
      for (const key of STYLE_KEYS) {
        expect(typeof resolved[key]).toBe('string')
        expect(resolved[key].length).toBeGreaterThan(0)
      }
    }
  })
})

describe('DEFAULT_STATE', () => {
  it('is the resolved neutral style used for unknown states', () => {
    expect(DEFAULT_STATE.variant).toBe('neutral')
    expect(DEFAULT_STATE).toEqual(resolveStyle({ variant: 'neutral' }))
  })

  it('carries a complete StateStyle', () => {
    for (const key of STYLE_KEYS) {
      expect(typeof DEFAULT_STATE[key]).toBe('string')
      expect(DEFAULT_STATE[key].length).toBeGreaterThan(0)
    }
  })
})
