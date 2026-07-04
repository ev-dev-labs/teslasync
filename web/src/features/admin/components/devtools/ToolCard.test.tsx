/**
 * ToolCard contract tests.
 *
 * ToolCard is the shared presentational shell every dev-tool renders inside:
 * a GlassPanel with a colour-chipped icon, a title (h3), a description, and an
 * arbitrary body. The suite covers its single export end-to-end:
 *
 *   - text/structure: title exposed as a level-3 heading, description copy,
 *     and the caller-supplied children (composition slot);
 *   - icon: the passed component is rendered and the `h-5 w-5` sizing class is
 *     forwarded to it (mirrors how lucide icons receive className);
 *   - colour mapping: every ICON_COLOR_MAP entry resolves to its own chip
 *     classes, and the `?? ICON_COLOR_MAP.cyan` fallback covers both an unknown
 *     colour token and an empty string;
 *   - a11y: the decorative icon chip is `aria-hidden` so the accessible name of
 *     the card comes purely from the heading text, not the glyph.
 *
 * No network, hooks, or i18n are involved — ToolCard is pure — so a bare
 * render() is sufficient (the repo's global test-setup already stubs the
 * transitive settings/timezone hooks pulled in by the @/components/ui barrel).
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ComponentProps, SVGProps } from 'react'
import { ToolCard } from './ToolCard'
import { ICON_COLOR_MAP } from './constants'

// A stand-in for a lucide-react icon: a component that spreads the props it
// receives onto an <svg>, so we can assert the sizing className is forwarded.
function StubIcon(props: SVGProps<SVGSVGElement>) {
  return <svg data-testid="tool-icon" {...props} />
}

type Props = ComponentProps<typeof ToolCard>

const baseProps: Props = {
  icon: StubIcon,
  color: 'cyan',
  title: 'VIN Decoder',
  description: 'Decode a Tesla VIN',
  children: <span data-testid="tool-children">Body content</span>,
}

function renderCard(overrides: Partial<Props> = {}) {
  return render(<ToolCard {...baseProps} {...overrides} />)
}

/** The decorative chip wrapper is the icon's parent <div>. */
function getIconChip(): HTMLElement {
  const chip = screen.getByTestId('tool-icon').parentElement
  if (!chip) throw new Error('icon chip wrapper not found')
  return chip
}

describe('ToolCard', () => {
  it('renders the title as a level-3 heading, the description, and the children', () => {
    renderCard()

    expect(
      screen.getByRole('heading', { level: 3, name: 'VIN Decoder' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Decode a Tesla VIN')).toBeInTheDocument()
    expect(screen.getByTestId('tool-children')).toHaveTextContent('Body content')
  })

  it('renders the supplied icon component and forwards the h-5 w-5 sizing class', () => {
    renderCard()

    const icon = screen.getByTestId('tool-icon')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('h-5', 'w-5')
  })

  it('resolves each ICON_COLOR_MAP colour to its own chip classes', () => {
    for (const [color, classes] of Object.entries(ICON_COLOR_MAP)) {
      const { unmount } = renderCard({ color })
      const chip = getIconChip()
      for (const token of classes.split(' ')) {
        expect(chip).toHaveClass(token)
      }
      unmount()
    }
  })

  it('falls back to the cyan chip for an unknown colour token', () => {
    renderCard({ color: 'not-a-real-color' })

    const chip = getIconChip()
    for (const token of ICON_COLOR_MAP.cyan.split(' ')) {
      expect(chip).toHaveClass(token)
    }
    // The fallback must NOT leak a different palette's classes.
    expect(chip).not.toHaveClass('bg-neon-green/10')
    expect(chip).not.toHaveClass('text-neon-red')
  })

  it('falls back to the cyan chip for an empty colour string', () => {
    renderCard({ color: '' })

    expect(getIconChip()).toHaveClass('bg-neon-cyan/10')
  })

  it('marks the decorative icon chip aria-hidden so the name comes from the heading', () => {
    renderCard({ title: 'Hash Calculator' })

    // The glyph is decorative — hidden from assistive tech.
    expect(getIconChip()).toHaveAttribute('aria-hidden', 'true')
    // …so the card's only accessible name is the visible heading text.
    expect(
      screen.getByRole('heading', { name: 'Hash Calculator' }),
    ).toBeInTheDocument()
  })

  it('renders arbitrary interactive children in the body slot', () => {
    renderCard({ children: <button type="button">Run</button> })

    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    // The default text child from baseProps is replaced, not appended.
    expect(screen.queryByTestId('tool-children')).toBeNull()
  })
})
