import { describe, it, expect } from 'vitest'
import { cn } from './cn'
import { typography } from './tokens'

// `cn` is the app-wide className composer (clsx for conditional composition +
// tailwind-merge for last-wins conflict resolution). It is used in hundreds of
// components, so its two guarantees — (1) faithful clsx composition of
// strings/arrays/objects with falsy pruning, and (2) tailwind-merge conflict
// resolution where the *last* conflicting utility wins — are load-bearing.
// A regression here silently corrupts styling across the entire SPA.

/** Split a className string into an order-independent set of tokens. */
function tokens(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean))
}

describe('cn — clsx composition', () => {
  it('joins multiple string arguments with single spaces', () => {
    expect(cn('flex', 'items-center', 'gap-2')).toBe('flex items-center gap-2')
  })

  it('always returns a string, even for no / empty input', () => {
    expect(typeof cn()).toBe('string')
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
    expect(cn(null, undefined, false)).toBe('')
  })

  it('prunes every falsy value (null, undefined, false, 0, empty string, NaN)', () => {
    expect(cn('a', null, undefined, false, 0, '', NaN, 'b')).toBe('a b')
  })

  it('supports the conditional object syntax, keeping only truthy keys', () => {
    expect(cn('btn', { active: true, disabled: false })).toBe('btn active')
    // Every key false → object contributes nothing.
    expect(cn('btn', { active: false, loading: false })).toBe('btn')
  })

  it('flattens array and deeply-nested array inputs', () => {
    expect(cn(['flex', 'p-2'], 'gap-1')).toBe('flex p-2 gap-1')
    expect(cn(['a', ['b', ['c']]])).toBe('a b c')
  })

  it('mixes strings, arrays and objects in a single call', () => {
    expect(cn('base', ['x', { y: true, z: false }], undefined, 'w')).toBe('base x y w')
  })

  it('supports the `condition && "class"` idiom', () => {
    const isActive = true
    const isDisabled = false
    expect(cn('tab', isActive && 'tab--active', isDisabled && 'tab--disabled')).toBe(
      'tab tab--active',
    )
  })
})

