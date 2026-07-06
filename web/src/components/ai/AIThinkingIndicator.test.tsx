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
// react-i18next's useTranslation returns the 2nd argument (English
// fallback) when no provider is mounted, so no i18n setup is needed —
// the same convention every sibling AI test in this dir relies on.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AIThinkingIndicator, AIThinkingDots } from './AIThinkingIndicator'
import type { AIThinkingIndicatorProps } from './AIThinkingIndicator'

const DEFAULT_LABEL = 'Helix is thinking'

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
})

describe('AIThinkingDots', () => {
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
})

describe('AIThinkingIndicator / AIThinkingDots — metadata', () => {
  it('exposes stable displayNames for React DevTools and the lazy loader', () => {
    expect(AIThinkingIndicator.displayName).toBe('AIThinkingIndicator')
    expect(AIThinkingDots.displayName).toBe('AIThinkingDots')
  })
})
