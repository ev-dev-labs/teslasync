// ConsentControlPanel unit tests.
//
// ConsentControlPanel is the pure presentational half of the Privacy page's
// cookie / GDPR consent control. It owns no state — the parent (PrivacyPage)
// threads the browser-local consent decision, the deployment-wide
// `require_cookie_consent` flag, the `/system/version` load state, and the
// accept / withdraw / reset / retry callbacks in as props. These tests pin
// every facet of that contract:
//
//   • policy copy across the four version-fetch states (loading / error /
//     require-on / require-off) and the loading-over-error precedence,
//   • the always-visible live status region (pill label + detail + dot colour
//     + `data-consent-state` + `role="status"`) for all three consent values,
//   • the disabled logic for the three action buttons (you can't re-apply the
//     state you're already in) and that each enabled button fires its callback,
//   • a11y / hardening guarantees: `type="button"` on every control so the
//     panel can never accidentally submit a surrounding form, the decorative
//     Cookie glyph stays out of the a11y tree, and the retry affordance is
//     conditional on `onRetry`.
//
// Convention (mirrors ResetSection / ActiveOrdersSection in this folder):
//   • react-i18next is stubbed to echo the fallback string so assertions target
//     rendered English without booting the real i18n instance,
//   • fireEvent is used directly (@testing-library/user-event is not a repo dep),
//   • the component is presentational, so no QueryClient / Router wrapper is
//     needed and no network is ever touched.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        let result = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return result
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ConsentControlPanel } from './ConsentControlPanel'
import ConsentControlPanelDefault from './ConsentControlPanel'
import type { ConsentState } from '@/lib/cookieConsent'

type Handlers = {
  onRetry: ReturnType<typeof vi.fn>
  onAccept: ReturnType<typeof vi.fn>
  onDecline: ReturnType<typeof vi.fn>
  onReset: ReturnType<typeof vi.fn>
}

function makeHandlers(): Handlers {
  return {
    onRetry: vi.fn(),
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    onReset: vi.fn(),
  }
}

interface RenderOptions {
  consent?: ConsentState
  requireConsent?: boolean
  isLoading?: boolean
  isError?: boolean
  withRetry?: boolean
}

function renderPanel(opts: RenderOptions = {}) {
  const handlers = makeHandlers()
  const {
    consent = 'unknown',
    requireConsent = false,
    isLoading = false,
    isError = false,
    withRetry = true,
  } = opts
  const utils = render(
    <ConsentControlPanel
      consent={consent}
      requireConsent={requireConsent}
      isLoading={isLoading}
      isError={isError}
      onRetry={withRetry ? handlers.onRetry : undefined}
      onAccept={handlers.onAccept}
      onDecline={handlers.onDecline}
      onReset={handlers.onReset}
    />,
  )
  return { ...utils, handlers }
}

const acceptBtn = () => screen.getByTestId('privacy-consent-accept')
const declineBtn = () => screen.getByTestId('privacy-consent-decline')
const resetBtn = () => screen.getByTestId('privacy-consent-reset')
const stateRegion = () => screen.getByTestId('privacy-consent-state')

const BODY_ON =
  'This deployment collects anonymous performance and error reports with your consent. Strictly necessary storage (auth, settings) is always on.'
const BODY_OFF =
  'This deployment does not require consent collection — these controls let you preview the user-facing flow.'
const POLICY_ERROR =
  'Deployment consent policy unavailable — you can still manage your own choice below.'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConsentControlPanel — structure & exports', () => {
  it('renders the titled section and its three action controls', () => {
    renderPanel()
    expect(screen.getByTestId('privacy-consent-section')).toBeInTheDocument()
    expect(screen.getByText('Cookies & analytics consent')).toBeInTheDocument()
    expect(acceptBtn()).toBeInTheDocument()
    expect(declineBtn()).toBeInTheDocument()
    expect(resetBtn()).toBeInTheDocument()
  })

  it('exposes the same component as a named and a default export', () => {
    expect(ConsentControlPanelDefault).toBe(ConsentControlPanel)
  })
})

describe('ConsentControlPanel — policy copy across version-fetch states', () => {
  it('shows a skeleton and no policy/error copy while the version query loads', () => {
    const { container } = renderPanel({ isLoading: true })
    // Skeleton is a decorative animated placeholder, not real copy.
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByText(BODY_ON)).not.toBeInTheDocument()
    expect(screen.queryByText(BODY_OFF)).not.toBeInTheDocument()
    expect(screen.queryByText(POLICY_ERROR)).not.toBeInTheDocument()
    // The consent controls remain usable regardless of the policy fetch.
    expect(acceptBtn()).toBeInTheDocument()
  })

  it('renders the require-on body copy when consent collection is enforced', () => {
    renderPanel({ requireConsent: true })
    expect(screen.getByText(BODY_ON)).toBeInTheDocument()
    expect(screen.queryByText(BODY_OFF)).not.toBeInTheDocument()
  })

  it('renders the require-off preview copy when consent is not enforced', () => {
    renderPanel({ requireConsent: false })
    expect(screen.getByText(BODY_OFF)).toBeInTheDocument()
    expect(screen.queryByText(BODY_ON)).not.toBeInTheDocument()
  })

  it('shows the policy-error copy with a working Retry button on fetch failure', () => {
    const { handlers } = renderPanel({ isError: true, withRetry: true })
    expect(screen.getByText(POLICY_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(BODY_OFF)).not.toBeInTheDocument()

    const retry = screen.getByRole('button', { name: /Retry/i })
    fireEvent.click(retry)
    expect(handlers.onRetry).toHaveBeenCalledTimes(1)
  })

  it('omits the Retry button when no onRetry handler is supplied', () => {
    renderPanel({ isError: true, withRetry: false })
    expect(screen.getByText(POLICY_ERROR)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument()
  })

  it('gives loading precedence over error when both flags are set', () => {
    const { container } = renderPanel({ isLoading: true, isError: true })
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByText(POLICY_ERROR)).not.toBeInTheDocument()
  })
})

