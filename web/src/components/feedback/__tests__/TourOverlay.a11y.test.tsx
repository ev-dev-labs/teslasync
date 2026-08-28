import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@/i18n'

import { TourOverlay } from '../TourOverlay'
import type { TourStep } from '@/hooks/useTour'

/**
 * TourOverlay accessibility (correction round).
 *
 * The tour is a NON-modal spotlight, so the fix is deliberately not "add a
 * focus trap": trapping focus inside the tooltip would strand a keyboard user
 * away from the element the tour is pointing at, which is the one thing the
 * feature exists to show them.
 *
 * What was actually missing was announcement. The tooltip took no focus at
 * all, so a screen-reader user got silence on open, silence on every "Next",
 * and no way to discover that the content had changed. Focus is the
 * announcement channel here, paired with a real accessible name/description.
 */

function rect(): DOMRect {
  return {
    top: 100,
    left: 100,
    width: 200,
    height: 50,
    bottom: 150,
    right: 300,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  } as DOMRect
}

const STEP_ONE: TourStep = {
  target: '[data-tour="sidebar"]',
  title: 'Navigation Sidebar',
  description: 'Browse all sections of TeslaSync from here.',
  placement: 'right',
}

const STEP_TWO: TourStep = {
  target: '[data-tour="dashboard-grid"]',
  title: 'Your Dashboard',
  description: 'Every card is a widget showing live data.',
  placement: 'bottom',
}

function renderOverlay(overrides: Partial<React.ComponentProps<typeof TourOverlay>> = {}) {
  const props = {
    step: STEP_ONE,
    targetRect: rect(),
    currentStep: 0,
    totalSteps: 3,
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<TourOverlay {...props} />) }
}

