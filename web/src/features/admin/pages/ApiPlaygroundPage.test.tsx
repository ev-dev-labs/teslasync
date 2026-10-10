/**
 * ApiPlaygroundPage — behavioural + unit coverage.
 *
 * The page fetches the OpenAPI spec as YAML text via `request()`, parses it
 * into a sorted/grouped endpoint list, and lets the operator build + fire a
 * live request (through the global `fetch`, not `request`). It derives a KPI
 * band from the spec + local request history, and offers replay of past
 * requests.
 *
 * Covered here:
 *  1. findReplayEndpoint (exported helper) — exact match, param-template match,
 *     method mismatch, no match, and exact-preferred-over-template. This is the
 *     regression the elevation surfaced: history stores the CONCRETE path
 *     (`/vehicles/1/state`) while endpoints hold the TEMPLATE
 *     (`/vehicles/{vehicleID}/state`), so a naive `===` never re-selects a
 *     parameterised endpoint.
 *  2. Loading state — skeletons render, KPI labels are absent.
 *  3. Parsed spec — KPI counts (total/read/write/groups), tag groups, and
 *     endpoint rows all render.
 *  4. Empty spec — the "no endpoints" EmptyState renders.
 *  5. Spec error — QueryError surfaces AND the KPI band still renders zeros
 *     (it must not vanish and lie by omission).
 *  6. Select + send a GET — `fetch` is called with the right method/URL, the
 *     200 response renders, and a history chip appears.
 *  7. Replay — after path params are substituted, clicking the history chip
 *     re-selects the templated endpoint (the bug fix in action).
 *  8. Refresh — the reload-spec button refetches.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('@/hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>()
  const { summaryTestPreferences } = await import('../components/operationalbrief-a-g/summaryTestPreferences')
  return { ...actual, useSettings: summaryTestPreferences }
})
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// ── i18n stub: return the fallback string, interpolating {{vars}} ──────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          )
        }
        return fallbackOrOpts
      }
      return _key
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

// ── @/api/client: keep apiUrl + isApiError real, stub only `request` ───────
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, request: vi.fn() }
})

import ApiPlaygroundPage, { findReplayEndpoint } from './ApiPlaygroundPage'
import { request, ApiError } from '@/api/client'
import type { ParsedEndpoint } from '../components/EndpointSidebar'
import type { HistoryEntry } from '../components/ResponseViewer'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

/* ─── fixtures ─────────────────────────────────────────────────────────── */

// 3 endpoints across 2 tags: 2 GET (one with a path param), 1 POST.
const SPEC_YAML = `
openapi: 3.0.0
info:
  title: TeslaSync API
  version: 1.0.0
tags:
  - name: Vehicles
  - name: Alerts
paths:
  /vehicles:
    get:
      tags:
        - Vehicles
      summary: List vehicles
      operationId: listVehicles
      responses:
        '200':
          description: A list of vehicles
  /vehicles/{vehicleID}/state:
    get:
      tags:
        - Vehicles
      summary: Get vehicle state
      operationId: getVehicleState
      parameters:
        - name: vehicleID
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: Vehicle state
  /alerts:
    post:
      tags:
        - Alerts
      summary: Create alert
      operationId: createAlert
      requestBody:
        content:
          application/json:
            example:
              name: high-battery
      responses:
        '201':
          description: Created
`

const EMPTY_SPEC_YAML = `
openapi: 3.0.0
paths: {}
`

function mkEndpoint(
  method: ParsedEndpoint['method'],
  path: string,
  tag = 'Vehicles',
): ParsedEndpoint {
  return {
    method,
    path,
    tag,
    summary: '',
    description: '',
    operationId: '',
    parameters: [],
    responses: {},
  }
}

function mkEntry(method: string, path: string): HistoryEntry {
  return { method, path, status: 200, duration: 5, timestamp: new Date().toISOString() }
}

// Minimal fetch Response double for `executeRequest` (needs status/statusText,
// headers.get + headers.forEach, and text()).
function fakeResponse(opts?: {
  status?: number
  statusText?: string
  body?: unknown
  contentType?: string
}): Response {
  const status = opts?.status ?? 200
  const statusText = opts?.statusText ?? 'OK'
  const contentType = opts?.contentType ?? 'application/json'
  const bodyText =
    typeof opts?.body === 'string'
      ? opts.body
      : JSON.stringify(opts?.body ?? { message: 'ok' })
  const headers = new Headers({ 'content-type': contentType })
  return {
    status,
    statusText,
    headers,
    text: async () => bodyText,
  } as unknown as Response
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ApiPlaygroundPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function kpiRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'API overview metrics' })
}