describe('ConsentControlPanel — live status region', () => {
  it('is exposed as an assistive-tech status region so changes are announced', () => {
    renderPanel({ consent: 'accepted' })
    // role="status" is an implicit polite live region.
    expect(stateRegion()).toHaveAttribute('role', 'status')
    expect(screen.getByRole('status')).toBe(stateRegion())
  })

  it('describes the "accepted" state with an emerald dot and full detail line', () => {
    renderPanel({ consent: 'accepted' })
    const region = stateRegion()
    expect(region).toHaveAttribute('data-consent-state', 'accepted')

    const pill = within(region).getByText('Accepted')
    expect(pill.firstElementChild).toHaveClass('bg-emerald-400')
    expect(
      within(region).getByText('Accepted — performance & error reporting on'),
    ).toBeInTheDocument()
  })

  it('describes the "declined" state with an amber dot and full detail line', () => {
    renderPanel({ consent: 'declined' })
    const region = stateRegion()
    expect(region).toHaveAttribute('data-consent-state', 'declined')

    const pill = within(region).getByText('Declined')
    expect(pill.firstElementChild).toHaveClass('bg-amber-400')
    expect(
      within(region).getByText('Declined — only essential storage in use'),
    ).toBeInTheDocument()
  })

  it('describes the "unknown" state with a slate dot and the not-decided copy', () => {
    renderPanel({ consent: 'unknown' })
    const region = stateRegion()
    expect(region).toHaveAttribute('data-consent-state', 'unknown')

    const pill = within(region).getByText('Not decided')
    expect(pill.firstElementChild).toHaveClass('bg-slate-400')
    expect(
      within(region).getByText('Not decided — banner will appear on next visit'),
    ).toBeInTheDocument()
  })
})

describe('ConsentControlPanel — action buttons & disabled logic', () => {
  it('disables only Accept when consent is already accepted', () => {
    renderPanel({ consent: 'accepted' })
    expect(acceptBtn()).toBeDisabled()
    expect(declineBtn()).toBeEnabled()
    expect(resetBtn()).toBeEnabled()
  })

  it('disables only Decline when consent is already declined', () => {
    renderPanel({ consent: 'declined' })
    expect(declineBtn()).toBeDisabled()
    expect(acceptBtn()).toBeEnabled()
    expect(resetBtn()).toBeEnabled()
  })

  it('disables only Reset when consent is unknown (nothing to reset)', () => {
    renderPanel({ consent: 'unknown' })
    expect(resetBtn()).toBeDisabled()
    expect(acceptBtn()).toBeEnabled()
    expect(declineBtn()).toBeEnabled()
  })

  it('fires onAccept when an enabled Accept is clicked', () => {
    const { handlers } = renderPanel({ consent: 'declined' })
    fireEvent.click(acceptBtn())
    expect(handlers.onAccept).toHaveBeenCalledTimes(1)
    expect(handlers.onDecline).not.toHaveBeenCalled()
    expect(handlers.onReset).not.toHaveBeenCalled()
  })

  it('fires onDecline when an enabled Decline is clicked', () => {
    const { handlers } = renderPanel({ consent: 'accepted' })
    fireEvent.click(declineBtn())
    expect(handlers.onDecline).toHaveBeenCalledTimes(1)
    expect(handlers.onAccept).not.toHaveBeenCalled()
  })

  it('fires onReset when an enabled Reset is clicked', () => {
    const { handlers } = renderPanel({ consent: 'accepted' })
    fireEvent.click(resetBtn())
    expect(handlers.onReset).toHaveBeenCalledTimes(1)
  })

  it('does not fire onAccept when the disabled Accept is clicked', () => {
    const { handlers } = renderPanel({ consent: 'accepted' })
    fireEvent.click(acceptBtn())
    expect(handlers.onAccept).not.toHaveBeenCalled()
  })
})

describe('ConsentControlPanel — a11y & form-safety hardening', () => {
  it('marks every control as type="button" so it can never submit a form', () => {
    renderPanel({ isError: true, withRetry: true })
    expect(acceptBtn()).toHaveAttribute('type', 'button')
    expect(declineBtn()).toHaveAttribute('type', 'button')
    expect(resetBtn()).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: /Retry/i })).toHaveAttribute('type', 'button')
  })

  it('keeps the decorative Cookie glyph out of the accessibility tree', () => {
    const { container } = renderPanel()
    const decorative = container.querySelectorAll('[aria-hidden="true"]')
    expect(decorative.length).toBeGreaterThan(0)
    // Every control still carries a discernible text label.
    expect(acceptBtn()).toHaveAccessibleName('Re-grant consent')
    expect(declineBtn()).toHaveAccessibleName('Withdraw consent')
    expect(resetBtn()).toHaveAccessibleName('Reset')
  })
})
