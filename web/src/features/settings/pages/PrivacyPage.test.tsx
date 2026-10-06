/**
 * PrivacyPage contract.
 *
 * PrivacyPage owns the browser-local privacy surfaces (recently-viewed pages
 * LRU + cookie/analytics consent), the `/system/version` policy query, and the
 * destructive clear-history confirmation + toast feedback. It fans that state
 * out to four presentational panels (KPI band, recent-pages control, consent
 * control, guarantees band) and keeps every subscription in one place so the
 * cards never drift apart across tabs.
 *
 * These tests drive the *page* end-to-end against the real storage helpers
 * (`@/lib/recentPages`, `@/lib/cookieConsent`) backed by jsdom localStorage —
 * only the shared `request` client is mocked so `useVersionInfo` resolves
 * without a network. i18n is stubbed to fall back to inline defaults.
 *
 * Coverage:
 *   1. Happy path renders all four sections (KPI region, recent + consent
 *      controls, guarantees region) and the "Optional" deployment policy.
 *   2. Empty recent list disables the clear button and shows the empty hint.
 *   3. `require_cookie_consent` flips the policy KPI to "Required".
 *   4. A previously-accepted consent decision is reflected on mount.
 *   5. Clearing recent pages confirms, wipes the list, drops the counter, and
 *      toasts.
 *   6/7/8. Accept / decline / reset consent persist the decision, toggle the
 *      button disabled states, and toast.
 *   9. A failed policy load surfaces a retryable error (local KPIs stay usable
 *      via the consent controls) and recovers on retry.
 *   10. A cross-tab recent-page write live-updates the counter via the page's
 *      subscription.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

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
        const interpolate = (s: string) => {
          if (!opts) return s
          return Object.keys(opts).reduce(
            (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
            s,
          )
        }
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request, ApiError } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import {
  getConsent,
  setConsent,
  type ConsentState,
} from '@/lib/cookieConsent'
import { getRecentPages, recordPageView } from '@/lib/recentPages'
import PrivacyPage from './PrivacyPage'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

interface VersionOverrides {
  require_cookie_consent?: boolean
}

function versionResponse(overrides: VersionOverrides = {}) {
  return {
    chart_version: '1.2.3',
    go_version: 'go1.25',
    os: 'linux',
    arch: 'amd64',
    endpoints: {},
    require_cookie_consent: false,
    ...overrides,
  }
}

/** Seed N distinct recent-page entries in localStorage before mount. */
function seedRecentPages(count: number) {
  for (let i = 0; i < count; i++) {
    recordPageView({ path: `/vehicles/${i + 1}`, title: `Vehicle ${i + 1}`, now: 1000 + i })
  }
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const rendered = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <PrivacyPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...rendered, client: qc }
}

function kpiRegion() {
  return screen.getByRole('region', { name: 'Privacy summary' })
}

beforeEach(() => {
  mockedRequest.mockReset()
  mockedRequest.mockResolvedValue(versionResponse())
  // Real storage helpers back the page — reset every browser-local surface
  // (recent pages, consent, confirm-silence) so tests never leak into each
  // other via localStorage.
  localStorage.clear()
})

