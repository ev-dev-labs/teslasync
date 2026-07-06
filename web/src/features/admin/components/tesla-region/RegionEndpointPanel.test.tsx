/**
 * RegionEndpointPanel contract tests.
 *
 * RegionEndpointPanel is a purely presentational hero panel: it owns its own
 * loading / error / empty / configured branches but never fetches — every
 * field arrives as a prop. The tests therefore drive it with hand-built props
 * (no network mocking beyond the transitive `@/api/client` seam its QueryError
 * and TimeStamp children reach for) and assert *behaviour* through the real
 * shared components, mirroring the sibling admin-panel tests
 * (RateLimitStatusPanel, GasPriceKpiBand).
 *
 * Coverage:
 *   1. Header (title + subtitle) is always visible, in every state.
 *   2. Loading branch → skeletons only; no error/empty/content leaks.
 *   3. Loading takes precedence over a simultaneous error flag.
 *   4. Error branch → QueryError alert; Retry invokes `onRetry`.
 *   5. Empty branch → EmptyState CTA; Refresh invokes `onRefresh`.
 *   6. Empty branch is reached for empty-string region AND base URL.
 *   7. Configured (NA) → zone label, zone badge, base URL <code>, copy control,
 *      and all five KV rows (region, code, protocol, host, last synced).
 *   8. The copy control writes the base URL to the clipboard.
 *   9. Configured (EU) → the eu zone label + badge branch.
 *  10. Partial data (null base URL) → em-dash placeholders, no copy control,
 *      headline falls back to the raw region string.
 *  11. Empty-string region with an unrecognised zone → headline shows the
 *      "Not detected" fallback and the Region KV row shows "—" (null-safety
 *      regression guard: `??` would leak the empty string as a blank surface).
 *  12. Empty-string base URL → the <code> shows "—" and no copy control.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// The panel never fetches, but its QueryError child imports `isApiError`
// (to branch on HTTP status) and its TimeStamp child transitively pulls
// `@/api/hooks/useSettings` → `request('/settings')`. Stub both so the error
// branch is deterministic (generic network/unknown) and the settings query
// resolves to an empty object (never `undefined`, which React Query rejects).
vi.mock('@/api/client', () => ({
  request: vi.fn().mockResolvedValue({}),
  isApiError: () => false,
}))

// i18n: return the default string for t(key, default, opts), interpolating
// {{var}} tokens — identical to the sibling admin-panel test convention.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ToastProvider } from '@/components/feedback/Toast'
import {
  RegionEndpointPanel,
  type RegionEndpointPanelProps,
} from './RegionEndpointPanel'

const NA_URL = 'https://fleet-api.prd.na.vn.cloud.tesla.com'
const NA_HOST = 'fleet-api.prd.na.vn.cloud.tesla.com'
const NA_ZONE = 'North America & Asia-Pacific (excl. China)'
const EU_URL = 'https://fleet-api.prd.eu.vn.cloud.tesla.com'
const EU_ZONE = 'Europe, Middle East & Africa'
const EM_DASH = '—'

function baseProps(
  overrides: Partial<RegionEndpointPanelProps> = {},
): RegionEndpointPanelProps {
  return {
    region: 'North America',
    baseUrl: NA_URL,
    host: NA_HOST,
    scheme: 'https',
    regionKey: 'na',
    regionLabel: NA_ZONE,
    fetchedAt: '2026-01-02T03:04:05Z',
    isLoading: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  }
}

function renderPanel(overrides: Partial<RegionEndpointPanelProps> = {}) {
  const props = baseProps(overrides)
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <RegionEndpointPanel {...props} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, props }
}

const SUBTITLE =
  'The regional base URL TeslaSync uses for every Fleet API call.'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RegionEndpointPanel — header & state precedence', () => {
  it('always renders the panel heading and subtitle, even while loading', () => {
    renderPanel({ isLoading: true })

    expect(
      screen.getByRole('heading', { name: 'Fleet API endpoint' }),
    ).toBeInTheDocument()
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
  })

  it('renders only skeletons in the loading branch (no error/content leak)', () => {
    const { container } = renderPanel({ isLoading: true })

    // Skeleton(height=64) → 1 pulse; Skeleton(lines=5) → 5 pulses = 6 total.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6)
    // Content-only affordances must be absent while loading.
    expect(screen.queryByText('Fleet API base URL')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Copy Fleet API base URL' }),
    ).not.toBeInTheDocument()
  })

  it('gives the loading branch precedence over a simultaneous error flag', () => {
    const { container } = renderPanel({
      isLoading: true,
      isError: true,
      error: new Error('boom'),
    })

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('RegionEndpointPanel — error branch', () => {
  it('renders a QueryError banner and wires Retry to onRetry', async () => {
    const onRetry = vi.fn()
    renderPanel({ isError: true, error: new Error('network down'), onRetry })

    // Generic network branch (isApiError → false, navigator.onLine → true).
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Can't reach server")

    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not render the endpoint content while erroring', () => {
    renderPanel({ isError: true, error: new Error('nope') })

    expect(screen.queryByText('Fleet API base URL')).not.toBeInTheDocument()
    expect(screen.queryByText(NA_URL)).not.toBeInTheDocument()
  })
})

describe('RegionEndpointPanel — empty / not-configured branch', () => {
  it('renders the empty state and wires its Refresh CTA to onRefresh', () => {
    const onRefresh = vi.fn()
    renderPanel({
      region: null,
      baseUrl: null,
      host: null,
      scheme: null,
      regionKey: null,
      regionLabel: null,
      fetchedAt: null,
      onRefresh,
    })

    expect(screen.getByText('No region on record')).toBeInTheDocument()
    // EmptyState announces itself politely to assistive tech.
    expect(screen.getByRole('status')).toBeInTheDocument()

    const refresh = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refresh)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    // Endpoint detail must NOT render when nothing is configured.
    expect(screen.queryByText('Fleet API base URL')).not.toBeInTheDocument()
  })

  it('treats empty-string region AND base URL as not configured', () => {
    renderPanel({
      region: '',
      baseUrl: '',
      host: null,
      scheme: null,
      regionKey: null,
      regionLabel: null,
      fetchedAt: null,
    })

    expect(screen.getByText('No region on record')).toBeInTheDocument()
  })
})

describe('RegionEndpointPanel — configured endpoint', () => {
  it('renders the NA zone label, badge, base URL, copy control and KV rows', () => {
    renderPanel()

    // Headline zone label + compact zone badge.
    expect(screen.getByText(NA_ZONE)).toBeInTheDocument()
    expect(screen.getAllByText('NA').length).toBeGreaterThanOrEqual(1)

    // Base URL rendered in a <code> element.
    const code = screen.getByText(NA_URL)
    expect(code.tagName).toBe('CODE')

    // Copy control is present and labelled for assistive tech.
    expect(
      screen.getByRole('button', { name: 'Copy Fleet API base URL' }),
    ).toBeInTheDocument()

    // KV rows: region name, protocol, host all rendered.
    expect(screen.getByText('North America')).toBeInTheDocument()
    expect(screen.getByText('HTTPS')).toBeInTheDocument()
    expect(screen.getByText(NA_HOST)).toBeInTheDocument()
    expect(screen.getByText('Last synced')).toBeInTheDocument()

    // The empty/error surfaces stay out of the configured branch.
    expect(screen.queryByText('No region on record')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('copies the base URL to the clipboard when the copy control is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    renderPanel()

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy Fleet API base URL' }),
    )

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(NA_URL))
  })

  it('renders the EU zone label and badge for a eu endpoint', () => {
    renderPanel({
      region: 'Europe',
      baseUrl: EU_URL,
      host: 'fleet-api.prd.eu.vn.cloud.tesla.com',
      scheme: 'https',
      regionKey: 'eu',
      regionLabel: EU_ZONE,
    })

    expect(screen.getByText(EU_ZONE)).toBeInTheDocument()
    expect(screen.getAllByText('EU').length).toBeGreaterThanOrEqual(1)
    // The NA label must not leak into the EU hero.
    expect(screen.queryByText(NA_ZONE)).not.toBeInTheDocument()
  })
})

describe('RegionEndpointPanel — null-safety & empty-string hardening', () => {
  it('shows em-dash placeholders and hides the copy control when the base URL is missing', () => {
    renderPanel({
      region: 'North America',
      baseUrl: null,
      host: null,
      scheme: null,
      regionKey: null,
      regionLabel: null,
      fetchedAt: null,
    })

    // Headline falls back from the (null) zone label to the raw region string,
    // so "North America" appears twice: the headline AND the Region KV row.
    expect(screen.getAllByText('North America')).toHaveLength(2)

    // No copy control without a base URL.
    expect(
      screen.queryByRole('button', { name: 'Copy Fleet API base URL' }),
    ).not.toBeInTheDocument()

    // Every missing field degrades to the em-dash placeholder — never a blank:
    // base URL <code>, region code, protocol, host and last-synced = 5.
    expect(screen.getAllByText(EM_DASH)).toHaveLength(5)
  })

  it('renders the "Not detected" fallback (not a blank) for an empty-string region', () => {
    renderPanel({
      region: '',
      baseUrl: 'https://example.com',
      host: 'example.com',
      scheme: 'https',
      regionKey: null,
      regionLabel: null,
      fetchedAt: null,
    })

    // Headline must not collapse to an empty string when region is "".
    expect(screen.getByText('Not detected')).toBeInTheDocument()

    // The Region KV row degrades to the em-dash rather than a blank cell.
    const regionDt = screen.getByText('Region')
    expect(regionDt.nextElementSibling).toHaveTextContent(EM_DASH)
  })

  it('renders "—" in the code slot (not a blank) for an empty-string base URL', () => {
    const { container } = renderPanel({
      region: 'North America',
      baseUrl: '',
      host: null,
      scheme: null,
      regionKey: null,
      regionLabel: null,
      fetchedAt: null,
    })

    const code = container.querySelector('code')
    expect(code?.textContent).toBe(EM_DASH)
    expect(
      screen.queryByRole('button', { name: 'Copy Fleet API base URL' }),
    ).not.toBeInTheDocument()
  })
})
