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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
        // Match the shared plural-capable fixture: counted sentences honour
        // one/other defaults so the drawer's hidden-count reads correctly.
        if (opts && typeof opts.count === 'number') {
          const singular = opts.defaultValue_one
          const plural = opts.defaultValue_other
          if (typeof singular === 'string' || typeof plural === 'string') {
            const chosen = opts.count === 1 ? singular : plural
            return interpolate(typeof chosen === 'string' ? chosen : (fallback ?? key))
          }
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
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions'
import { ToastProvider } from '@/components/feedback/Toast'
import {
  getConsent,
  isReportingAllowed,
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

function privacyStrip(): HTMLElement {
  return kpiRegion().querySelector('[data-operational-brief][data-testid="privacy-summary"]') as HTMLElement
}

// Unknown readings are omitted from the brief face; the Review-details
// drawer counts them. Pins the exact hidden-count sentence.
function expectHiddenCount(strip: HTMLElement, text: string) {
  fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }))
  const drawer = screen.getByRole('dialog')
  try {
    expect(within(drawer).getByText(text)).toBeInTheDocument()
  } finally {
    fireEvent.keyDown(drawer, { key: 'Escape' })
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
}

beforeEach(() => {
  mockedRequest.mockReset()
  mockedRequest.mockResolvedValue(versionResponse())
  // Real storage helpers back the page — reset every browser-local surface
  // (recent pages, consent, confirm-silence) so tests never leak into each
  // other via localStorage.
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PrivacyPage — persistence failures', () => {
  it.each(['remove failure', 'unavailable storage'])('does not report history cleared after %s', async (failure) => {
    seedRecentPages(3)
    renderPage()
    await within(kpiRegion()).findByText('Optional')
    fireEvent.click(screen.getByTestId('privacy-clear-recent-pages'))
    const dialog = await screen.findByRole('dialog')
    const spy = failure === 'remove failure'
      ? vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('Storage blocked', 'SecurityError')
      })
      : vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('Storage blocked', 'SecurityError')
      })

    fireEvent.click(within(dialog).getByRole('button', { name: /Clear pages/i }))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(screen.queryByText('Recent pages cleared')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    spy.mockRestore()
    expect(getRecentPages()).toHaveLength(3)
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('3 entries stored')
  })

  it.each([
    { action: 'accept', initial: 'declined', method: 'setItem', success: 'Consent granted' },
    { action: 'decline', initial: 'accepted', method: 'setItem', success: 'Consent withdrawn' },
    { action: 'reset', initial: 'accepted', method: 'removeItem', success: 'Consent reset — banner will reappear' },
  ] as const)('retains persisted consent and reporting policy when $action fails', async ({ action, initial, method, success }) => {
    setConsent(initial)
    renderPage()
    await within(kpiRegion()).findByText('Optional')
    const spy = vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })

    fireEvent.click(screen.getByTestId(`privacy-consent-${action}`))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(screen.queryByText(success)).not.toBeInTheDocument()
    expect(getConsent()).toBe(initial)
    expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute('data-consent-state', initial)
    expect(within(kpiRegion()).getByText(initial === 'accepted' ? 'Accepted' : 'Declined')).toBeInTheDocument()
    expect(isReportingAllowed(true)).toBe(initial === 'accepted')
    expect(isReportingAllowed(false)).toBe(true)

    spy.mockRestore()
    fireEvent.click(screen.getByTestId(`privacy-consent-${action}`))
    expect(await screen.findByText(success)).toBeInTheDocument()
  })

  it.each(['accept', 'decline', 'reset'])('does not report consent %s as persisted when storage is unavailable', async (action) => {
    if (action === 'reset') setConsent('accepted')
    renderPage()
    await within(kpiRegion()).findByText('Optional')
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })

    fireEvent.click(screen.getByTestId(`privacy-consent-${action}`))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(screen.queryByText('Consent granted')).not.toBeInTheDocument()
    expect(screen.queryByText('Consent withdrawn')).not.toBeInTheDocument()
    expect(screen.queryByText('Consent reset — banner will reappear')).not.toBeInTheDocument()
    expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute('data-consent-state', 'unknown')
    expect(isReportingAllowed(true)).toBe(false)
  })
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
    const strip = privacyStrip()
    const tiles = strip.querySelectorAll('[data-operational-metric]')
    expect(tiles).toHaveLength(4)
    expect(tiles[0].querySelector('[data-operational-value]')).toHaveTextContent('3')
    expect(tiles[1].querySelector('[data-operational-value]')).toHaveTextContent('Not decided')
    expect(tiles[2].querySelector('[data-operational-value]')).toHaveTextContent('Optional')
    expect(tiles[3].querySelector('[data-operational-value]')).toHaveTextContent('This browser')
    expect(document.title).toContain('Privacy')
    // Scope and per-metric context live in the Review-details drawer now.
    assertOperationalBriefDisclosure(strip, 'Local browser state and the latest deployment policy have no common date range.', { contains: true })
    fireEvent.click(within(strip as HTMLElement).getByRole('button', { name: 'Review details' }))
    const drawer = await screen.findByRole('dialog')
    try {
      expect(drawer).toHaveTextContent('of 50 max')
      expect(drawer).toHaveTextContent('Not decided')
      expect(drawer).toHaveTextContent('Local only — never synced')
      expect(within(within(drawer).getByRole('group', { name: 'Recent pages stored' })).getByText('of 50 max')).toBeInTheDocument()
      expect(within(within(drawer).getByRole('group', { name: 'Data scope' })).getByText('Local only — never synced')).toBeInTheDocument()
    } finally {
      fireEvent.keyDown(drawer, { key: 'Escape' })
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
    const strip = privacyStrip()
    const tiles = strip.querySelectorAll('[data-operational-metric]')
    expect(tiles).toHaveLength(3)
    expect(tiles[0].querySelector('[data-operational-value]')).toHaveTextContent('50')
    expect(tiles[1].querySelector('[data-operational-value]')).toHaveTextContent('Declined')
    assertOperationalMetricUnavailable(strip, 'Consent policy')
    expectHiddenCount(strip, '1 empty field is hidden.')
    assertOperationalBriefDisclosure(strip, 'Loading deployment consent policy')
    fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }))
    const loadingDrawer = screen.getByRole('dialog')
    try {
      expect(within(within(loadingDrawer).getByRole('group', { name: 'Recent pages stored' })).getByText('of 50 max')).toBeInTheDocument()
      expect(within(loadingDrawer).getByRole('group', { name: 'Consent status' })).toHaveTextContent('only essential storage in use')
    } finally {
      fireEvent.keyDown(loadingDrawer, { key: 'Escape' })
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(kpiRegion()).queryByText('Optional')).toBeNull()
    expect(tiles[2].querySelector('[data-operational-value]')).toHaveTextContent('This browser')
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeEnabled()
    expect(screen.getByTestId('privacy-consent-decline')).toBeDisabled()
    expect(screen.getByTestId('privacy-consent-accept')).toBeEnabled()
    expect(screen.getByTestId('privacy-consent-reset')).toBeEnabled()
  })

  it.each([undefined, null, 'false', 0])('distinguishes an unknown policy flag (%s) from a transport failure and preserves local actions', async (flag) => {
    const response: Partial<ReturnType<typeof versionResponse>> = versionResponse()
    delete response.require_cookie_consent
    mockedRequest.mockResolvedValue({ ...response, require_cookie_consent: flag })
    seedRecentPages(2)
    const { client } = renderPage()
    await waitFor(() => expect(client.getQueryState(['version'])?.status).toBe('success'))
    const strip = privacyStrip()
    expect(strip.querySelectorAll('[data-operational-metric]')).toHaveLength(3)
    expect(strip.querySelectorAll('[data-value-state="missing"], [data-value-state="invalid"]')).toHaveLength(0)
    assertOperationalMetricUnavailable(strip, 'Consent policy')
    expectHiddenCount(strip, '1 empty field is hidden.')
    assertOperationalBriefDisclosure(strip, 'Deployment policy unavailable')
    expect(within(kpiRegion()).queryByText('Optional')).toBeNull()
    expect(within(kpiRegion()).queryByText('Required')).toBeNull()
    expect(screen.queryByText('Failed to load privacy policy')).not.toBeInTheDocument()
    expect(screen.queryByText('Server error')).not.toBeInTheDocument()
    expect(within(kpiRegion()).queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeEnabled()
    expect(screen.getByTestId('privacy-consent-accept')).toBeEnabled()
    fireEvent.click(screen.getByTestId('privacy-consent-accept'))
    expect(getConsent()).toBe('accepted')
    fireEvent.click(screen.getByTestId('privacy-consent-decline'))
    expect(getConsent()).toBe('declined')
    fireEvent.click(screen.getByTestId('privacy-consent-reset'))
    expect(getConsent()).toBe('unknown')
    fireEvent.click(screen.getByTestId('privacy-clear-recent-pages'))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Clear pages/i }))
    expect(getRecentPages()).toHaveLength(0)
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
    const strip = privacyStrip()
    const tiles = strip.querySelectorAll('[data-operational-metric]')
    expect(tiles).toHaveLength(3)
    expect(tiles[0].querySelector('[data-operational-value]')).toHaveTextContent('0')
    assertOperationalMetricUnavailable(strip, 'Consent policy')
    expectHiddenCount(strip, '1 empty field is hidden.')
    assertOperationalBriefDisclosure(strip, 'Deployment policy unavailable')
    expect(within(kpiRegion()).queryByText('Optional')).toBeNull()
    expect(tiles[2].querySelector('[data-operational-value]')).toHaveTextContent('This browser')
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
    assertOperationalBriefDisclosure(privacyStrip(), 'Retained deployment policy')
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('2 entries stored')
    expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute('data-consent-state', 'accepted')
    expect(screen.getByTestId('privacy-consent-accept')).toBeDisabled()
    expect(screen.getByTestId('privacy-consent-decline')).not.toBeDisabled()
    expect(getConsent()).toBe('accepted')
  })
})