describe('cn — tailwind-merge conflict resolution (last wins)', () => {
  it('resolves conflicting padding utilities so the last one wins', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('lets an override class defeat a base class regardless of source shape', () => {
    // The canonical reason `cn` exists: a component's base classes plus a
    // caller-provided override, where the override must win.
    const result = cn('rounded bg-black px-2', 'px-6')
    expect(tokens(result).has('px-6')).toBe(true)
    expect(tokens(result).has('px-2')).toBe(false)
    // Non-conflicting base classes survive.
    expect(tokens(result).has('rounded')).toBe(true)
    expect(tokens(result).has('bg-black')).toBe(true)
  })

  it('resolves conflicting text-color utilities to the last value', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('preserves non-conflicting utilities from different class groups', () => {
    const result = cn('flex', 'items-center', 'justify-between')
    expect(tokens(result)).toEqual(new Set(['flex', 'items-center', 'justify-between']))
  })

  it('collapses an exact duplicate utility to a single occurrence', () => {
    expect(cn('flex', 'flex')).toBe('flex')
  })

  it('applies conflict resolution across conditional / falsy-pruned inputs', () => {
    const useLargePadding = true
    const result = cn('p-2', useLargePadding && 'p-8', false && 'p-0')
    expect(result).toBe('p-8')
  })

  /**
   * Every token-backed scale declared in tailwind.config.js uses a custom
   * (non-numeric, non-keyword) key, which twMerge does NOT recognise out of
   * the box — both classes survive and CSS source order silently decides the
   * winner. Each scale must therefore be registered in cn.ts. This test is
   * the guard: adding a new custom scale to tailwind.config.js without
   * registering it here will fail.
   */
  describe('token-backed custom scales resolve last-wins', () => {
    it.each([
      ['duration-fast', 'duration-normal'],
      ['duration-fast', 'duration-200'],
      ['ease-standard', 'ease-linear'],
      ['ease-accelerate', 'ease-decelerate'],
      ['rounded-panel', 'rounded-lg'],
      ['rounded-shape-md', 'rounded-full'],
      ['shadow-panel', 'shadow-e1'],
      ['shadow-e2', 'shadow-none'],
    ])('%s then %s keeps only the last', (base, override) => {
      expect(cn(base, override)).toBe(override)
    })
  })

  describe('docked side-panel geometry resolves last-wins', () => {
    const geometry = [
      ['w-side-panel', ['w-80', 'w-full', 'w-[420px]', 'w-[50vw]']],
      ['max-w-side-panel-viewport', ['max-w-sm', 'max-w-none', 'max-w-[40vw]', 'max-w-[500px]']],
      ['min-h-side-panel-header', ['min-h-16', 'min-h-full', 'min-h-[4.5rem]', 'min-h-[100px]']],
    ] as const

    for (const [named, alternatives] of geometry) {
      for (const alternative of alternatives) {
        it.each(['', 'sm:', 'xl:', '2xl:'])(
          `${named} and ${alternative} honor both orders with variant %s`,
          (variant) => {
            expect(cn(`${variant}${named}`, `${variant}${alternative}`)).toBe(`${variant}${alternative}`)
            expect(cn(`${variant}${alternative}`, `${variant}${named}`)).toBe(`${variant}${named}`)
          },
        )
      }
    }

    it('keeps independent dimensions, unrelated utilities and distinct variants', () => {
      const classes = [
        'w-side-panel', 'max-w-side-panel-viewport', 'min-h-side-panel-header',
        'min-w-0', 'h-full', 'shrink-0', 'pb-7',
        'sm:w-80', 'xl:w-side-panel', '2xl:w-[500px]',
        'sm:max-w-sm', 'xl:max-w-side-panel-viewport',
        'sm:min-h-16', 'xl:min-h-side-panel-header',
      ]
      expect(tokens(cn(classes))).toEqual(new Set(classes))
      expect(tokens(cn([...classes].reverse()))).toEqual(new Set(classes))
    })

    describe('font-size inheritance resolves independently of foreground colors', () => {
      const inherited = typography.size.inherit

      for (const alternative of [
        'text-sm', 'text-base', 'text-2xl',
        'text-[length:inherit]', 'text-[18px]', 'text-[length:var(--custom-size)]',
        'text-sm/6',
      ]) {
        it.each(['', 'sm:', 'md:', 'xl:', 'forced-colors:'])(
          `${alternative} and inheritance honor both orders with variant %s`,
          (variant) => {
            expect(cn(`${variant}${alternative}`, `${variant}${inherited}`)).toBe(`${variant}${inherited}`)
            expect(cn(`${variant}${inherited}`, `${variant}${alternative}`)).toBe(`${variant}${alternative}`)
          },
        )
      }

      it.each([
        'text-inherit', 'text-red-500', typography.color.primary,
        'text-[color:var(--text-secondary)]', 'forced-colors:text-[ButtonText]',
        'forced-colors:hover:text-[HighlightText]',
      ])('preserves foreground %s in either order', (foreground) => {
        expect(tokens(cn(inherited, foreground))).toEqual(new Set([inherited, foreground]))
        expect(tokens(cn(foreground, inherited))).toEqual(new Set([inherited, foreground]))
        expect(tokens(cn('text-sm', foreground, inherited))).toEqual(new Set([foreground, inherited]))
        expect(tokens(cn(inherited, foreground, 'text-sm'))).toEqual(new Set([foreground, 'text-sm']))
      })

      it('keeps matching forced-colors foreground independent of font-size overrides', () => {
        expect(cn('forced-colors:text-sm', 'forced-colors:text-[ButtonText]', `forced-colors:${inherited}`))
          .toBe(`forced-colors:text-[ButtonText] forced-colors:${inherited}`)
        expect(cn(`forced-colors:${inherited}`, 'forced-colors:text-[ButtonText]', 'forced-colors:text-sm'))
          .toBe('forced-colors:text-[ButtonText] forced-colors:text-sm')
      })

      it('preserves distinct variants, other typography properties and caller composition', () => {
        const classes = [
          inherited, 'sm:text-sm', 'md:text-[18px]', `xl:${inherited}`,
          'font-medium', 'font-sans', 'tracking-wide',
          typography.color.primary, 'forced-colors:text-[ButtonText]',
        ]
        expect(tokens(cn(classes))).toEqual(new Set(classes))
        expect(tokens(cn([...classes].reverse()))).toEqual(new Set(classes))
        expect(cn(['text-sm', { [inherited]: true }], false, 'text-lg')).toBe('text-lg')
      })
    })
  })
})
