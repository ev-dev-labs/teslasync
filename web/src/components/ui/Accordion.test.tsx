/**
 * Accordion.tsx — full behaviour, branch, edge-case, and a11y cover for the
 * single export in the file: <Accordion>. This is a self-contained disclosure
 * widget (no network, no data hooks), so the interesting surface is:
 *
 *   • STATE      — the dual controlled/uncontrolled contract. Uncontrolled
 *                  toggles its own state; controlled defers to the parent and
 *                  only becomes controlled when BOTH `open` AND `onOpenChange`
 *                  are supplied (the documented semantic in AccordionProps).
 *   • A11Y       — WAI-ARIA disclosure wiring: the trigger exposes
 *                  `aria-expanded` + `aria-controls`, the revealed panel is a
 *                  `role="region"` labelled by the header title, decorative
 *                  glyphs (icon + chevron) are hidden from assistive tech, and
 *                  the trigger carries a visible focus ring (WCAG 2.4.7).
 *   • SLOTS      — icon / badge / headerExtra render into the header; the
 *                  chevron rotates only while expanded.
 *   • STYLING    — className lands on the root, and headerClassName /
 *                  bodyClassName override the default paddings (else the
 *                  defaults apply).
 *
 * framer-motion is mocked so `<motion.div>` renders a plain <div> (surfacing
 * the id/role/aria props) and <AnimatePresence> renders its children
 * synchronously — otherwise the exit animation keeps the panel mounted in
 * jsdom and the close assertions flake. `@testing-library/user-event` is not a
 * dependency of this repo, so interactions are driven with `fireEvent`
 * (matching the sibling AccordionSection.test.tsx / Popover.test.tsx).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// Render every `motion.<tag>` as its plain DOM element, dropping framer-only
// animation props but passing through real DOM attributes (id, role,
// aria-labelledby, className). AnimatePresence becomes a Fragment so the
// `{open && …}` gate mounts/unmounts synchronously.
vi.mock('framer-motion', async () => {
  const React = await import('react')
  const FRAMER_ONLY = new Set([
    'initial', 'animate', 'exit', 'transition', 'variants', 'layout', 'layoutId',
    'whileHover', 'whileTap', 'whileFocus', 'whileInView', 'whileDrag', 'drag',
    'onAnimationStart', 'onAnimationComplete', 'onUpdate', 'custom',
  ])
  const makeMotion = (tag: string) =>
    function MotionEl({
      children,
      ...rest
    }: Record<string, unknown> & { children?: React.ReactNode }) {
      const domProps: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rest)) {
        if (!FRAMER_ONLY.has(k)) domProps[k] = v
      }
      return React.createElement(tag, domProps, children)
    }
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) =>
      typeof prop === 'string' && prop !== 'then' ? makeMotion(prop) : undefined,
  })
  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  }
})

import { Accordion } from './Accordion'

const BODY = <div data-testid="body">panel content</div>

afterEach(cleanup)

describe('<Accordion /> — uncontrolled', () => {
  it('is collapsed by default: header shows, panel is unmounted, no region', () => {
    render(<Accordion title="Advanced settings">{BODY}</Accordion>)

    expect(screen.getByText('Advanced settings')).toBeInTheDocument()
    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Children mount lazily only while open.
    expect(screen.queryByTestId('body')).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('renders the panel when defaultOpen and wires the trigger to its region', () => {
    render(
      <Accordion title="Advanced settings" defaultOpen>
        {BODY}
      </Accordion>,
    )

    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('body')).toBeInTheDocument()

    // aria-controls on the trigger must point at the rendered region, and the
    // region must be labelled by the header title (disclosure ↔ panel wiring).
    const region = screen.getByRole('region', { name: 'Advanced settings' })
    expect(toggle).toHaveAttribute('aria-controls', region.id)
    const labelledBy = region.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)).toHaveTextContent(
      'Advanced settings',
    )
  })

  it('toggles open then closed on click, flipping aria-expanded and the panel', () => {
    render(<Accordion title="Details">{BODY}</Accordion>)
    const toggle = screen.getByRole('button')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('body')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('body')).toBeNull()
  })

  it('ignores `open` when `onOpenChange` is absent (documented: both required)', () => {
    // `open` alone must NOT flip the component into controlled mode — it stays
    // uncontrolled, governed by internal state (defaultOpen === false here).
    render(
      <Accordion title="Details" open>
        {BODY}
      </Accordion>,
    )
    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('body')).toBeNull()

    // …and clicking still drives its own internal state.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('body')).toBeInTheDocument()
  })
})

describe('<Accordion /> — controlled', () => {
  it('defers to the parent: click reports the next value without self-toggling', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <Accordion title="Filters" open={false} onOpenChange={onOpenChange}>
        {BODY}
      </Accordion>,
    )
    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('body')).toBeNull()

    fireEvent.click(toggle)
    // Parent is told to open; internal state does NOT change on its own.
    expect(onOpenChange).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('body')).toBeNull()

    // Parent flips the prop → the panel reveals.
    rerender(
      <Accordion title="Filters" open onOpenChange={onOpenChange}>
        {BODY}
      </Accordion>,
    )
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('body')).toBeInTheDocument()

    // Clicking while open asks the parent to close.
    fireEvent.click(screen.getByRole('button'))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('lets the controlled `open` prop win over defaultOpen', () => {
    render(
      <Accordion
        title="Filters"
        defaultOpen
        open={false}
        onOpenChange={vi.fn()}
      >
        {BODY}
      </Accordion>,
    )
    // defaultOpen would open an uncontrolled accordion, but controlled open=false wins.
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('body')).toBeNull()
  })
})

describe('<Accordion /> — slots & accessibility', () => {
  it('hides the decorative icon from AT and keeps it out of the accessible name', () => {
    render(
      <Accordion title="Details" icon={<span>BOLT</span>}>
        {BODY}
      </Accordion>,
    )
    const toggle = screen.getByRole('button')
    // Icon text is present visually but excluded from the name (wrapper hidden).
    expect(screen.getByText('BOLT').parentElement).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(toggle).toHaveAccessibleName('Details')
  })

  it('renders badge and headerExtra slots into the header', () => {
    render(
      <Accordion
        title="Details"
        badge={<span data-testid="badge">3</span>}
        headerExtra={<span data-testid="extra">search</span>}
      >
        {BODY}
      </Accordion>,
    )
    const toggle = screen.getByRole('button')
    expect(toggle).toContainElement(screen.getByTestId('badge'))
    expect(toggle).toContainElement(screen.getByTestId('extra'))
  })

  it('marks the chevron decorative and rotates it only while expanded', () => {
    const { container } = render(<Accordion title="Details">{BODY}</Accordion>)
    // No icon rendered → the only svg is the chevron.
    const chevron = container.querySelector('svg') as SVGSVGElement
    expect(chevron).not.toBeNull()
    expect(chevron).toHaveAttribute('aria-hidden', 'true')
    expect(chevron.classList.contains('rotate-180')).toBe(false)

    fireEvent.click(screen.getByRole('button'))
    expect(container.querySelector('svg.rotate-180')).not.toBeNull()
  })

  it('exposes a visible focus ring on the trigger for keyboard users (WCAG 2.4.7)', () => {
    render(<Accordion title="Details">{BODY}</Accordion>)
    const toggle = screen.getByRole('button')
    // Native <button type="button"> → platform keyboard operability, no submit.
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle).toHaveAttribute('type', 'button')
    expect(toggle.className).toContain('focus-visible:ring-2')
  })
})

describe('<Accordion /> — styling overrides', () => {
  it('applies className to the root and default paddings when none supplied', () => {
    const { container } = render(
      <Accordion title="Details" className="mt-4" defaultOpen>
        {BODY}
      </Accordion>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('mt-4')
    expect(root.className).toContain('rounded-xl')

    // Header + body fall back to the px-4 py-3 defaults.
    const toggle = screen.getByRole('button')
    expect(toggle.className).toContain('px-4')
    expect(toggle.className).toContain('py-3')
    const bodyWrap = container.querySelector('.border-t') as HTMLElement
    expect(bodyWrap.className).toContain('px-4')
    expect(bodyWrap.className).toContain('py-3')
  })

  it('replaces the default paddings when headerClassName / bodyClassName given', () => {
    const { container } = render(
      <Accordion
        title="Details"
        defaultOpen
        headerClassName="p-8"
        bodyClassName="p-1"
      >
        {BODY}
      </Accordion>,
    )
    const toggle = screen.getByRole('button')
    expect(toggle.className).toContain('p-8')
    expect(toggle.className).not.toContain('px-4')

    const bodyWrap = container.querySelector('.border-t') as HTMLElement
    expect(bodyWrap.className).toContain('p-1')
    expect(bodyWrap.className).not.toContain('px-4')
  })
})
