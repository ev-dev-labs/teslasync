/**
 * IconBox primitive contract tests.
 *
 * IconBox is the shared colored-glyph container used across settings,
 * onboarding, notifications, admin, and system surfaces. Feature code depends
 * on the following behaviour, so it is locked in here:
 *   1. It renders a single <div> wrapper around its children and always carries
 *      the base layout classes (flex centering + ring + shrink-0).
 *   2. `color` (default 'cyan') maps to the exact bg/ring/text utilities from
 *      the single-source-of-truth `neonColorMap` for every NeonColor.
 *   3. `size` (default 'md') maps to the right height/width/radius utilities.
 *   4. A caller `className` is merged and wins tailwind-merge conflicts.
 *   5. Out-of-union `color`/`size` values (e.g. from untyped JSON cast to the
 *      prop type) degrade to the defaults instead of throwing — this is the
 *      "IconBox lookup contract" the incident-presentation suite also guards.
 *
 * `@testing-library/user-event` is not installed in this repo (see
 * Card.test.tsx) and IconBox is a purely presentational container with no
 * interactive behaviour, so there is nothing to drive with fireEvent/userEvent.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { IconBox } from './IconBox'
import { neonColorMap, type NeonColor } from '../../lib/tokens'

const ALL_COLORS = Object.keys(neonColorMap) as NeonColor[]

/** The IconBox root is the first child rendered into the test container. */
function renderBox(ui: Parameters<typeof render>[0]) {
  const { container } = render(ui)
  return container.firstChild as HTMLElement
}

describe('IconBox', () => {
  it('renders a <div> wrapper around its children', () => {
    render(
      <IconBox>
        <span data-testid="glyph">star</span>
      </IconBox>,
    )
    const glyph = screen.getByTestId('glyph')
    expect(glyph).toBeInTheDocument()
    expect(glyph).toHaveTextContent('star')
    expect(glyph.parentElement?.tagName).toBe('DIV')
  })

  it('always carries the base layout classes', () => {
    const box = renderBox(<IconBox>x</IconBox>)
    expect(box.className).toContain('flex')
    expect(box.className).toContain('items-center')
    expect(box.className).toContain('justify-center')
    expect(box.className).toContain('ring-1')
    expect(box.className).toContain('shrink-0')
  })

  it('applies the default cyan tint and md size when color/size are unset', () => {
    const box = renderBox(<IconBox>x</IconBox>)
    // Defaults must resolve to the cyan map entry ...
    expect(box.className).toContain(neonColorMap.cyan.bg)
    expect(box.className).toContain(neonColorMap.cyan.ring)
    expect(box.className).toContain(neonColorMap.cyan.text)
    // ... and the md sizing utilities.
    expect(box.className).toContain('h-10')
    expect(box.className).toContain('w-10')
    expect(box.className).toContain('rounded-xl')
  })

  it.each(ALL_COLORS)('maps color="%s" to its neonColorMap bg/ring/text utilities', (color) => {
    const box = renderBox(<IconBox color={color}>x</IconBox>)
    const { bg, ring, text } = neonColorMap[color]
    expect(box.className).toContain(bg)
    expect(box.className).toContain(ring)
    expect(box.className).toContain(text)
  })

  it.each([
    ['sm', ['h-8', 'w-8', 'rounded-lg']],
    ['md', ['h-10', 'w-10', 'rounded-xl']],
    ['lg', ['h-12', 'w-12', 'rounded-xl']],
  ] as const)('maps size="%s" to the right sizing utilities', (size, expected) => {
    const box = renderBox(<IconBox size={size}>x</IconBox>)
    for (const cls of expected) {
      expect(box.className).toContain(cls)
    }
  })

  it('merges a caller className onto the box', () => {
    const box = renderBox(<IconBox className="custom-marker">x</IconBox>)
    expect(box.className).toContain('custom-marker')
    // The base classes survive the merge.
    expect(box.className).toContain('flex')
  })

  it('lets a caller className win tailwind-merge size conflicts', () => {
    // The caller's explicit sizing must override the md defaults because
    // tailwind-merge keeps the last conflicting utility.
    const box = renderBox(
      <IconBox size="md" className="h-16 w-16 rounded-full">
        x
      </IconBox>,
    )
    expect(box.className).toContain('h-16')
    expect(box.className).toContain('w-16')
    expect(box.className).toContain('rounded-full')
    expect(box.className).not.toMatch(/\bh-10\b/)
    expect(box.className).not.toMatch(/\bw-10\b/)
    expect(box.className).not.toMatch(/\brounded-xl\b/)
  })

  it('degrades to the cyan tint for an out-of-union color without throwing', () => {
    // Simulate a caller bypassing the type system (a color coming from
    // untyped JSON). The box must not crash on the undefined map lookup.
    let box: HTMLElement | undefined
    expect(() => {
      box = renderBox(<IconBox color={'chartreuse' as unknown as NeonColor}>x</IconBox>)
    }).not.toThrow()
    expect(box?.className).toContain(neonColorMap.cyan.bg)
    expect(box?.className).toContain(neonColorMap.cyan.text)
  })

  it('degrades to the md sizing for an out-of-union size without throwing', () => {
    let box: HTMLElement | undefined
    expect(() => {
      box = renderBox(
        <IconBox size={'xl' as unknown as 'sm' | 'md' | 'lg'}>x</IconBox>,
      )
    }).not.toThrow()
    expect(box?.className).toContain('h-10')
    expect(box?.className).toContain('w-10')
    expect(box?.className).toContain('rounded-xl')
  })
})
