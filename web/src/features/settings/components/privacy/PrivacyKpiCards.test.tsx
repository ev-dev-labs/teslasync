/**
 * PrivacyKpiCards contract.
 *
 * A presentational KPI band: the page hands down browser-local counters
 * (recent-page count, consent decision) plus the deployment policy flag and
 * the `/system/version` load state. The card owns four behaviours:
 *
 *   1. Loaded — renders all four metric cards with the right values and
 *      subtitles for every consent state + policy flag.
 *   2. Loading — swaps the four cards for four skeletons and marks the grid
 *      `aria-busy` so the layout never jumps and AT users hear "busy".
 *   3. Error — collapses to a single retryable QueryError, and (the harden
 *      point) NEVER goes blank even when `isError` is flagged without an
 *      error object.
 *   4. Null-safety — a missing `recentCount` renders `0`, not `undefined`.
 *
 * react-i18next is stubbed so `t(key, default)` / `t(key, { defaultValue,
 * ...vars })` fall back to the default string with `{{var}}` interpolation,
 * matching the real i18next behaviour the component relies on. QueryError
 * pulls in `useNavigate`, so renders are wrapped in a MemoryRouter. No
 * network is touched — the component is pure props-in, DOM-out.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template: string
        let opts: Record<string, unknown> | undefined
        if (typeof arg2 === 'string') {
          template = arg2
          opts =
            arg3 && typeof arg3 === 'object'
              ? (arg3 as Record<string, unknown>)
              : undefined
        } else if (arg2 && typeof arg2 === 'object') {
          const o = arg2 as Record<string, unknown>
          template = typeof o.defaultValue === 'string' ? o.defaultValue : key
          opts = o
        } else {
          template = key
        }
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            if (k === 'defaultValue') continue
            template = template.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
          }
        }
        return template
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import PrivacyKpiCardsDefault, { PrivacyKpiCards } from './PrivacyKpiCards'
import { RECENT_PAGES_MAX } from '@/lib/recentPages'
import type { ConsentState } from '@/lib/cookieConsent'

type Props = ComponentProps<typeof PrivacyKpiCards>

const base: Props = {
  recentCount: 12,
  consent: 'accepted',
  requireConsent: true,
  isLoading: false,
  isError: false,
}

function renderCards(overrides: Partial<Props> = {}) {
  return render(
    <MemoryRouter>
      <PrivacyKpiCards {...base} {...overrides} />
    </MemoryRouter>,
  )
}

describe('PrivacyKpiCards', () => {
  it('exposes the same component as its default export', () => {
    expect(PrivacyKpiCardsDefault).toBe(PrivacyKpiCards)
  })

  it('renders all four metric cards when loaded (accepted + required)', () => {
    renderCards()

    // The band is an accessible region.
    expect(
      screen.getByRole('region', { name: 'Privacy summary' }),
    ).toBeInTheDocument()

    // Recent-pages card + interpolated max subtitle.
    expect(screen.getByText('Recent pages stored')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText(`of ${RECENT_PAGES_MAX} max`)).toBeInTheDocument()

    // Consent + policy + scope cards.
    expect(screen.getByText('Consent status')).toBeInTheDocument()
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.getByText('Consent policy')).toBeInTheDocument()
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('Consent gate enabled')).toBeInTheDocument()
    expect(screen.getByText('Data scope')).toBeInTheDocument()
    expect(screen.getByText('This browser')).toBeInTheDocument()
    expect(screen.getByText('Local only — never synced')).toBeInTheDocument()
  })

  it('shows the optional-policy copy when consent is not required', () => {
    renderCards({ requireConsent: false })

    expect(screen.getByText('Optional')).toBeInTheDocument()
    expect(screen.getByText('No consent gate')).toBeInTheDocument()
    expect(screen.queryByText('Required')).not.toBeInTheDocument()
    expect(screen.queryByText('Consent gate enabled')).not.toBeInTheDocument()
  })

  it('reflects each consent state in the status card', () => {
    const { rerender } = renderCards({ consent: 'accepted' })
    expect(screen.getByText('Accepted')).toBeInTheDocument()

    const withConsent = (consent: ConsentState) => (
      <MemoryRouter>
        <PrivacyKpiCards {...base} consent={consent} />
      </MemoryRouter>
    )

    rerender(withConsent('declined'))
    expect(screen.getByText('Declined')).toBeInTheDocument()
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument()

    rerender(withConsent('unknown'))
    expect(screen.getByText('Not decided')).toBeInTheDocument()
    expect(screen.queryByText('Declined')).not.toBeInTheDocument()
  })

  it('renders four skeletons and marks the grid busy while loading', () => {
    const { container } = renderCards({ isLoading: true })

    // No metric content yet — placeholders only, so the layout never jumps.
    expect(screen.queryByText('Recent pages stored')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('falls back to 0 when recentCount is missing (null-safety)', () => {
    renderCards({ recentCount: undefined as unknown as number })
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('renders a retryable server-error card and hides the KPIs on error', () => {
    const onRetry = vi.fn()
    renderCards({
      isError: true,
      error: { name: 'ApiError', status: 500 },
      onRetry,
    })

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByText('Server error')).toBeInTheDocument()
    // KPI cards are replaced by the error card.
    expect(screen.queryByText('Recent pages stored')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('never goes blank when isError is set without an error object', () => {
    // Regression guard: QueryError returns null for a falsy error, which
    // would otherwise leave the whole band empty. The component synthesises
    // a fallback error so a retryable card always shows.
    const onRetry = vi.fn()
    renderCards({ isError: true, error: undefined, onRetry })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    // jsdom reports the browser online, so the generic network branch shows.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
