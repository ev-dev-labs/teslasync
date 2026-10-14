// Comprehensive unit tests for AIThinkingIndicator.tsx.
//
// The module exports two presentational surfaces plus one prop type:
//
//   • AIThinkingIndicator — the full streaming-but-empty placeholder
//     (a labelled polite status region + bouncing dots + three shimmer
//     skeleton lines). Covered: the default Helix label, a caller
//     override, the empty/whitespace fallback (a status live region must
//     never announce blank), the decorative-visuals-are-aria-hidden a11y
//     contract, the exact skeleton/dot geometry, and the displayName.
//
//   • AIThinkingDots — the compact in-button variant (caller label plus
//     three aria-hidden bouncing dots). Covered: label rendering, the
//     dots-are-decorative contract, dot geometry, and the displayName.
//
// The translation stub defaults to English fallbacks and can supply
// localized copy without changing the component's translation contract.

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AIThinkingIndicator, AIThinkingDots } from './AIThinkingIndicator'
import type { AIThinkingIndicatorProps } from './AIThinkingIndicator'

const DEFAULT_LABEL = 'Helix is thinking'

const { translate } = vi.hoisted(() => ({
  translate: vi.fn((_key: string, fallback: string) => fallback),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}))

beforeEach(() => {
  translate.mockReset()
  translate.mockImplementation((_key: string, fallback: string) => fallback)
})

