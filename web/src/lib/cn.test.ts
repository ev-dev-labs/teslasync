import { describe, it, expect } from 'vitest'
import { cn } from './cn'

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
})
