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
import { useEffect } from 'react'

const motionPreference = vi.hoisted(() => ({ reduce: false }))
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({
    reduce: motionPreference.reduce,
    durationMs: motionPreference.reduce ? 0 : 250,
  }),
}))

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
    useReducedMotion: () => false,
  }
})

import { Accordion } from './Accordion'
import { typography } from '@/lib/tokens'

const BODY = <div data-testid="body">panel content</div>

afterEach(() => {
  cleanup()
  motionPreference.reduce = false
})

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

  it('exposes a visible focus outline on the trigger for keyboard users (WCAG 2.4.7)', () => {
    render(<Accordion title="Details">{BODY}</Accordion>)
    const toggle = screen.getByRole('button')
    // Native <button type="button"> → platform keyboard operability, no submit.
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle).toHaveAttribute('type', 'button')
    expect(toggle).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-[var(--focus-ring)]', 'focus-visible:-outline-offset-2')
    toggle.focus()
    expect(toggle).toHaveFocus()
  })
})

describe('<Accordion /> — styling overrides', () => {
  it('inherits header size through the named role without removing foreground, weight or descendant roles', () => {
    render(<Accordion title="Details" description="Instructions">{BODY}</Accordion>)
    const toggle = screen.getByRole('button', { name: 'Details' })
    expect(typography.size.inherit).toBe('text-size-inherit')
    expect(toggle).toHaveClass(typography.size.inherit, 'font-normal', 'text-[var(--text-primary)]')
    expect(toggle).not.toHaveClass('text-sm', 'text-[length:inherit]')
    expect(screen.getByText('Details')).toHaveClass('text-sm', 'font-medium')
    expect(screen.getByText('Instructions')).toHaveClass('text-sm', 'font-normal', 'forced-colors:text-[ButtonText]')
  })

  it.each(['text-lg', 'text-size-inherit', 'text-[length:2em]'])('preserves caller header size precedence for %s', (headerClassName) => {
    render(<Accordion title="Details" headerClassName={headerClassName}>{BODY}</Accordion>)
    const toggle = screen.getByRole('button')
    expect(toggle).toHaveClass(headerClassName, 'text-[var(--text-primary)]', 'font-normal')
    expect(toggle).not.toHaveClass('text-sm')
    if (headerClassName !== typography.size.inherit) {
      expect(toggle).not.toHaveClass(typography.size.inherit)
    }
  })

  it('applies className to the root and default paddings when none supplied', () => {
    const { container } = render(
      <Accordion title="Details" className="mt-4" defaultOpen>
        {BODY}
      </Accordion>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('mt-4')
    expect(root.className).toContain('rounded-panel')

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

  it('uses existing neutral border, hover and typography roles in the open state', () => {
    const { container } = render(<Accordion title="Details" defaultOpen>{BODY}</Accordion>)
    expect(container.firstElementChild).toHaveClass('rounded-panel', 'border-[var(--border-default)]')
    expect(screen.getByRole('button')).toHaveClass('hover:bg-[var(--control-bg)]')
    expect(screen.getByText('Details')).toHaveClass('text-sm', 'font-medium', 'text-[var(--text-primary)]')
    expect(container.querySelector('.border-t')).toHaveClass('border-[var(--border-subtle)]')
    expect(container.querySelector('[class*="border-white"], [class*="ring-cyan"], [class*="hover:bg-white"]')).toBeNull()
  })

  it('removes chevron motion for the shared reduced-motion or low-bandwidth preference without changing disclosure', () => {
    motionPreference.reduce = true
    const { container } = render(<Accordion title="Details">{BODY}</Accordion>)
    const chevron = container.querySelector('svg')
    expect(chevron).toHaveClass('motion-reduce:transition-none', 'transition-none')
    fireEvent.click(screen.getByRole('button'))
    expect(chevron).toHaveClass('rotate-180', 'transition-none')
    expect(screen.getByRole('region', { name: 'Details' })).toContainElement(screen.getByTestId('body'))
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('region')).toBeNull()
  })
})

describe('<Accordion /> — stacked description', () => {
  it('keeps rich description in the identity block, before unchanged trailing slots', () => {
    render(
      <Accordion
        title="Health probes"
        description={<>Liveness and <strong>readiness</strong> checks</>}
        badge={<span data-testid="badge">2</span>}
        headerExtra={<span data-testid="extra">Updated recently</span>}
      >
        {BODY}
      </Accordion>,
    )

    const toggle = screen.getByRole('button', { name: 'Health probes' })
    const title = screen.getByText('Health probes')
    const description = document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    const identity = title.parentElement
    expect(description).toHaveTextContent('Liveness and readiness checks')
    expect(description?.querySelector('strong')).toHaveTextContent('readiness')
    expect(description?.parentElement).toBe(identity)
    expect(identity?.children[0]).toBe(title)
    expect(identity?.children[1]).toBe(description)
    expect(identity?.nextElementSibling).toBe(screen.getByTestId('badge'))
    expect(screen.getByTestId('badge').nextElementSibling).toBe(screen.getByTestId('extra'))
    expect(screen.getByTestId('extra').parentElement).toBe(toggle)
    expect(toggle).toHaveAccessibleDescription('Liveness and readiness checks')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('body')).toBeNull()
  })

  it('preserves the description and stable title/region association across disclosure', () => {
    render(
      <Accordion title="Utilities" description="Convert between Unix and ISO 8601 timestamps">
        {BODY}
      </Accordion>,
    )
    const toggle = screen.getByRole('button', { name: 'Utilities' })
    const descriptionId = toggle.getAttribute('aria-describedby')
    const titleId = toggle.getAttribute('aria-labelledby')
    const panelId = toggle.getAttribute('aria-controls')

    fireEvent.click(toggle)
    const region = screen.getByRole('region', { name: 'Utilities' })
    expect(region.id).toBe(panelId)
    expect(region).toHaveAttribute('aria-labelledby', titleId)
    expect(toggle).toHaveAccessibleDescription('Convert between Unix and ISO 8601 timestamps')
    expect(region).not.toHaveAttribute('aria-describedby')
    expect(region).toContainElement(screen.getByTestId('body'))

    fireEvent.click(toggle)
    expect(screen.queryByRole('region')).toBeNull()
    expect(toggle).toHaveAttribute('aria-describedby', descriptionId)
    expect(document.getElementById(descriptionId ?? '')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not mount lazy content while collapsed and unmounts it after closing', () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()
    function LazyContent() {
      useEffect(() => {
        mounted()
        return () => { unmounted() }
      }, [])
      return BODY
    }
    render(
      <Accordion title="Utilities" description="Caller-provided instructions">
        <LazyContent />
      </Accordion>,
    )
    expect(mounted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    expect(mounted).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    expect(unmounted).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Caller-provided instructions')).toBeInTheDocument()
  })

  it('keeps controlled state parent-owned with description even when defaultOpen is true', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <Accordion title="Probes" description="Live checks" defaultOpen open={false} onOpenChange={onOpenChange}>
        {BODY}
      </Accordion>,
    )
    const toggle = screen.getByRole('button', { name: 'Probes' })
    fireEvent.click(toggle)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('body')).toBeNull()
    rerender(
      <Accordion title="Probes" description="Live checks" open onOpenChange={onOpenChange}>
        {BODY}
      </Accordion>,
    )
    expect(screen.getByRole('region', { name: 'Probes' })).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleDescription('Live checks')
  })

  it.each([undefined, null, false, ''])('omits absent description %s without changing the legacy name', (description) => {
    render(
      <Accordion title="Details" description={description} badge={<span>3</span>} headerExtra={<span>search</span>}>
        {BODY}
      </Accordion>,
    )
    const toggle = screen.getByRole('button')
    expect(toggle).not.toHaveAttribute('aria-describedby')
    expect(toggle).not.toHaveAttribute('aria-labelledby')
    expect(toggle).toHaveAccessibleName('Details3search')
    expect(screen.getByText('Details').parentElement?.children).toHaveLength(1)
  })

  it('renders a numeric zero description rather than treating it as absent', () => {
    render(<Accordion title="Count" description={0}>{BODY}</Accordion>)
    expect(screen.getByRole('button', { name: 'Count' })).toHaveAccessibleDescription('0')
  })

  it('retains full localized text and narrow/RTL/text-resize containment hooks without truncation', () => {
    const titleText = 'فحوصات الحالة والخدمات'.repeat(8)
    const descriptionText = 'وصف طويل للخدمات ' + 'unbroken-localized-reference'.repeat(24)
    const { container } = render(
      <div dir="rtl" className="w-40 text-[200%]">
        <Accordion title={titleText} description={descriptionText} defaultOpen>
          {BODY}
        </Accordion>
      </div>,
    )
    const toggle = screen.getByRole('button', { name: titleText })
    const title = screen.getByText(titleText)
    const description = screen.getByText(descriptionText)
    expect(toggle).toHaveClass('h-auto', 'flex-wrap', 'text-start')
    expect(title.parentElement).toHaveClass('min-w-0', 'flex-1', '[overflow-wrap:anywhere]')
    expect(title).toHaveClass('block', 'text-[var(--text-primary)]')
    expect(description).toHaveClass('block', 'whitespace-normal', 'text-[var(--text-secondary)]')
    expect(description).toHaveClass('forced-colors:text-[ButtonText]')
    expect(container.querySelector('[dir="rtl"]')).toContainElement(toggle)
    expect(toggle.className).toContain('forced-colors:focus-visible:outline')
    expect(container.querySelector('.forced-colors\\:border-\\[CanvasText\\]')).not.toBeNull()
    expect(container.querySelector('[class*="truncate"], [class*="line-clamp"], [class*="text-ellipsis"]')).toBeNull()
    expect(toggle).toHaveAccessibleDescription(descriptionText)
    expect(screen.getByRole('region', { name: titleText })).toBeInTheDocument()
  })
})