describe('PrivacyPage — layout', () => {
  it('renders the KPI band, both control panels, and the guarantees band', async () => {
    seedRecentPages(3)
    renderPage()

    // Browser-local facts are immediate; only deployment policy awaits the query.
    await within(kpiRegion()).findByText('Optional')

    // All four sections are present and never hidden.
    expect(screen.getByTestId('privacy-section')).toBeInTheDocument()
    expect(kpiRegion()).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Privacy controls' })).toBeInTheDocument()
    expect(screen.getByTestId('privacy-recent-section')).toBeInTheDocument()
    expect(screen.getByTestId('privacy-consent-section')).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: /How TeslaSync handles this data/i }),
    ).toBeInTheDocument()

    // Seeded count flows through to both the KPI and the recent panel.
    expect(within(kpiRegion()).getByText('3')).toBeInTheDocument()
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('3 entries stored')

    // Deployment policy defaults to Optional and the tab title is set.
    expect(within(kpiRegion()).getByText('Optional')).toBeInTheDocument()
    const strip = kpiRegion().querySelector('[data-operational-brief][data-testid="privacy-summary"]')!
    const tiles = strip.querySelectorAll('[data-operational-metric]')
    expect(tiles).toHaveLength(4)
    expect(strip).toHaveTextContent('Local browser state and the latest deployment policy have no common date range.')
    expect(tiles[0].querySelector('[data-operational-value]')).toHaveTextContent('3')
    expect(tiles[0]).toHaveTextContent('of 50 max')
    expect(tiles[1].querySelector('[data-operational-value]')).toHaveTextContent('Not decided')
    expect(tiles[2].querySelector('[data-operational-value]')).toHaveTextContent('Optional')
    expect(tiles[3].querySelector('[data-operational-value]')).toHaveTextContent('This browser')
    expect(tiles[3]).toHaveTextContent('Local only — never synced')
    expect(document.title).toContain('Privacy')
    fireEvent.click(within(strip as HTMLElement).getByRole('button', { name: 'Review details' }))
    const drawer = await screen.findByRole('dialog')
    expect(drawer).toHaveTextContent('of 50 max')
    expect(drawer).toHaveTextContent('Not decided')
    expect(drawer).toHaveTextContent('Local only — never synced')
  })

  it('disables the clear button and shows the empty hint with no history', async () => {
    renderPage()

    await within(kpiRegion()).findByText('Recent pages stored')

    const clearBtn = screen.getByTestId('privacy-clear-recent-pages')
    expect(clearBtn).toBeDisabled()
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('0 entries stored')
    expect(
      screen.getByText(/Pages you visit will appear here for quick access\./i),
    ).toBeInTheDocument()
  })
})