describe('AIThinkingIndicator — label resolution', () => {
  it('renders the default Helix label inside a polite status live region', () => {
    render(<AIThinkingIndicator />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('data-testid', 'ai-thinking-indicator')
    expect(status).toHaveTextContent(DEFAULT_LABEL)
  })

  it('uses a caller-supplied label verbatim when provided', () => {
    const props: AIThinkingIndicatorProps = { label: 'Helix is summarising' }
    render(<AIThinkingIndicator {...props} />)

    expect(screen.getByRole('status')).toHaveTextContent('Helix is summarising')
    expect(screen.queryByText(DEFAULT_LABEL)).not.toBeInTheDocument()
  })

  it('falls back to the default when the label is an empty string (never a blank live region)', () => {
    render(<AIThinkingIndicator label="" />)

    expect(screen.getByRole('status')).toHaveTextContent(DEFAULT_LABEL)
  })

  it('falls back to the default when the label is whitespace-only', () => {
    render(<AIThinkingIndicator label="   " />)

    expect(screen.getByRole('status')).toHaveTextContent(DEFAULT_LABEL)
  })

  it.each([undefined, '', '   '])('retains a localized nonblank status for label %j', (label) => {
    translate.mockReturnValue('Helix denkt nach')
    render(<AIThinkingIndicator label={label} />)

    expect(translate).toHaveBeenCalledWith('helix.thinkingStatusLabel', DEFAULT_LABEL)
    expect(screen.getByRole('status')).toHaveTextContent('Helix denkt nach')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})

describe('AIThinkingIndicator — accessibility + geometry', () => {
  it('marks the brand glyph decorative so it is not announced beside the label', () => {
    const { container } = render(
      <AIThinkingIndicator label="Helix is working" />,
    )

    const glyph = container.querySelector('svg')
    expect(glyph).not.toBeNull()
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
  })

  it('announces exactly the label — dots and skeleton lines carry no text', () => {
    render(<AIThinkingIndicator label="Helix is working" />)

    // The glyph, the dots wrapper and the skeleton wrapper are all
    // aria-hidden and text-free, so the live region's spoken content is
    // precisely the label (no empty divs, no dot noise, no double-read).
    expect(screen.getByRole('status').textContent).toBe('Helix is working')
  })

  it('renders three shimmer skeleton lines and three bouncing dots', () => {
    const { container } = render(<AIThinkingIndicator />)

    // Skeleton lines use rounded-md; the bouncing dots use rounded-full.
    expect(container.querySelectorAll('.rounded-md')).toHaveLength(3)
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(3)
  })

  it('uses neutral theme roles for the label, glyph, dots and skeleton paints', () => {
    const { container } = render(<AIThinkingIndicator />)
    const labelRow = screen.getByText(DEFAULT_LABEL).parentElement
    const glyph = container.querySelector('svg')
    const dots = container.querySelectorAll('.rounded-full')
    const lines = container.querySelectorAll('.rounded-md')

    expect(labelRow).toHaveClass('text-[var(--text-secondary)]')
    expect(glyph).toHaveAttribute('stroke', 'currentColor')
    expect(glyph?.getAttribute('class')).not.toMatch(/text-/)
    for (const dot of dots) {
      expect(dot).toHaveClass('bg-current')
      expect(dot.parentElement).toHaveAttribute('aria-hidden', 'true')
    }
    for (const line of lines) {
      expect(line).toHaveClass(
        'bg-[linear-gradient(90deg,var(--skeleton-bg)_0%,var(--border-strong)_50%,var(--skeleton-bg)_100%)]',
      )
      expect(line.parentElement).toHaveAttribute('aria-hidden', 'true')
    }
    expect(container.innerHTML).not.toMatch(/(?:text|bg)-(?:cyan|white|neon)|rgba?\(|#[\da-f]{3,8}/i)
  })

  it('preserves skeleton geometry, shimmer timing and OS motion-safe decoration', () => {
    const { container } = render(<AIThinkingIndicator />)
    const lines = container.querySelectorAll('.rounded-md')
    const dots = container.querySelectorAll('.rounded-full')
    const widths = ['w-full', 'w-11/12', 'w-9/12']

    expect(container.querySelector('svg')).toHaveClass('h-4', 'w-4', 'motion-safe:animate-pulse')
    lines.forEach((line, index) => {
      expect(line).toHaveClass('h-3', widths[index], 'rounded-md', 'motion-safe:animate-shimmer', 'bg-[length:200%_100%]')
    })
    expect(lines[1]).toHaveClass('[animation-delay:0.3s]')
    expect(lines[2]).toHaveClass('[animation-delay:0.6s]')
    dots.forEach((dot) => {
      expect(dot).toHaveClass('h-1', 'w-1', 'rounded-full', 'motion-safe:animate-bounce')
    })
    expect(dots[0]).toHaveClass('motion-safe:[animation-delay:-0.3s]')
    expect(dots[1]).toHaveClass('motion-safe:[animation-delay:-0.15s]')
    for (const element of container.querySelectorAll('[class]')) {
      expect(element.getAttribute('class')).not.toMatch(/(?:^|\s)animate-/)
    }
  })
})

describe('AIThinkingDots', () => {
  it('lets long labels shrink and wrap while keeping decorative dots intact', () => {
    const { container } = render(
      <AIThinkingDots label="A complete long localized thinking label" />,
    )
    const label = screen.getByText('A complete long localized thinking label')
    expect(label).toHaveClass('min-w-0', 'break-words')
    expect(label.parentElement).toHaveClass('min-w-0', 'max-w-full')
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('shrink-0')
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(3)
    expect(container.textContent).toBe('A complete long localized thinking label')
  })

  it('renders the caller label followed by three decorative bouncing dots', () => {
    const { container } = render(<AIThinkingDots label="Generating coaching" />)

    expect(screen.getByText('Generating coaching')).toBeInTheDocument()
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(3)
  })

  it('hides the dots from assistive tech so the accessible name stays the label', () => {
    const { container } = render(<AIThinkingDots label="Summarising" />)

    const hidden = container.querySelector('[aria-hidden="true"]')
    expect(hidden).not.toBeNull()
    // The dots carry no text — the only announced content is the label.
    expect(container.textContent).toBe('Summarising')
  })

  it('preserves compact dots inheriting the caller foreground and OS motion-safe timing', () => {
    const { container } = render(<AIThinkingDots label="Helix denkt nach" />)
    const dots = container.querySelectorAll('.rounded-full')

    expect(dots).toHaveLength(3)
    dots.forEach((dot) => {
      expect(dot).toHaveClass('h-1', 'w-1', 'bg-current', 'motion-safe:animate-bounce')
      expect(dot.parentElement).toHaveAttribute('aria-hidden', 'true')
    })
    expect(dots[0]).toHaveClass('motion-safe:[animation-delay:-0.3s]')
    expect(dots[1]).toHaveClass('motion-safe:[animation-delay:-0.15s]')
    expect(container.textContent).toBe('Helix denkt nach')
  })
})

describe('AIThinkingIndicator / AIThinkingDots — metadata', () => {
  it('exposes stable displayNames for React DevTools and the lazy loader', () => {
    expect(AIThinkingIndicator.displayName).toBe('AIThinkingIndicator')
    expect(AIThinkingDots.displayName).toBe('AIThinkingDots')
  })
})
