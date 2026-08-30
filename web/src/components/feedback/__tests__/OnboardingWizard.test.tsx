/**
 * OnboardingWizard tests (correction round).
 *
 * Two behaviours changed and both are asserted here rather than assumed:
 *
 * 1. **It is controlled.** The self-reveal timer is gone — HELP-01 removed
 *    automatic modals, and a component that opens itself 1.5s after mount is
 *    the definition of one. It now renders only when a caller passes `open`.
 * 2. **It is a real modal.** Unlike `<TourOverlay>` (a non-modal spotlight
 *    that must leave the page reachable), this covers the app, so it uses the
 *    shared `useDialogFocus` primitive for the trap, Escape, and restoration.
 *    The previous hand-rolled effects had no trap at all and restored focus
 *    nowhere.
 *
 * Collaborators stubbed for determinism: the cross-tab bus and i18n.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

// ── Broadcast bus mock ────────────────────────────────────────────────────
const { broadcastSpy, getPeerHandler, setPeerHandler } = vi.hoisted(() => {
  let handler: ((m: { type: string }) => void) | null = null
  return {
    broadcastSpy: vi.fn(),
    getPeerHandler: () => handler,
    setPeerHandler: (h: ((m: { type: string }) => void) | null) => {
      handler = h
    },
  }
})

vi.mock('@/lib/broadcast', () => ({
  broadcast: (m: { type: string }) => broadcastSpy(m),
  subscribe: (h: (m: { type: string }) => void) => {
    setPeerHandler(h)
    return () => setPeerHandler(null)
  },
}))

// ── i18n stub — fallback text + `{{var}}` interpolation ───────────────────
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, def?: string, opts?: Record<string, unknown>) => {
        let out = def ?? _key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return out
      },
    }),
  }
})

import OnboardingWizard from '../OnboardingWizard'
import {
  ONBOARDING_COMPLETION_KEY,
  isOnboardingCompleted,
} from '@/features/onboarding/completion'

function renderWizard(open = true) {
  const onClose = vi.fn()
  const utils = render(<OnboardingWizard open={open} onClose={onClose} />)
  return { onClose, ...utils }
}

beforeEach(() => {
  broadcastSpy.mockClear()
  setPeerHandler(null)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('OnboardingWizard — controlled visibility (HELP-01)', () => {
  it('renders nothing when closed', () => {
    const { container } = renderWizard(false)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders when a caller explicitly opens it', () => {
    renderWizard(true)
    expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument()
  })

  it('never opens itself on a timer, even on a first-run install', () => {
    vi.useFakeTimers()
    try {
      const { container } = renderWizard(false)
      act(() => {
        vi.advanceTimersByTime(10_000)
      })
      expect(container).toBeEmptyDOMElement()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not read first-run storage to decide whether to show', () => {
    // Previously the component probed `teslasync-onboarded` and revealed
    // itself when unset. `open` is now the only input.
    window.localStorage.setItem(ONBOARDING_COMPLETION_KEY, 'true')
    renderWizard(true)
    expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument()
  })

  it('restarts at the first step when re-opened', () => {
    const { rerender } = render(<OnboardingWizard open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Connect Your Tesla')).toBeInTheDocument()

    rerender(<OnboardingWizard open={false} onClose={vi.fn()} />)
    rerender(<OnboardingWizard open onClose={vi.fn()} />)

    expect(screen.getByText('Welcome to TeslaSync')).toBeInTheDocument()
  })
})

describe('OnboardingWizard — modal focus containment', () => {
  it('focuses the primary action on open, not the close button', () => {
    renderWizard()
    // `[data-autofocus]` marks the Next control; without it the shared hook
    // would focus the first focusable element, which is "Close".
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /next/i }))
  })

  it('declares itself modal and is wired to its title and description', () => {
    renderWizard()
    const dialog = screen.getByTestId('onboarding-wizard')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'onboarding-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'onboarding-desc')
  })

  it('wraps Tab from the last control back to the first', () => {
    renderWizard()
    const dialog = screen.getByTestId('onboarding-wizard')
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not(:disabled)'),
    )
    expect(focusables.length).toBeGreaterThan(1)

    const last = focusables[focusables.length - 1]
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })

    expect(document.activeElement).toBe(focusables[0])
  })

  it('wraps Shift+Tab from the first control back to the last', () => {
    renderWizard()
    const dialog = screen.getByTestId('onboarding-wizard')
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not(:disabled)'),
    )

    focusables[0].focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })

  it('restores focus to the trigger when it closes', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { rerender } = render(<OnboardingWizard open onClose={vi.fn()} />)
    expect(document.activeElement).not.toBe(trigger)

    rerender(<OnboardingWizard open={false} onClose={vi.fn()} />)

    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('gives the icon-only close control an accessible name', () => {
    renderWizard()
    const close = screen.getByRole('button', { name: 'Close and skip introduction' })
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('announces the current position via the progress group label', () => {
    renderWizard()
    expect(screen.getByRole('group', { name: 'Step 1 of 4' })).toBeInTheDocument()
  })
})

describe('OnboardingWizard — step navigation', () => {
  it('advances through every step, swapping the CTA on the final slide', () => {
    renderWizard()
    expect(screen.getByText('Welcome to TeslaSync')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Connect Your Tesla')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('Configure Settings')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText("You're All Set!")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument()
  })
})

describe('OnboardingWizard — dismissal and completion', () => {
  it('calls onClose and records completion when the final CTA is pressed', () => {
    const { onClose } = renderWizard()
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Get Started' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(isOnboardingCompleted()).toBe(true)
    expect(broadcastSpy).toHaveBeenCalledWith({ type: 'onboarded' })
  })

  it('calls onClose when Skip is clicked', () => {
    const { onClose } = renderWizard()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the close button is clicked', () => {
    const { onClose } = renderWizard()
    fireEvent.click(screen.getByRole('button', { name: 'Close and skip introduction' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the decorative backdrop is clicked', () => {
    const { onClose } = renderWizard()
    fireEvent.click(screen.getByTestId('onboarding-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape via the shared dialog primitive', () => {
    const { onClose } = renderWizard()
    fireEvent.keyDown(screen.getByTestId('onboarding-wizard'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores non-Escape keys', () => {
    const { onClose } = renderWizard()
    fireEvent.keyDown(screen.getByTestId('onboarding-wizard'), { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not re-broadcast when completion was already recorded', () => {
    window.localStorage.setItem(ONBOARDING_COMPLETION_KEY, 'true')
    const { onClose } = renderWizard()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(broadcastSpy).not.toHaveBeenCalled()
  })
})

describe('OnboardingWizard — cross-tab coordination', () => {
  it('closes when a peer tab reports onboarding is done, without echoing', () => {
    const { onClose } = renderWizard()
    act(() => {
      getPeerHandler()?.({ type: 'onboarded' })
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(broadcastSpy).not.toHaveBeenCalled()
  })

  it('ignores unrelated broadcast messages', () => {
    const { onClose } = renderWizard()
    act(() => {
      getPeerHandler()?.({ type: 'dashboard.layout' })
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})