describe('PrivacyPage policy recovery', () => {
  it('retries a failed policy refresh without replacing retained policy or local controls', async () => {
    seedRecentPages(2)
    setConsent('accepted')
    mockedRequest.mockResolvedValue(versionResponse({ require_cookie_consent: true }))
    const { client } = renderPage()
    await within(kpiRegion()).findByText('Required')

    mockedRequest.mockRejectedValue(new ApiError('Refresh unavailable', 500, 'INTERNAL'))
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['version'] })
    })
    const warning = await screen.findByTestId('stale-refresh-warning')
    expect(warning).toHaveAccessibleName('Browser-local privacy and deployment policy')
    expect(warning).toHaveTextContent('Previously loaded data remains visible while affected sources recover.')
    expect(within(kpiRegion()).getByText('Required')).toBeInTheDocument()
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('2 entries stored')
    expect(screen.getByTestId('privacy-consent-state')).toHaveAttribute('data-consent-state', 'accepted')
    expect(screen.getByTestId('privacy-consent-decline')).toBeEnabled()
    expect(screen.getByRole('region', { name: /How TeslaSync handles this data/i })).toBeInTheDocument()

    let resolveRefresh: (value: ReturnType<typeof versionResponse>) => void = () => {}
    mockedRequest.mockImplementation(() => new Promise<ReturnType<typeof versionResponse>>((resolve) => {
      resolveRefresh = resolve
    }))
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }))
    expect(await within(warning).findByRole('button', { name: 'Updating…' })).toBeDisabled()
    expect(within(kpiRegion()).getByText('Required')).toBeInTheDocument()
    expect(getConsent()).toBe('accepted')
    expect(getRecentPages()).toHaveLength(2)

    await act(async () => {
      resolveRefresh(versionResponse({ require_cookie_consent: true }))
    })
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument())
    expect(within(kpiRegion()).getByText('Required')).toBeInTheDocument()
    expect(mockedRequest).toHaveBeenLastCalledWith('/system/version', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('distinguishes a paused initial policy read from empty or optional policy', async () => {
    let resolvePolicy: (value: ReturnType<typeof versionResponse>) => void = () => {}
    mockedRequest.mockImplementation(() => new Promise<ReturnType<typeof versionResponse>>((resolve) => {
      resolvePolicy = resolve
    }))
    seedRecentPages(1)
    const { client } = renderPage()
    act(() => {
      client.getQueryCache().find({ queryKey: ['version'] })?.setState({ fetchStatus: 'paused' })
    })

    const notice = await screen.findByTestId('privacy-policy-paused')
    expect(notice).toHaveTextContent('Loading deployment consent policy')
    expect(within(notice).getByText('Paused')).toBeInTheDocument()
    expect(within(notice).getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(within(kpiRegion()).queryByText('Optional')).not.toBeInTheDocument()
    const pausedStrip = privacyStrip()
    expect(pausedStrip.querySelectorAll('[data-operational-metric]')).toHaveLength(3)
    assertOperationalMetricUnavailable(pausedStrip, 'Consent policy')
    expectHiddenCount(pausedStrip, '1 empty field is hidden.')
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('1 entries stored')
    expect(screen.getByTestId('privacy-consent-accept')).toBeEnabled()
    expect(screen.getByRole('region', { name: /How TeslaSync handles this data/i })).toBeInTheDocument()
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(notice).not.toHaveTextContent(/offline|server error/i)

    await act(async () => {
      resolvePolicy(versionResponse({ require_cookie_consent: true }))
    })
    expect(await within(kpiRegion()).findByText('Required')).toBeInTheDocument()
    expect(screen.queryByTestId('privacy-policy-paused')).not.toBeInTheDocument()
    expect(getConsent()).toBe('unknown')
    expect(getRecentPages()).toHaveLength(1)
  })

  it('offers policy-only recovery for a paused retained read without inventing an error', async () => {
    mockedRequest.mockResolvedValue(versionResponse({ require_cookie_consent: true }))
    const { client } = renderPage()
    await within(kpiRegion()).findByText('Required')
    act(() => {
      client.getQueryCache().find({ queryKey: ['version'] })?.setState({ fetchStatus: 'paused' })
    })

    const warning = await screen.findByTestId('stale-refresh-warning')
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true')
    expect(within(warning).getByRole('button', { name: 'Refresh' })).toBeEnabled()
    expect(warning).not.toHaveTextContent(/offline|server error/i)
    expect(client.getQueryState(['version'])?.error).toBeNull()
    expect(within(kpiRegion()).getByText('Required')).toBeInTheDocument()
    expect(screen.getByTestId('privacy-consent-accept')).toBeEnabled()
    expect(screen.queryByTestId('privacy-policy-paused')).not.toBeInTheDocument()

    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument())
    expect(within(kpiRegion()).getByText('Required')).toBeInTheDocument()
    expect(getConsent()).toBe('unknown')
  })
})
