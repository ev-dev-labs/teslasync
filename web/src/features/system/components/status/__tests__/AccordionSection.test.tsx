import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Activity } from 'lucide-react'

import { AccordionSection } from '../AccordionSection'

/**
 * AccordionSection is a self-contained disclosure widget with no network or
 * router dependencies, so a bare render() is sufficient — `@testing-library/
 * user-event` is intentionally NOT a dependency of this repo, so keyboard and
 * pointer interactions are driven with `fireEvent` (matching the sibling
 * status-card tests, e.g. BackupActionsCard.test.tsx).
 */
function renderSection(
  props: Partial<React.ComponentProps<typeof AccordionSection>> = {},
) {
  const {
    icon = <Activity data-testid="section-icon" className="h-5 w-5" />,
    title = 'Health Probes',
    description = 'Liveness and readiness checks',
    children = <div data-testid="panel-content">inner content</div>,
    ...rest
  } = props
  return render(
    <AccordionSection icon={icon} title={title} description={description} {...rest}>
      {children}
    </AccordionSection>,
  )
}

describe('AccordionSection', () => {
  it('is collapsed by default: header shows but the panel content is not mounted', () => {
    renderSection()

    expect(screen.getByText('Health Probes')).toBeInTheDocument()
    expect(screen.getByText('Liveness and readiness checks')).toBeInTheDocument()
    // Children are lazily mounted only while open — a deliberate perf choice
    // for the heavy status sections that consume this component.
    expect(screen.queryByTestId('panel-content')).toBeNull()

    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('renders the panel when defaultOpen and programmatically links the toggle to its region', () => {
    renderSection({ defaultOpen: true })

    const toggle = screen.getByRole('button')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('panel-content')).toBeInTheDocument()

    // The disclosure↔panel wiring: aria-controls on the toggle must point at
    // the rendered region, and the region must be labelled by the header title.
    const region = screen.getByRole('region', { name: /Health Probes/ })
    expect(toggle).toHaveAttribute('aria-controls', region.id)
    const labelledBy = region.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)).toHaveTextContent(
      'Health Probes',
    )
  })

  it('toggles open then closed on click', () => {
    renderSection()
    const toggle = screen.getByRole('button')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('panel-content')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('panel-content')).toBeNull()
  })

  it('is keyboard operable via Enter, and preventDefault-s the activation', () => {
    renderSection()
    const toggle = screen.getByRole('button')

    // fireEvent returns false when the handler called preventDefault().
    const notCancelled = fireEvent.keyDown(toggle, { key: 'Enter' })
    expect(notCancelled).toBe(false)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(toggle, { key: 'Enter' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('is keyboard operable via Space and prevents the default page scroll', () => {
    renderSection()
    const toggle = screen.getByRole('button')

    const cancelled = fireEvent.keyDown(toggle, { key: ' ' })
    expect(cancelled).toBe(false)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('panel-content')).toBeInTheDocument()
  })

  it('ignores non-activation keys without toggling or cancelling the event', () => {
    renderSection()
    const toggle = screen.getByRole('button')

    const notCancelled = fireEvent.keyDown(toggle, { key: 'a' })
    expect(notCancelled).toBe(true)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('panel-content')).toBeNull()
  })

  it('renders badges when provided and omits the badge slot otherwise', () => {
    const { unmount } = renderSection({
      badges: <span data-testid="badge">Live</span>,
    })
    expect(screen.getByTestId('badge')).toHaveTextContent('Live')
    unmount()

    renderSection()
    expect(screen.queryByTestId('badge')).toBeNull()
  })

  it('exposes an accessible name from the title and hides decorative icons from assistive tech', () => {
    renderSection()
    const toggle = screen.getByRole('button')

    expect(toggle).toHaveAttribute('tabindex', '0')
    // Name is derived from the visible title/description, not the decorative icon.
    expect(toggle).toHaveAccessibleName(/Health Probes/)
    expect(screen.getByTestId('section-icon').parentElement).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    // A visible focus indicator is present for keyboard users (WCAG 2.4.7).
    expect(toggle.className).toContain('focus-visible:ring-2')
  })

  it('rotates the chevron indicator only while expanded', () => {
    const { container } = renderSection()
    expect(container.querySelector('svg.rotate-180')).toBeNull()

    fireEvent.click(screen.getByRole('button'))
    expect(container.querySelector('svg.rotate-180')).not.toBeNull()
  })
})