describe('TourOverlay — non-modal contract', () => {
  it('declares itself NOT modal so the spotlight target stays reachable', () => {
    renderOverlay()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false')
  })

  it('does not trap Tab inside the tooltip', () => {
    // A trap would install a keydown handler that preventDefaults Tab at the
    // boundary. Nothing here should cancel it.
    renderOverlay()
    const tooltip = screen.getByTestId('tour-tooltip')
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    tooltip.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('TourOverlay — accessible name and description', () => {
  it('names the dialog from the step heading, not a generic counter string', () => {
    renderOverlay()
    expect(screen.getByRole('dialog', { name: 'Navigation Sidebar' })).toBeInTheDocument()
  })

  it('describes the dialog with the step body', () => {
    renderOverlay()
    const dialog = screen.getByRole('dialog')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      'Browse all sections of TeslaSync from here.',
    )
  })

  it('uses a non-skipping heading level for the step title', () => {
    // An <h4> under a page <h1> forces screen-reader users navigating by
    // heading to jump two levels to reach the tour content.
    renderOverlay()
    expect(screen.getByTestId('tour-title').tagName).toBe('H2')
    expect(screen.getByRole('heading', { level: 2, name: 'Navigation Sidebar' })).toBeInTheDocument()
  })

  it('hides the decorative close glyph from assistive tech', () => {
    renderOverlay()
    const closeButton = screen.getByTestId('tour-close')
    expect(closeButton).toHaveAccessibleName('Close tour')
    expect(closeButton.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('TourOverlay — focus behaviour', () => {
  it('focuses the tooltip on open so the step is announced', () => {
    renderOverlay()
    expect(document.activeElement).toBe(screen.getByTestId('tour-tooltip'))
  })

  it('announces the FIRST step in production mount order (null rect, then rect)', () => {
    // `useTour` measures the spotlight target in an effect, so the real mount
    // sequence is: render with targetRect=null (nothing rendered) → rect
    // arrives on a later render. An effect keyed only on `currentStep` fired
    // once against a null ref and never re-ran, so step 1 was silent for
    // screen-reader users while steps 2..n worked. This is the regression.
    const props = {
      step: STEP_ONE,
      currentStep: 0,
      totalSteps: 3,
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onSkip: vi.fn(),
    }
    const { rerender } = render(<TourOverlay {...props} targetRect={null} />)
    expect(screen.queryByTestId('tour-tooltip')).not.toBeInTheDocument()

    rerender(<TourOverlay {...props} targetRect={rect()} />)

    const tooltip = screen.getByTestId('tour-tooltip')
    expect(document.activeElement).toBe(tooltip)
    // …and the announcement carries the step's own name, not a generic label.
    expect(tooltip).toHaveAccessibleName('Navigation Sidebar')
  })

  it('does not re-steal focus when only the rect object changes (scroll/resize)', () => {
    // The rect is replaced on every scroll and resize. Depending on the object
    // rather than on tooltip availability would drag focus back to the tooltip
    // continuously while the user scrolls the page.
    const props = {
      step: STEP_ONE,
      currentStep: 0,
      totalSteps: 3,
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onSkip: vi.fn(),
    }
    const { rerender } = render(<TourOverlay {...props} targetRect={rect()} />)

    const next = screen.getByRole('button', { name: /next/i })
    next.focus()
    expect(document.activeElement).toBe(next)

    // A fresh, differently-positioned rect object — same step, still mounted.
    rerender(<TourOverlay {...props} targetRect={{ ...rect(), top: 240 } as DOMRect} />)

    expect(document.activeElement).toBe(next)
  })

  it('re-announces when the tooltip reappears after the target scrolls away', () => {
    const props = {
      step: STEP_ONE,
      currentStep: 0,
      totalSteps: 3,
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onSkip: vi.fn(),
    }
    const { rerender } = render(<TourOverlay {...props} targetRect={rect()} />)
    ;(document.activeElement as HTMLElement).blur()

    rerender(<TourOverlay {...props} targetRect={null} />)
    expect(screen.queryByTestId('tour-tooltip')).not.toBeInTheDocument()

    rerender(<TourOverlay {...props} targetRect={rect()} />)
    expect(document.activeElement).toBe(screen.getByTestId('tour-tooltip'))
  })

  it('re-focuses the tooltip on each step change so the new step is announced', () => {
    const { rerender } = render(
      <TourOverlay
        step={STEP_ONE}
        targetRect={rect()}
        currentStep={0}
        totalSteps={3}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        onSkip={vi.fn()}
      />,
    )
    // Move focus away, as a user pressing "Next" with the mouse would.
    const next = screen.getByRole('button', { name: /next/i })
    next.focus()
    expect(document.activeElement).toBe(next)

    rerender(
      <TourOverlay
        step={STEP_TWO}
        targetRect={rect()}
        currentStep={1}
        totalSteps={3}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        onSkip={vi.fn()}
      />,
    )

    expect(document.activeElement).toBe(screen.getByTestId('tour-tooltip'))
    expect(screen.getByRole('dialog', { name: 'Your Dashboard' })).toBeInTheDocument()
  })

  it('keeps the tooltip out of the natural tab order', () => {
    renderOverlay()
    expect(screen.getByTestId('tour-tooltip')).toHaveAttribute('tabindex', '-1')
  })

  it('restores focus to the launching control when the tour closes', () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Take a tour'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    // Production order again: the restore target must be captured on the very
    // first render, before the tooltip exists and steals focus.
    const props = {
      step: STEP_ONE,
      currentStep: 0,
      totalSteps: 3,
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onSkip: vi.fn(),
    }
    const { rerender, unmount } = render(<TourOverlay {...props} targetRect={null} />)
    rerender(<TourOverlay {...props} targetRect={rect()} />)
    expect(document.activeElement).toBe(screen.getByTestId('tour-tooltip'))

    unmount()

    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('falls back to the route heading when the launcher is gone on teardown', () => {
    const heading = document.createElement('h1')
    heading.setAttribute('data-route-focus-target', '')
    heading.tabIndex = -1
    document.body.appendChild(heading)

    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = renderOverlay()
    // The trigger is removed while the tour is open (its row re-rendered).
    trigger.remove()
    unmount()

    expect(document.activeElement).toBe(heading)
    heading.remove()
  })

  it('does not restore to <body> when nothing was focused on open', () => {
    const active = document.activeElement as HTMLElement | null
    active?.blur()
    const main = document.createElement('main')
    main.tabIndex = -1
    document.body.appendChild(main)

    const { unmount } = renderOverlay()
    unmount()

    expect(document.activeElement).toBe(main)
    main.remove()
  })
})

describe('TourOverlay — dismissal', () => {
  it('skips on Escape', () => {
    const onSkip = vi.fn()
    renderOverlay({ onSkip })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('skips via the close button', () => {
    const onSkip = vi.fn()
    renderOverlay({ onSkip })
    fireEvent.click(screen.getByTestId('tour-close'))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('renders nothing until the spotlight target has been measured', () => {
    const { container } = renderOverlay({ targetRect: null })
    expect(container).toBeEmptyDOMElement()
  })
})