beforeEach(() => {
  mockedRequest.mockReset()
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ─── unit: findReplayEndpoint ─────────────────────────────────────────── */

describe('findReplayEndpoint', () => {
  const endpoints: ParsedEndpoint[] = [
    mkEndpoint('GET', '/vehicles'),
    mkEndpoint('GET', '/vehicles/{vehicleID}/state'),
    mkEndpoint('POST', '/alerts', 'Alerts'),
  ]

  it('returns the endpoint on an exact literal match', () => {
    const ep = findReplayEndpoint(endpoints, mkEntry('GET', '/vehicles'))
    expect(ep).toBeDefined()
    expect(ep?.path).toBe('/vehicles')
    expect(ep?.method).toBe('GET')
  })

  it('matches a substituted concrete path back to its {param} template', () => {
    // The core regression: `/vehicles/1/state` must resolve to the template.
    const ep = findReplayEndpoint(endpoints, mkEntry('GET', '/vehicles/1/state'))
    expect(ep?.path).toBe('/vehicles/{vehicleID}/state')
  })

  it('does not cross methods (POST history never replays a GET endpoint)', () => {
    expect(findReplayEndpoint(endpoints, mkEntry('POST', '/vehicles'))).toBeUndefined()
  })

  it('returns undefined when nothing matches (segment count differs)', () => {
    expect(
      findReplayEndpoint(endpoints, mkEntry('GET', '/vehicles/1/state/extra')),
    ).toBeUndefined()
  })

  it('prefers an exact literal route over a colliding {param} template', () => {
    const withCollision: ParsedEndpoint[] = [
      mkEndpoint('GET', '/vehicles/{vehicleID}'),
      mkEndpoint('GET', '/vehicles/count'),
    ]
    const ep = findReplayEndpoint(withCollision, mkEntry('GET', '/vehicles/count'))
    expect(ep?.path).toBe('/vehicles/count')
  })
})

/* ─── page ─────────────────────────────────────────────────────────────── */

describe('ApiPlaygroundPage', () => {
  it('keeps specification and saved local history as separate real operational briefs', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    renderPage()
    const spec = screen.getByTestId('api-playground-spec-summary')
    await waitFor(() => expect(spec.querySelectorAll('[data-value-state="value"]')).toHaveLength(4))
    const history = screen.getByTestId('api-playground-history-summary')
    expect(spec).toHaveAttribute('data-operational-brief')
    expect(history).toHaveAttribute('data-operational-brief')
    expect(history.querySelector('[data-operational-metric="recent"]')).toHaveAttribute('data-value-state', 'value')
    expect(history.querySelector('[data-operational-metric="latency"]')).toHaveAttribute('data-value-state', 'missing')
    expect(history).toHaveTextContent('not server-wide traffic')
    fireEvent.click(within(spec).getByRole('button', { name: 'Review details' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('loaded API specification')
    expect(screen.getByRole('complementary', { name: 'Endpoint explorer' })).toBeInTheDocument()
  })

  it('renders skeletons with retained KPI labels while the spec query is loading', async () => {
    let resolve!: (value: string) => void
    mockedRequest.mockReturnValueOnce(
      new Promise<string>((r) => {
        resolve = r
      }),
    )

    renderPage()

    const region = kpiRegion()
    expect(within(region).getByText('Total endpoints')).toBeInTheDocument()
    const specSummary = screen.getByTestId('api-playground-spec-summary')
    expect(specSummary).toHaveAttribute('aria-busy', 'true')
    expect(specSummary.querySelector('[data-operational-value]')).toBeNull()
    expect(region.querySelectorAll('[data-operational-metric]')).toHaveLength(6)
    expect(screen.getByTestId('api-playground-history-summary')).toHaveTextContent('0')

    // Resolve so the query settles and teardown is clean.
    resolve(EMPTY_SPEC_YAML)
    await waitFor(() =>
      expect(within(kpiRegion()).getByText('Total endpoints')).toBeInTheDocument(),
    )
  })

  it('parses the spec into KPI counts, tag groups, and endpoint rows', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)

    renderPage()

    const spec = screen.getByTestId('api-playground-spec-summary')
    await waitFor(() => expect(spec.querySelectorAll('[data-value-state="value"]')).toHaveLength(4))

    await waitFor(() =>
      expect(within(kpiRegion()).getByText('Total endpoints')).toBeInTheDocument(),
    )

    // Spec fetched as text (not JSON) from the canonical route.
    expect(mockedRequest).toHaveBeenCalledWith(
      '/system/openapi',
      expect.objectContaining({ responseType: 'text' }),
    )

    // KPI band: 3 endpoints, 2 GET, 1 write, 2 tag groups.
    const region = kpiRegion()
    expect(within(region).getByText('Total endpoints')).toBeInTheDocument()
    expect(within(region).getByText('3')).toBeInTheDocument() // total (unique)
    expect(within(region).getByText('1')).toBeInTheDocument() // write ops (unique)
    expect(within(region).getByText('Read (GET)')).toBeInTheDocument()
    expect(within(region).getByText('API groups')).toBeInTheDocument()
    expect(within(region).getByText('Avg latency')).toBeInTheDocument()

    // Tag groups + endpoint rows from the parser.
    expect(screen.getByText('Vehicles')).toBeInTheDocument()
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByText('/vehicles')).toBeInTheDocument()
    expect(screen.getByText('/vehicles/{vehicleID}/state')).toBeInTheDocument()
    expect(screen.getByText('/alerts')).toBeInTheDocument()
  })

  it('shows the no-endpoints empty state for a spec with zero paths', async () => {
    mockedRequest.mockResolvedValueOnce(EMPTY_SPEC_YAML)

    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('No endpoints found in the API spec'),
      ).toBeInTheDocument(),
    )
    // KPI band still present, all zero.
    expect(within(kpiRegion()).getByText('Total endpoints')).toBeInTheDocument()
  })

  it('surfaces a QueryError, unknown spec KPIs and independently known local history when the spec fails', async () => {
    mockedRequest.mockRejectedValue(new ApiError('kaboom', 500))

    renderPage()

    // 5xx branch of QueryError.
    await waitFor(() =>
      expect(screen.getByText('Server error')).toBeInTheDocument(),
    )
    const explorer = screen.getByRole('complementary', { name: 'Endpoint explorer' })
    expect(within(explorer).getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    // The spec is unknown, while the separate, empty local request history is a known zero.
    const region = kpiRegion()
    expect(within(region).getByText('Total endpoints')).toBeInTheDocument()
    expect(within(region).getAllByText('—')).toHaveLength(5)
    expect(within(region).getByText('0')).toBeInTheDocument()
  })

  it('sends a selected GET request and renders the response + history', async () => {
    mockedRequest.mockResolvedValue(SPEC_YAML)
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse({ status: 200, statusText: 'OK', body: { message: 'ok' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    // Pick the parameterless GET endpoint from the sidebar.
    fireEvent.click(await screen.findByText('/vehicles'))

    // Request builder shows the resolved URL bar.
    expect(await screen.findByText('/api/v1/vehicles')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Send/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toContain('/api/v1/vehicles')
    expect(calledOpts.method).toBe('GET')

    // Response panel renders status + body.
    expect(await screen.findByText('200 OK')).toBeInTheDocument()
    expect(screen.getByText(/"message"/)).toBeInTheDocument()

    // A history chip is recorded for the fired request.
    expect(screen.getByTitle(/GET \/vehicles → 200/)).toBeInTheDocument()
  })

  it('replays a substituted path back onto its templated endpoint', async () => {
    mockedRequest.mockResolvedValue(SPEC_YAML)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fakeResponse({ status: 200, statusText: 'OK' })),
    )

    renderPage()

    // Select the endpoint WITH a path param and fill it in.
    fireEvent.click(await screen.findByText('/vehicles/{vehicleID}/state'))
    const paramInput = await screen.findByPlaceholderText('integer')
    fireEvent.change(paramInput, { target: { value: '1' } })
    expect(await screen.findByText('/api/v1/vehicles/1/state')).toBeInTheDocument()

    // Fire it — history now stores the CONCRETE path `/vehicles/1/state`.
    fireEvent.click(screen.getByRole('button', { name: /Send/i }))
    const chip = await screen.findByTitle(/GET \/vehicles\/1\/state → 200/)

    // Switch to a different endpoint so the path-param input goes away.
    fireEvent.click(screen.getByText('/vehicles'))
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('integer')).toBeNull(),
    )

    // Replay: with the bug this was a no-op; the fix re-selects the template,
    // so the path-param input reappears.
    fireEvent.click(chip)
    expect(await screen.findByPlaceholderText('integer')).toBeInTheDocument()
    expect(screen.getByText('/api/v1/vehicles/{vehicleID}/state')).toBeInTheDocument()
  })

  it('refetches the spec when the reload button is clicked', async () => {
    mockedRequest.mockResolvedValue(SPEC_YAML)

    renderPage()

    const spec = screen.getByTestId('api-playground-spec-summary')
    await waitFor(() => expect(spec.querySelectorAll('[data-value-state="value"]')).toHaveLength(4))

    await waitFor(() =>
      expect(within(kpiRegion()).getByText('Total endpoints')).toBeInTheDocument(),
    )

    const before = mockedRequest.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Reload API spec' }))

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    )
  })

  it('keeps the endpoint explorer and selected request usable after a failed spec refresh, with no automatic request execution', async () => {
    mockedRequest.mockResolvedValue(SPEC_YAML)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.click(await screen.findByText('/vehicles'))
    await screen.findByText('/api/v1/vehicles')
    mockedRequest.mockRejectedValue(new ApiError('spec refresh failed', 500))
    fireEvent.click(screen.getByRole('button', { name: 'Reload API spec' }))
    await screen.findByText('Data may be stale')
    expect(screen.getByText('/vehicles/{vehicleID}/state')).toBeInTheDocument()
    expect(screen.getByText('/api/v1/vehicles')).toBeInTheDocument()
    expect(within(kpiRegion()).getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send/i })).toBeEnabled()
    expect(screen.queryByText('Server error')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