describe('PrivacyPage — deployment policy', () => {
  it('shows all browser-local facts and controls while policy is loading, without inventing Optional', () => {
    mockedRequest.mockReturnValue(new Promise(() => {}))
    seedRecentPages(60)
    setConsent('declined')
    renderPage()
    const strip = kpiRegion().querySelector('[data-operational-brief][data-testid="privacy-summary"]')!
    const tiles = strip.querySelectorAll('[data-operational-metric]')
    expect(tiles).toHaveLength(4)
    expect(tiles[0].querySelector('[data-operational-value]')).toHaveTextContent('50')
    expect(tiles[0]).toHaveTextContent('of 50 max')
    expect(tiles[1].querySelector('[data-operational-value]')).toHaveTextContent('Declined')
    expect(tiles[1]).toHaveTextContent('only essential storage in use')
    expect(tiles[2]).toHaveAttribute('data-value-state', 'missing')
    expect(tiles[2]).toHaveTextContent('Loading deployment consent policy')
    expect(within(kpiRegion()).queryByText('Optional')).toBeNull()
    expect(tiles[3].querySelector('[data-operational-value]')).toHaveTextContent('This browser')
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeEnabled()
    expect(screen.getByTestId('privacy-consent-decline')).toBeDisabled()
    expect(screen.getByTestId('privacy-consent-accept')).toBeEnabled()
    expect(screen.getByTestId('privacy-consent-reset')).toBeEnabled()
  })

  it('does not infer Optional from a successful response with no policy flag', async () => {
    const response: Partial<ReturnType<typeof versionResponse>> = versionResponse()
    delete response.require_cookie_consent
    mockedRequest.mockResolvedValue(response)
    renderPage()
    await within(kpiRegion()).findByText('Failed to load privacy policy')
    expect(kpiRegion().querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(1)
    expect(within(kpiRegion()).queryByText('Optional')).toBeNull()
    expect(screen.getByTestId('privacy-consent-accept')).toBeEnabled()
  })

  it('renders the policy KPI as Required when consent is enforced', async () => {
    mockedRequest.mockResolvedValue(versionResponse({ require_cookie_consent: true }))
    renderPage()

    await within(kpiRegion()).findByText('Required')

    expect(within(kpiRegion()).getByText('Required')).toBeInTheDocument()
    expect(within(kpiRegion()).queryByText('Optional')).not.toBeInTheDocument()
  })
})

describe('PrivacyPage — consent reflection', () => {
  it('reflects a previously-accepted consent decision on mount', async () => {
    setConsent('accepted')
    renderPage()

    await within(kpiRegion()).findByText('Recent pages stored')

    expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute(
      'data-consent-state',
      'accepted',
    )
    // Accept is a no-op once already accepted — the button is disabled.
    expect(screen.getByTestId('privacy-consent-accept')).toBeDisabled()
    // The KPI status pill mirrors the same state.
    expect(within(kpiRegion()).getByText('Accepted')).toBeInTheDocument()
  })
})

describe('PrivacyPage — clear recent pages', () => {
  it('confirms, wipes the list, drops the counter, and toasts', async () => {
    seedRecentPages(3)
    renderPage()

    await within(kpiRegion()).findByText('Recent pages stored')
    expect(getRecentPages()).toHaveLength(3)

    fireEvent.click(screen.getByTestId('privacy-clear-recent-pages'))

    // Confirmation dialog gates the destructive action.
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Clear pages/i }))

    // Storage is wiped and the live counter follows via the subscription.
    await waitFor(() => expect(getRecentPages()).toHaveLength(0))
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('0 entries stored')
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeDisabled()
    expect(await screen.findByText('Recent pages cleared')).toBeInTheDocument()
  })

  it('does not clear when the confirmation is cancelled', async () => {
    seedRecentPages(2)
    renderPage()

    await within(kpiRegion()).findByText('Recent pages stored')

    fireEvent.click(screen.getByTestId('privacy-clear-recent-pages'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(getRecentPages()).toHaveLength(2)
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('2 entries stored')
  })
})

describe('PrivacyPage — consent controls', () => {
  it('accepting consent persists the decision, disables accept, and toasts', async () => {
    renderPage()

    await within(kpiRegion()).findByText('Recent pages stored')
    expect(getConsent()).toBe<ConsentState>('unknown')

    fireEvent.click(screen.getByTestId('privacy-consent-accept'))

    await waitFor(() =>
      expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute(
        'data-consent-state',
        'accepted',
      ),
    )
    expect(getConsent()).toBe<ConsentState>('accepted')
    expect(screen.getByTestId('privacy-consent-accept')).toBeDisabled()
    expect(await screen.findByText('Consent granted')).toBeInTheDocument()
  })

  it('declining consent persists the decision and toasts', async () => {
    renderPage()

    await within(kpiRegion()).findByText('Recent pages stored')

    fireEvent.click(screen.getByTestId('privacy-consent-decline'))

    await waitFor(() =>
      expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute(
        'data-consent-state',
        'declined',
      ),
    )
    expect(getConsent()).toBe<ConsentState>('declined')
    expect(screen.getByTestId('privacy-consent-decline')).toBeDisabled()
    expect(await screen.findByText('Consent withdrawn')).toBeInTheDocument()
  })

  it('resetting consent returns to the undecided state and toasts', async () => {
    setConsent('accepted')
    renderPage()

    await within(kpiRegion()).findByText('Recent pages stored')

    fireEvent.click(screen.getByTestId('privacy-consent-reset'))

    await waitFor(() =>
      expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute(
        'data-consent-state',
        'unknown',
      ),
    )
    expect(getConsent()).toBe<ConsentState>('unknown')
    // Reset is a no-op from the undecided state.
    expect(screen.getByTestId('privacy-consent-reset')).toBeDisabled()
    expect(await screen.findByText(/Consent reset/i)).toBeInTheDocument()
  })
})

