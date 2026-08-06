/**
 * SettingsActionCard contract.
 *
 * The shared "utility" card for the Settings quick-actions band. It has two
 * mutually-exclusive shapes driven by `href`:
 *
 *   1. Link card — the whole card becomes an <a> to `href`, gains a hover glow
 *      + pointer affordance and a decorative (aria-hidden) external-link glyph.
 *      Any `action` passed alongside `href` is intentionally dropped.
 *   2. Utility card — a plain panel that renders the trailing `action` node
 *      (or nothing) and never becomes a link.
 *
 * These tests lock in the branch selection, the `iconColor → tint`/`glow`
 * mapping, the robustness edges (empty-string href, absent data-tour), the a11y
 * affordances (focusable anchor with a visible focus ring, decorative glyph,
 * truncated-title tooltip), and the passthrough props (className, data-tour).
 * The component consumes no hooks, network, router, or i18n, so a bare render()
 * with no providers exercises it exactly as production does.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { SettingsActionCard, type SettingsActionCardProps } from './SettingsActionCard'
import { GLOW_CLASSES } from '@/components/ui/GlassPanel'

const DEFAULTS: Pick<SettingsActionCardProps, 'icon' | 'title' | 'description'> = {
  icon: <span data-testid="glyph" />,
  title: 'Data Export',
  description: 'Export drives and charging data',
}

function renderCard(overrides: Partial<SettingsActionCardProps> = {}) {
  return render(<SettingsActionCard {...DEFAULTS} {...overrides} />)
}

/** The GlassPanel root always carries the `data-print-card` marker. */
function panelOf(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-print-card]')
  expect(el).not.toBeNull()
  return el as HTMLElement
}

/** The IconBox is the direct parent of the glyph passed as `icon`. */
function iconBoxClasses(): string {
  return screen.getByTestId('glyph').parentElement?.className ?? ''
}

describe('SettingsActionCard — utility (non-link) card', () => {
  it('renders the icon, the title as a heading, and the description', () => {
    renderCard()

    expect(screen.getByTestId('glyph')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Data Export' })).toBeInTheDocument()
    expect(screen.getByText('Export drives and charging data')).toBeInTheDocument()
    // With no href the card is not a link.
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders no svg affordance when it is not a link', () => {
    const { container } = renderCard()
    // The only glyph is the caller's <span>; the ExternalLink svg is link-only.
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders a trailing action node in place of a link', () => {
    renderCard({ action: <button type="button">Run</button> })

    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('keeps the action slot interactive (its onClick fires)', () => {
    const onClick = vi.fn()
    renderCard({
      action: (
        <button type="button" onClick={onClick}>
          Run
        </button>
      ),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('SettingsActionCard — link card', () => {
  it('wraps the card in an anchor that points at href', () => {
    renderCard({ href: '/data-export' })

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/data-export')
  })

  it('derives the link accessible name from the title + description', () => {
    renderCard({ href: '/data-export' })

    const link = screen.getByRole('link', { name: /Data Export/i })
    expect(link).toBeInTheDocument()
    expect(link.textContent).toContain('Export drives and charging data')
  })

  it('renders a decorative external-link glyph and drops the action (mutually exclusive)', () => {
    const { container } = renderCard({
      href: '/data-export',
      action: <button type="button">Should not render</button>,
    })

    // The affordance is hidden from the a11y tree so the link name stays clean.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    // `action` is intentionally ignored while `href` is set.
    expect(screen.queryByRole('button', { name: 'Should not render' })).toBeNull()
  })

  it('exposes a keyboard-focusable anchor with a visible focus ring', () => {
    renderCard({ href: '/data-export' })

    const link = screen.getByRole('link')
    expect(link.className).toContain('focus-visible:ring-2')
    link.focus()
    expect(link).toHaveFocus()
  })

  it('adds a pointer affordance to the panel for links', () => {
    const { container } = renderCard({ href: '/data-export' })
    expect(panelOf(container).className).toContain('cursor-pointer')
  })
})

describe('SettingsActionCard — iconColor tint + glow mapping', () => {
  it('defaults to the cyan tint when iconColor is omitted', () => {
    renderCard()
    expect(iconBoxClasses()).toContain('text-cyan-300')
  })

  it('uses the green tint and a matching green hover glow for a green link', () => {
    const { container } = renderCard({ iconColor: 'green', href: '/x' })
    expect(iconBoxClasses()).toContain('text-emerald-300')
    expect(panelOf(container).className).toContain(GLOW_CLASSES.green)
  })

  it('uses the purple tint and a matching purple hover glow for a purple link', () => {
    const { container } = renderCard({ iconColor: 'purple', href: '/x' })
    expect(iconBoxClasses()).toContain('text-purple-300')
    expect(panelOf(container).className).toContain(GLOW_CLASSES.purple)
  })

  it('falls back to the cyan glow for a color GlassPanel cannot glow (red)', () => {
    const { container } = renderCard({ iconColor: 'red', href: '/x' })
    // The icon tint still reflects the requested color…
    expect(iconBoxClasses()).toContain('text-rose-300')
    // …but the panel glow degrades to cyan since GlassPanel has no red glow.
    expect(panelOf(container).className).toContain(GLOW_CLASSES.cyan)
  })
})

describe('SettingsActionCard — robustness + passthrough', () => {
  it('treats an empty-string href as a non-link and shows the action', () => {
    renderCard({ href: '', action: <button type="button">Run</button> })

    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  })

  it('forwards data-tour to the panel and omits it when unset', () => {
    const withTour = renderCard({ dataTour: 'settings-tour' })
    expect(withTour.container.querySelector('[data-tour="settings-tour"]')).not.toBeNull()

    const withoutTour = renderCard()
    expect(panelOf(withoutTour.container)).not.toHaveAttribute('data-tour')
  })

  it('merges a custom className onto the panel', () => {
    const { container } = renderCard({ className: 'ring-test-marker' })
    expect(panelOf(container).className).toContain('ring-test-marker')
  })
})

describe('SettingsActionCard — truncated title a11y', () => {
  it('exposes the full title via a native title attribute for truncated headings', () => {
    const title =
      'A very long Settings action card title that the panel heading visually truncates'
    renderCard({ title })

    const heading = screen.getByRole('heading', { name: title })
    // The heading clips overflow with `truncate`, so the full text must remain
    // reachable on hover / to assistive tech via the title attribute.
    expect(heading.className).toContain('truncate')
    expect(heading).toHaveAttribute('title', title)
  })
})
