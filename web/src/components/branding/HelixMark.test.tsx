import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { LucideIcon } from 'lucide-react'

import { HelixMark } from './HelixMark'

// HelixMark is a static SVG brand icon engineered as a drop-in for Lucide's
// `LucideIcon`. It has a single export and no network/i18n/query dependencies,
// so a bare render() (no providers) exercises it fully. These tests pin the
// Lucide-parity contract every consumer relies on: default attributes, the
// `size` / `color` / `strokeWidth` / `absoluteStrokeWidth` props, ref
// forwarding, arbitrary attribute pass-through (the Avatar glyph slot sets
// `data-testid`/`aria-hidden` this way), children, and the a11y name path.

describe('HelixMark', () => {
  describe('default rendering', () => {
    it('renders an <svg> root with Lucide-parity default attributes', () => {
      const { container } = render(<HelixMark />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
      expect(svg).toHaveAttribute('width', '24')
      expect(svg).toHaveAttribute('height', '24')
      expect(svg).toHaveAttribute('fill', 'none')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(svg).toHaveAttribute('stroke-width', '1.75')
      expect(svg).toHaveAttribute('stroke-linecap', 'round')
      expect(svg).toHaveAttribute('stroke-linejoin', 'round')
    })

    it('draws the two helix strands and the two connecting rungs', () => {
      const { container } = render(<HelixMark />)
      expect(container.querySelectorAll('path')).toHaveLength(2)
      expect(container.querySelectorAll('line')).toHaveLength(2)
    })

    it('exposes a stable displayName for DevTools / Lucide parity', () => {
      expect(HelixMark.displayName).toBe('HelixMark')
    })
  })

  describe('sizing', () => {
    it('applies a numeric `size` to both width and height', () => {
      const { container } = render(<HelixMark size={48} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '48')
      expect(svg).toHaveAttribute('height', '48')
    })

    it('lets an explicit width/height override `size` (Avatar glyph contract)', () => {
      // Avatar renders <HelixMark width={glyphSize} height={glyphSize} /> and
      // relies on the rest-spread winning over the size-derived defaults.
      const { container } = render(<HelixMark width={12} height={12} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '12')
      expect(svg).toHaveAttribute('height', '12')
    })
  })

  describe('stroke + colour', () => {
    it('routes `color` to the SVG stroke', () => {
      const { container } = render(<HelixMark color="#ff0000" />)
      expect(container.querySelector('svg')).toHaveAttribute('stroke', '#ff0000')
    })

    it('uses the raw `strokeWidth` when absoluteStrokeWidth is not set', () => {
      const { container } = render(<HelixMark size={48} strokeWidth={2} />)
      expect(container.querySelector('svg')).toHaveAttribute('stroke-width', '2')
    })

    it('scales the stroke to a constant pixel width when absoluteStrokeWidth is set', () => {
      // (strokeWidth * 24) / size = (2 * 24) / 48 = 1
      const { container } = render(
        <HelixMark size={48} strokeWidth={2} absoluteStrokeWidth />,
      )
      expect(container.querySelector('svg')).toHaveAttribute('stroke-width', '1')
    })

    it('never emits a non-finite stroke-width when size is 0 + absoluteStrokeWidth', () => {
      // Regression guard: a zero (or non-numeric) size must not divide by zero
      // and leak Infinity/NaN into the DOM — it falls back to the raw stroke.
      const { container } = render(
        <HelixMark size={0} strokeWidth={2} absoluteStrokeWidth />,
      )
      const raw = container.querySelector('svg')!.getAttribute('stroke-width')
      expect(Number.isFinite(Number(raw))).toBe(true)
      expect(raw).toBe('2')
    })
  })

  describe('prop + attribute forwarding', () => {
    it('applies a className to the SVG root', () => {
      const { container } = render(
        <HelixMark className="text-cyan-300 h-4 w-4" />,
      )
      const cls = container.querySelector('svg')?.getAttribute('class') ?? ''
      expect(cls).toContain('text-cyan-300')
      expect(cls).toContain('h-4')
    })

    it('forwards arbitrary SVG attributes (data-testid, aria-hidden) via prop spread', () => {
      render(<HelixMark data-testid="avatar-glyph" aria-hidden="true" />)
      const svg = screen.getByTestId('avatar-glyph')
      expect(svg.tagName.toLowerCase()).toBe('svg')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })

    it('supports an accessible-name path (role + aria-label) for standalone brand usage', () => {
      render(<HelixMark role="img" aria-label="Helix" />)
      expect(screen.getByRole('img', { name: 'Helix' })).toBeInTheDocument()
    })

    it('renders children inside the SVG (e.g. an a11y <title>)', () => {
      const { container } = render(
        <HelixMark>
          <title>Helix brand mark</title>
        </HelixMark>,
      )
      expect(container.querySelector('svg > title')?.textContent).toBe(
        'Helix brand mark',
      )
    })

    it('forwards a ref to the underlying SVG element', () => {
      const ref = createRef<SVGSVGElement>()
      const { container } = render(<HelixMark ref={ref} />)
      expect(ref.current).toBe(container.querySelector('svg'))
      expect(ref.current?.tagName.toLowerCase()).toBe('svg')
    })

    it('does not leak the internal `absoluteStrokeWidth` prop onto the DOM node', () => {
      const { container } = render(<HelixMark absoluteStrokeWidth />)
      const names = container
        .querySelector('svg')!
        .getAttributeNames()
        .map((n) => n.toLowerCase())
      expect(names).not.toContain('absolutestrokewidth')
    })
  })

  describe('Lucide drop-in compatibility', () => {
    it('is assignable to LucideIcon and usable as a nav-icon reference', () => {
      // Sidebar nav (`navSections.icon`) types the icon slot as LucideIcon and
      // renders it as a component reference — HelixMark must satisfy both.
      const Icon: LucideIcon = HelixMark
      render(<Icon role="img" aria-label="Helix nav" />)
      expect(screen.getByRole('img', { name: 'Helix nav' })).toBeInTheDocument()
    })
  })
})