describe('PrivacyPage — policy load failure', () => {
  it('surfaces a retryable error and keeps the consent controls usable, then recovers', async () => {
    let versionCalls = 0
    mockedRequest.mockImplementation(async (path: string) => {
      if (path === '/system/version') {
        versionCalls += 1
        if (versionCalls === 1) throw new ApiError('policy boom', 500, 'INTERNAL')
        return versionResponse()
      }
      throw new Error(`unexpected request to ${path}`)
    })

    renderPage()

    // The policy failure remains retryable without hiding browser-local facts.
    expect(await screen.findByText('Server error')).toBeInTheDocument()
    expect(within(kpiRegion()).getByText('Recent pages stored')).toBeInTheDocument()
    const tiles = kpiRegion().querySelectorAll('[data-operational-metric]')
    expect(tiles).toHaveLength(4)
    expect(tiles[0].querySelector('[data-operational-value]')).toHaveTextContent('0')
    expect(tiles[2]).toHaveAttribute('data-value-state', 'missing')
    expect(tiles[2].querySelector('[data-operational-value]')).toHaveTextContent('—')
    expect(within(kpiRegion()).queryByText('Optional')).toBeNull()
    expect(tiles[3].querySelector('[data-operational-value]')).toHaveTextContent('This browser')
    // ...but the browser-local consent controls remain usable regardless.
    expect(screen.getByTestId('privacy-consent-accept')).toBeInTheDocument()

    // Retrying refetches and recovers the full KPI band.
    const retry = within(kpiRegion()).getByRole('button', { name: /Retry/i })
    fireEvent.click(retry)

    expect(await within(kpiRegion()).findByText('Optional')).toBeInTheDocument()
    expect(versionCalls).toBeGreaterThanOrEqual(2)
  })
})

describe('PrivacyPage — cross-tab sync', () => {
  it('live-updates the recent-page counter when a page is recorded elsewhere', async () => {
    renderPage()

    await within(kpiRegion()).findByText('Recent pages stored')
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('0 entries stored')

    // Simulate a visit recorded by the router effect / another tab. The page's
    // subscribeRecentPages hook must lift the counter without a remount.
    act(() => {
      recordPageView({ path: '/vehicles/9', title: 'Nine', now: 2000 })
    })

    await waitFor(() =>
      expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('1 entries stored'),
    )
    expect(within(kpiRegion()).getByText('1')).toBeInTheDocument()
  })
})

describe('PrivacyPage — retained policy', () => {
  it('keeps the required policy and browser-local consent controls after a failed refresh', async () => {
    seedRecentPages(2)
    setConsent('accepted')
    mockedRequest.mockResolvedValue(versionResponse({ require_cookie_consent: true }))
    const { client, container } = renderPage()
    await within(kpiRegion()).findByText('Required')
    expect(container.querySelector('[data-layout-reference]')).not.toBeNull()

    mockedRequest.mockRejectedValue(new ApiError('Refresh unavailable', 500, 'INTERNAL'))
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['version'] })
    })
    await waitFor(() => expect(client.getQueryState(['version'])?.status).toBe('error'))

    expect(await screen.findByText('Data may be stale')).toBeInTheDocument()
    expect(within(kpiRegion()).getByText('Required')).toBeInTheDocument()
    expect(within(kpiRegion()).queryByText('Optional')).toBeNull()
    expect(within(kpiRegion()).getByText('Retained deployment policy')).toBeInTheDocument()
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('2 entries stored')
    expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute('data-consent-state', 'accepted')
    expect(screen.getByTestId('privacy-consent-accept')).toBeDisabled()
    expect(screen.getByTestId('privacy-consent-decline')).not.toBeDisabled()
    expect(getConsent()).toBe('accepted')
  })
})
