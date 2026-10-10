/**
 * IconBox primitive contract tests.
 *
 * IconBox is the shared colored-glyph container used across settings,
 * onboarding, notifications, admin, and system surfaces. Feature code depends
 * on the following behaviour, so it is locked in here:
 *   1. It renders a single <div> wrapper around its children and always carries
 *      the base layout classes (flex centering + ring + shrink-0).
 *   2. `color` (default 'cyan') maps to the exact bg/ring/text utilities from
 *      semantic single-source-of-truth `neonColorMap` for every NeonColor.
 *   3. `size` (default 'md') maps to the right height/width/radius utilities.
 *   4. A caller `className` is merged and wins tailwind-merge conflicts.
 *   5. Out-of-union `color`/`size` values (e.g. from untyped JSON cast to the
 *      prop type) degrade to the defaults instead of throwing — this is the
 *      "IconBox lookup contract" the incident-presentation suite also guards.
 *
 * IconBox adds no interaction semantics; native caller events are forwarded.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
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
    expect(box.className).toContain('rounded-shape-sm')
  })

  it.each(ALL_COLORS)('maps color="%s" to its semantic neonColorMap bg/ring/text utilities', (color) => {
    const box = renderBox(<IconBox color={color}>x</IconBox>)
    const { bg, ring, text } = neonColorMap[color]
    expect(box.className).toContain(bg)
    expect(box.className).toContain(ring)
    expect(box.className).toContain(text)
  })

  it.each([
    ['sm', ['h-8', 'w-8', 'rounded-shape-sm']],
    ['md', ['h-10', 'w-10', 'rounded-shape-sm']],
    ['lg', ['h-12', 'w-12', 'rounded-shape-sm']],
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
    expect(box.className).not.toMatch(/\brounded-shape-sm\b/)
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
    expect(box?.className).toContain('rounded-shape-sm')
  })

  it('forwards native identity, accessibility attributes and events', () => {
    const onClick = vi.fn()
    const box = renderBox(
      <IconBox id="connection-glyph" role="img" aria-label="Connected" data-source="live" onClick={onClick}>
        x
      </IconBox>,
    )
    expect(box).toHaveAttribute('id', 'connection-glyph')
    expect(box).toHaveAttribute('role', 'img')
    expect(box).toHaveAccessibleName('Connected')
    expect(box).toHaveAttribute('data-source', 'live')
    fireEvent.click(box)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it.each(ALL_COLORS)('uses restrained role tokens without decorative effects for "%s"', (color) => {
    const box = renderBox(<IconBox color={color}>x</IconBox>)
    expect(box.className).toContain('var(--')
    expect(box.className).not.toMatch(/(?:text|bg|ring)-neon-|(?:text|bg)-white|shadow-|animate-/)
    // Ring shadows disappear in forced colors; keep a visible system-color boundary.
    expect(box.className).toContain('forced-colors:outline-current')
  })

  it.each(['__proto__', 'constructor', 'toString'])('defaults inherited lookup key "%s"', (value) => {
    const box = renderBox(
      <IconBox color={value as NeonColor} size={value as 'md'}>x</IconBox>,
    )
    expect(box.className).toContain(neonColorMap.cyan.bg)
    expect(box.className).toContain(neonColorMap.cyan.ring)
    expect(box.className).toContain(neonColorMap.cyan.text)
    expect(box.className).toContain('h-10')
    expect(box.className).toContain('w-10')
  })

  it('preserves zero, missing and long child content through rerenders', () => {
    const { container, rerender } = render(<IconBox>{0}</IconBox>)
    expect(container.firstChild).toHaveTextContent('0')
    rerender(<IconBox>{null}</IconBox>)
    expect(container.firstChild).toBeEmptyDOMElement()
    const label = 'A long localized glyph description without truncation '.repeat(8)
    rerender(<IconBox><span>{label}</span></IconBox>)
    expect(container.firstChild).toHaveTextContent(label.trim())
    expect(container.firstChild).not.toHaveClass('truncate', 'overflow-hidden')
  })
})
