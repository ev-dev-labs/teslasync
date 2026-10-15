// Comprehensive unit tests for AIThinkingIndicator.tsx.
//
// The module exports two presentational surfaces plus one prop type:
//
//   • AIThinkingIndicator — the full streaming-but-empty placeholder
//     (a labelled polite status region + static dots + three static
//     skeleton lines). Covered: the default Helix label, a caller
//     override, the empty/whitespace fallback (a status live region must
//     never announce blank), the decorative-visuals-are-aria-hidden a11y
//     contract, the exact skeleton/dot geometry, and the displayName.
//
//   • AIThinkingDots — the compact in-button variant (caller label plus
//     three aria-hidden static dots). Covered: label rendering, the
//     dots-are-decorative contract, dot geometry, and the displayName.
//
// The translation stub defaults to English fallbacks and can supply
// localized copy without changing the component's translation contract.

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AIThinkingIndicator, AIThinkingDots } from './AIThinkingIndicator'
import type { AIThinkingIndicatorProps } from './AIThinkingIndicator'

const DEFAULT_LABEL = 'Helix is thinking'

const { translate, motionPreference } = vi.hoisted(() => ({
  translate: vi.fn((_key: string, fallback: string) => fallback),
  motionPreference: vi.fn(() => ({ reduce: false, durationMs: 250 })),
}))

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: motionPreference,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}))

beforeEach(() => {
  motionPreference.mockReset()
  motionPreference.mockReturnValue({ reduce: false, durationMs: 250 })
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

  it('renders three static skeleton lines and three static dots', () => {
    const { container } = render(<AIThinkingIndicator />)

    // Skeleton lines use rounded-md; the dots use rounded-full.
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
        'bg-[var(--skeleton-bg)]',
      )
      expect(line.parentElement).toHaveAttribute('aria-hidden', 'true')
    }
    expect(container.innerHTML).not.toMatch(/(?:text|bg)-(?:cyan|white|neon)|rgba?\(|#[\da-f]{3,8}/i)
  })

  it('preserves skeleton and dot geometry without decorative loops or bloom', () => {
    const { container } = render(<AIThinkingIndicator />)
    const lines = container.querySelectorAll('.rounded-md')
    const dots = container.querySelectorAll('.rounded-full')
    const widths = ['w-full', 'w-11/12', 'w-9/12']

    expect(container.querySelector('svg')).toHaveClass('h-4', 'w-4')
    lines.forEach((line, index) => {
      expect(line).toHaveClass('h-3', widths[index], 'rounded-md', 'bg-[var(--skeleton-bg)]')
    })
    dots.forEach((dot) => {
      expect(dot).toHaveClass('h-1', 'w-1', 'rounded-full')
    })
    for (const element of container.querySelectorAll('[class]')) {
      expect(element.getAttribute('class')).not.toMatch(/animate-|animation-delay|gradient|glow|shadow|blur/)
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

  it('renders the caller label followed by three decorative static dots', () => {
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

  it('preserves static compact dots inheriting the caller foreground', () => {
    const { container } = render(<AIThinkingDots label="Helix denkt nach" />)
    const dots = container.querySelectorAll('.rounded-full')

    expect(dots).toHaveLength(3)
    dots.forEach((dot) => {
      expect(dot).toHaveClass('h-1', 'w-1', 'bg-current')
      expect(dot.parentElement).toHaveAttribute('aria-hidden', 'true')
    })
    expect(container.innerHTML).not.toMatch(/animate-|animation-delay|gradient|glow|shadow|blur/)
    expect(container.textContent).toBe('Helix denkt nach')
  })
})

describe('shared motion preference', () => {
  it.each([
    { mode: 'normal', reduce: false },
    { mode: 'OS reduced motion', reduce: true },
    { mode: 'low bandwidth', reduce: true },
  ])('retains static busy feedback in $mode mode and reacts to preference changes', ({ reduce }) => {
    motionPreference.mockReturnValue({ reduce, durationMs: reduce ? 0 : 250 })
    const { container, rerender } = render(
      <>
        <AIThinkingIndicator label="Working" />
        <AIThinkingDots label="Summarising" />
      </>,
    )

    const assertStaticFeedback = (reduced: boolean) => {
      expect(motionPreference).toHaveBeenCalled()
      expect(screen.getByRole('status')).toHaveTextContent('Working')
      expect(screen.getByText('Summarising')).toBeVisible()
      expect(container.querySelectorAll('.rounded-md')).toHaveLength(3)
      expect(container.querySelectorAll('.rounded-full')).toHaveLength(6)
      expect(container.querySelectorAll('.animate-none')).toHaveLength(reduced ? 2 : 0)
      expect(container.innerHTML).not.toMatch(/animate-(?!none)|animation-delay|gradient|glow|shadow|blur/)
    }
    assertStaticFeedback(reduce)

    motionPreference.mockReturnValue({ reduce: !reduce, durationMs: reduce ? 250 : 0 })
    rerender(
      <>
        <AIThinkingIndicator label="Working" />
        <AIThinkingDots label="Summarising" />
      </>,
    )
    assertStaticFeedback(!reduce)
  })
})

describe('AIThinkingIndicator / AIThinkingDots — metadata', () => {
  it('exposes stable displayNames for React DevTools and the lazy loader', () => {
    expect(AIThinkingIndicator.displayName).toBe('AIThinkingIndicator')
    expect(AIThinkingDots.displayName).toBe('AIThinkingDots')
  })
})
