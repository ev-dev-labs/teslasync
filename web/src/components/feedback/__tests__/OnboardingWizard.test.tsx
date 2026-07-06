/**
 * OnboardingWizard tests.
 *
 * The wizard is a self-contained first-run surface with three collaborators
 * we stub so the specs stay deterministic:
 *   - the cross-tab bus (`@/lib/broadcast`) — we capture the `subscribe`
 *     handler so a "peer tab" message can be simulated, and spy on outgoing
 *     `broadcast()` calls.
 *   - `react-i18next` — the real `useTranslation` is swapped for a stub that
 *     returns the English fallback (interpolating `{{vars}}`) so we can assert
 *     copy + the progress label without booting an i18n instance.
 *   - `localStorage` — the real jsdom store, cleared around each test.
 *
 * Timers are faked because the wizard defers its reveal by 1.5s.
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

const ONBOARDED_KEY = 'teslasync-onboarded'
const REVEAL_DELAY_MS = 1500

/** Render already happened — fast-forward past the deferred reveal. */
function reveal() {
  act(() => {
    vi.advanceTimersByTime(REVEAL_DELAY_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  broadcastSpy.mockClear()
  setPeerHandler(null)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('OnboardingWizard — visibility lifecycle', () => {
  it('stays hidden until the reveal delay elapses on first run', () => {
    render(<OnboardingWizard />)
    // Nothing before the timer fires.
    expect(screen.queryByRole('dialog')).toBeNull()

    reveal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('never reveals when localStorage already records completed onboarding', () => {
    window.localStorage.setItem(ONBOARDED_KEY, 'true')
    render(<OnboardingWizard />)

    reveal()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not persist or broadcast merely by revealing', () => {
    render(<OnboardingWizard />)
    reveal()

    expect(broadcastSpy).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeNull()
  })
})

describe('OnboardingWizard — accessibility', () => {
  it('exposes dialog semantics wired to the title and description', () => {
    render(<OnboardingWizard />)
    reveal()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'onboarding-title')
    expect(dialog).toHaveAttribute('aria-describedby', 'onboarding-desc')
    // The referenced ids must actually exist on the heading + copy.
    expect(document.getElementById('onboarding-title')).toHaveTextContent('Welcome to TeslaSync')
    expect(document.getElementById('onboarding-desc')?.textContent ?? '').toContain('dashboard')
  })

  it('gives the icon-only close control an accessible name', () => {
    render(<OnboardingWizard />)
    reveal()
    expect(
      screen.getByRole('button', { name: /close and skip introduction/i }),
    ).toBeInTheDocument()
  })

  it('announces the current position via the progress group label', () => {
    render(<OnboardingWizard />)
    reveal()
    expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'Step 1 of 4')
  })

  it('moves focus onto the dialog when it opens', () => {
    render(<OnboardingWizard />)
    reveal()
    expect(screen.getByRole('dialog')).toHaveFocus()
  })
})

describe('OnboardingWizard — step navigation', () => {
  it('advances through every step, swapping the CTA on the final slide', () => {
    render(<OnboardingWizard />)
    reveal()

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Welcome to TeslaSync')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Connect Your Tesla')
    expect(screen.getByRole('group')).toHaveAttribute('aria-label', 'Step 2 of 4')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Configure Settings')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent("You're All Set!")

    // On the last slide the primary action becomes "Get Started".
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeInTheDocument()
  })

  it('completes onboarding when the final CTA is pressed', () => {
    render(<OnboardingWizard />)
    reveal()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Get Started' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBe('true')
    expect(broadcastSpy).toHaveBeenCalledWith({ type: 'onboarded' })
  })
})

describe('OnboardingWizard — dismissal paths', () => {
  it('dismisses and persists when Skip is clicked', () => {
    render(<OnboardingWizard />)
    reveal()

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBe('true')
    expect(broadcastSpy).toHaveBeenCalledWith({ type: 'onboarded' })
  })

  it('dismisses and persists when the close button is clicked', () => {
    render(<OnboardingWizard />)
    reveal()

    fireEvent.click(screen.getByRole('button', { name: /close and skip introduction/i }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBe('true')
  })

  it('dismisses when the decorative backdrop is clicked', () => {
    render(<OnboardingWizard />)
    reveal()

    fireEvent.click(screen.getByTestId('onboarding-backdrop'))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBe('true')
  })

  it('dismisses on Escape via the document-level listener (regression)', () => {
    // The previous implementation put onKeyDown on a non-focusable wrapper,
    // so Escape silently did nothing. This guards the document listener fix.
    render(<OnboardingWizard />)
    reveal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBe('true')
  })

  it('ignores non-Escape keys', () => {
    render(<OnboardingWizard />)
    reveal()

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(window.localStorage.getItem(ONBOARDED_KEY)).toBeNull()
  })
})

describe('OnboardingWizard — cross-tab coordination', () => {
  it('dismisses when a peer tab reports onboarding is done, without echoing', () => {
    render(<OnboardingWizard />)
    reveal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => {
      getPeerHandler()?.({ type: 'onboarded' })
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    // A peer-driven dismissal must NOT re-broadcast, or two tabs ping-pong.
    expect(broadcastSpy).not.toHaveBeenCalled()
  })

  it('ignores unrelated broadcast messages', () => {
    render(<OnboardingWizard />)
    reveal()

    act(() => {
      getPeerHandler()?.({ type: 'theme.changed' })
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
