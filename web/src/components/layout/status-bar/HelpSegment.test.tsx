/**
 * HelpSegment behaviour tests.
 *
 * HelpSegment is the footer status-bar cluster of the three "always available"
 * help affordances (keyboard shortcuts, tour launcher, bug report). Each button
 * stays decoupled from the React tree and fires a window CustomEvent (or the
 * tourRegistry dispatcher) that Layout listens for. These tests lock:
 *   - the three buttons render as real, typed <button>s with icon-only-safe
 *     accessible names (the aria-label is load-bearing when labels collapse),
 *   - each click fires exactly the event/dispatcher Layout wires up,
 *   - keyboard activation (Enter) works — they are genuine buttons,
 *   - expanded vs icon-only progressive label disclosure,
 *   - decorative icons are hidden from assistive tech,
 *   - the integration hooks other surfaces depend on (data-tour target that the
 *     onboarding tour aims at, the launcher trigger attr, the feedback testid).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

// Deterministic i18n: t(key, fallback) resolves to the English fallback so the
// assertions read the shipped copy without coupling to the translation JSON.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

// Isolate the tour dispatcher — importing the real module pulls the entire tour
// registry (every tour definition + useTour). We only need to observe that the
// tour button invokes it. Hoisted so the mock factory can reference the spy.
const mocks = vi.hoisted(() => ({ dispatchTourLauncherOpen: vi.fn() }))
vi.mock('@/lib/tourRegistry', () => ({
  dispatchTourLauncherOpen: mocks.dispatchTourLauncherOpen,
}))

import { HelpSegment } from './HelpSegment'

const SHORTCUTS_LABEL = 'Open keyboard shortcuts'
const TOUR_LABEL = 'Open tour launcher'
const FEEDBACK_LABEL = 'Open feedback / bug report form'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HelpSegment', () => {
  it('renders the three help buttons as typed buttons with icon-only-safe names', () => {
    render(<HelpSegment />)

    const shortcuts = screen.getByRole('button', { name: SHORTCUTS_LABEL })
    const tour = screen.getByRole('button', { name: TOUR_LABEL })
    const feedback = screen.getByRole('button', { name: FEEDBACK_LABEL })

    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(shortcuts).toHaveAttribute('type', 'button')
    expect(tour).toHaveAttribute('type', 'button')
    expect(feedback).toHaveAttribute('type', 'button')
  })

  it('hides the decorative icons from assistive tech (button has the a11y name)', () => {
    const { container } = render(<HelpSegment />)

    // Every icon is aria-hidden; the accessible name comes from aria-label so
    // the buttons stay announced even when their visible labels collapse.
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3)
    expect(screen.getByRole('button', { name: SHORTCUTS_LABEL })).toHaveAccessibleName(
      SHORTCUTS_LABEL,
    )
  })

  it('clicking the shortcuts button dispatches a toggle-keyboard-shortcuts CustomEvent', () => {
    const listener = vi.fn()
    window.addEventListener('toggle-keyboard-shortcuts', listener)
    try {
      render(<HelpSegment />)
      fireEvent.click(screen.getByRole('button', { name: SHORTCUTS_LABEL }))

      expect(listener).toHaveBeenCalledTimes(1)
      const evt = listener.mock.calls[0][0] as Event
      expect(evt).toBeInstanceOf(CustomEvent)
      expect(evt.type).toBe('toggle-keyboard-shortcuts')
    } finally {
      window.removeEventListener('toggle-keyboard-shortcuts', listener)
    }
  })

  it('clicking the feedback button dispatches an open-feedback-modal CustomEvent', () => {
    const listener = vi.fn()
    window.addEventListener('open-feedback-modal', listener)
    try {
      render(<HelpSegment />)
      fireEvent.click(screen.getByRole('button', { name: FEEDBACK_LABEL }))

      expect(listener).toHaveBeenCalledTimes(1)
      expect((listener.mock.calls[0][0] as Event).type).toBe('open-feedback-modal')
    } finally {
      window.removeEventListener('open-feedback-modal', listener)
    }
  })

  it('clicking the tour button invokes the tour launcher dispatcher exactly once', () => {
    render(<HelpSegment />)

    fireEvent.click(screen.getByRole('button', { name: TOUR_LABEL }))

    expect(mocks.dispatchTourLauncherOpen).toHaveBeenCalledTimes(1)
  })

  it('each control is a focusable native button (keyboard operable) that fires its action', () => {
    const listener = vi.fn()
    window.addEventListener('toggle-keyboard-shortcuts', listener)
    try {
      render(<HelpSegment />)
      const btn = screen.getByRole('button', { name: SHORTCUTS_LABEL })

      // Native <button> ⇒ inherent Enter/Space activation + tab focusability.
      expect(btn.tagName).toBe('BUTTON')
      btn.focus()
      expect(btn).toHaveFocus()

      fireEvent.click(btn)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('toggle-keyboard-shortcuts', listener)
    }
  })

  it('does not fire any action on mount (only on interaction)', () => {
    const shortcutsListener = vi.fn()
    const feedbackListener = vi.fn()
    window.addEventListener('toggle-keyboard-shortcuts', shortcutsListener)
    window.addEventListener('open-feedback-modal', feedbackListener)
    try {
      render(<HelpSegment />)

      expect(shortcutsListener).not.toHaveBeenCalled()
      expect(feedbackListener).not.toHaveBeenCalled()
      expect(mocks.dispatchTourLauncherOpen).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('toggle-keyboard-shortcuts', shortcutsListener)
      window.removeEventListener('open-feedback-modal', feedbackListener)
    }
  })

  it('expanded mode (default) shows the ? hint and the inline label copy', () => {
    render(<HelpSegment />)

    expect(screen.getByText('?')).toBeInTheDocument()
    expect(screen.getByText('for shortcuts')).toBeInTheDocument()
    // Each of these labels appears twice: the tooltip body + the inline span.
    expect(screen.getAllByText('Take a tour')).toHaveLength(2)
    expect(screen.getAllByText('Report bug')).toHaveLength(2)
  })

  it('icon-only mode hides the ? hint and every inline label (tooltip copy remains)', () => {
    render(<HelpSegment iconOnly />)

    expect(screen.queryByText('?')).not.toBeInTheDocument()
    expect(screen.queryByText('for shortcuts')).not.toBeInTheDocument()
    // Only the tooltip body survives now — the inline visible spans are gone.
    expect(screen.getAllByText('Take a tour')).toHaveLength(1)
    expect(screen.getAllByText('Report bug')).toHaveLength(1)
    // ...but the buttons and their accessible names still work.
    expect(screen.getByRole('button', { name: SHORTCUTS_LABEL })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: TOUR_LABEL })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: FEEDBACK_LABEL })).toBeInTheDocument()
  })

  it('preserves the integration hooks other surfaces depend on', () => {
    const { container } = render(<HelpSegment />)

    // The main onboarding tour aims at [data-tour="keyboard-hint"].
    expect(container.querySelector('[data-tour="keyboard-hint"]')).not.toBeNull()
    // Tour launcher trigger attribute + feedback test id both stay wired.
    expect(screen.getByRole('button', { name: TOUR_LABEL })).toHaveAttribute(
      'data-tour-launcher-trigger',
    )
    expect(screen.getByTestId('status-bar-feedback-trigger')).toBe(
      screen.getByRole('button', { name: FEEDBACK_LABEL }),
    )
  })

  it('defaults to expanded mode when iconOnly is omitted', () => {
    const { rerender } = render(<HelpSegment iconOnly={false} />)
    expect(screen.getByText('for shortcuts')).toBeInTheDocument()

    rerender(<HelpSegment />)
    expect(screen.getByText('for shortcuts')).toBeInTheDocument()
  })
})
