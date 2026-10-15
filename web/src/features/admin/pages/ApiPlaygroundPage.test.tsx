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
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
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
import ResponseViewer, { SnippetPanel, type HistoryEntry, type ApiResponse } from '../components/ResponseViewer'
import { executeRequest } from '../components/continuation-admin-1/playgroundRequest'
import * as errorReporter from '@/lib/errorReporter'

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
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
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
  it.each([
    { name: 'malformed JSON', raw: '{"secret":"synthetic-secret",' },
    { name: 'invalid root', raw: JSON.stringify({ secret: 'synthetic-secret' }) },
    { name: 'all-invalid rows', raw: JSON.stringify([null, { method: 'GET', path: '/vehicles', status: 200 }]) },
  ])('recovers from $name history with feedback and usable request execution', async ({ raw }) => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    sessionStorage.setItem('teslasync-api-playground-history', raw)
    const report = vi.spyOn(errorReporter, 'reportFrontendError').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ body: { recovered: true } }))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('Saved request history could not be loaded')
    expect(screen.getByRole('alert')).toHaveTextContent('empty history')
    expect(screen.getByTestId('api-playground-history-summary').querySelector('[data-operational-metric="recent"]')).toHaveTextContent('0')
    expect(report).toHaveBeenCalledWith(expect.any(Error), 'react')
    expect(report.mock.calls[0][0]).toHaveProperty('message', 'API playground saved history could not be loaded')
    expect(sessionStorage.getItem('teslasync-api-playground-history')).toBe(raw)
    fireEvent.click(await screen.findByText('/vehicles'))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('region', { name: 'Response body' })).toHaveTextContent('"recovered": true')
    const saved = JSON.parse(sessionStorage.getItem('teslasync-api-playground-history') ?? '[]') as HistoryEntry[]
    expect(saved).toEqual([{
      method: 'GET', path: '/vehicles', status: 200, duration: expect.any(Number), timestamp: expect.any(String),
    }])
  })

  it('retains mixed-valid history, reports invalid rows and replays metadata without auto-sending', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    sessionStorage.setItem('teslasync-api-playground-history', JSON.stringify([
      null,
      { ...mkEntry('GET', '/vehicles/4/state?token=synthetic-secret'), body: 'synthetic-body', headers: { Authorization: 'synthetic-token' } },
      { method: 'POST', path: '/alerts', status: 0 },
    ]))
    const report = vi.spyOn(errorReporter, 'reportFrontendError').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse())
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.click(await screen.findByText('/vehicles'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'API playground history contains invalid entries' }), 'react')
    fireEvent.click(screen.getByTitle(/GET \/vehicles\/4\/state → 200/))
    expect(screen.getByPlaceholderText('integer')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/synthetic-secret|synthetic-body|synthetic-token/)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('integer'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('region', { name: 'Response body' })
    const saved = JSON.parse(sessionStorage.getItem('teslasync-api-playground-history') ?? '[]') as HistoryEntry[]
    expect(saved).toHaveLength(2)
    expect(saved[1].path).toBe('/vehicles/4/state')
    expect(saved.every(entry => Object.keys(entry).sort().join(',') === 'duration,method,path,status,timestamp')).toBe(true)
  })

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

  it('forwards specification cancellation to the canonical text request and aborts on unmount', async () => {
    mockedRequest.mockReturnValue(new Promise<string>(() => {}))
    const page = renderPage()
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    const [path, options] = mockedRequest.mock.calls[0] as [
      string,
      { signal: AbortSignal; responseType: string; credentials: string; headers: Record<string, string> },
    ]
    expect(path).toBe('/system/openapi')
    expect(options).toEqual(expect.objectContaining({
      responseType: 'text',
      credentials: 'same-origin',
      headers: { Accept: 'text/yaml' },
      signal: expect.any(AbortSignal),
    }))
    expect(options.signal.aborted).toBe(false)
    const reload = screen.getByRole('button', { name: 'Reload API spec' })
    expect(reload).toBeDisabled()
    expect(reload).toHaveAttribute('aria-busy', 'true')
    expect(reload).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-10', 'md:min-w-10')
    page.unmount()
    expect(options.signal.aborted).toBe(true)
  })

  it('announces a pending specification reload without hiding retained endpoints or local history', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    renderPage()
    await screen.findByText('/vehicles')
    let finishReload!: (spec: string) => void
    mockedRequest.mockReturnValueOnce(new Promise<string>(resolve => { finishReload = resolve }))
    const reload = screen.getByRole('button', { name: 'Reload API spec' })
    fireEvent.click(reload)
    await waitFor(() => expect(reload).toHaveAttribute('aria-busy', 'true'))
    expect(reload).toBeDisabled()
    expect(screen.getByText('/vehicles/{vehicleID}/state')).toBeInTheDocument()
    expect(within(kpiRegion()).getByText('3')).toBeInTheDocument()
    expect(screen.getByTestId('api-playground-history-summary')).not.toHaveAttribute('aria-busy', 'true')
    finishReload(SPEC_YAML)
    await waitFor(() => expect(reload).toBeEnabled())
    expect(reload).not.toHaveAttribute('aria-busy', 'true')
  })

  it('keeps explorer search, disclosure and endpoint selection network-free', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    const explorer = screen.getByRole('complementary', { name: 'Endpoint explorer' })
    await within(explorer).findByText('/vehicles')
    const search = within(explorer).getByRole('textbox', { name: 'Search endpoints...' })
    for (const term of ['/vehicles/{vehicleID}', 'Get vehicle state', 'getVehicleState']) {
      fireEvent.change(search, { target: { value: term } })
      expect(within(explorer).getByText('/vehicles/{vehicleID}/state')).toBeInTheDocument()
      expect(within(explorer).queryByText('/vehicles')).toBeNull()
      expect(within(explorer).queryByText('/alerts')).toBeNull()
    }
    fireEvent.change(search, { target: { value: 'no-match' } })
    expect(within(explorer).getByText('No matching endpoints')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: '' } })
    const vehicles = within(explorer).getByRole('button', { name: /Vehicles/ })
    fireEvent.click(vehicles)
    expect(vehicles).toHaveAttribute('aria-expanded', 'false')
    expect(within(explorer).queryByText('/vehicles')).toBeNull()
    fireEvent.click(vehicles)
    expect(vehicles).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(explorer).getByText('/vehicles'))
    expect(screen.getByText('/api/v1/vehicles')).toBeInTheDocument()
    expect(screen.getByText('Send a request to see the response')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks only request and response regions busy while retaining independent history and raw SI payloads', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    let finishRequest!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => { finishRequest = resolve })))
    renderPage()
    fireEvent.click(await screen.findByText('/vehicles'))
    const requestRegion = screen.getByRole('region', { name: 'Request' })
    const responseRegion = screen.getByRole('region', { name: 'Response' })
    expect(requestRegion).toHaveAttribute('aria-busy', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(requestRegion).toHaveAttribute('aria-busy', 'true')
    expect(responseRegion).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled()
    expect(screen.getByTestId('api-playground-history-summary')).not.toHaveAttribute('aria-busy', 'true')
    finishRequest(fakeResponse({ body: { distance_m: 1234.5, speed_mps: 0, energy_wh: null, active: false } }))
    await screen.findByText('200 OK')
    expect(requestRegion).toHaveAttribute('aria-busy', 'false')
    expect(responseRegion).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('region', { name: 'Response body' }).textContent).toBe(JSON.stringify({
      distance_m: 1234.5, speed_mps: 0, energy_wh: null, active: false,
    }, null, 2))
  })

  it.each([
    { caseName: 'POST', method: 'POST' },
    { caseName: 'PUT', method: 'PUT' },
    { caseName: 'PATCH', method: 'PATCH' },
    { caseName: 'DELETE', method: 'DELETE' },
  ])('preserves deliberate $caseName confirmation, parameter defaults, body, optional auth and metadata-only history', async ({ method }) => {
    mockedRequest.mockResolvedValueOnce(JSON.stringify({
      openapi: '3.0.0',
      components: {
        parameters: {
          vehicle: { name: 'vehicleID', in: 'path', required: true, schema: { type: 'string', default: '4' } },
        },
        schemas: { reading: { type: 'object', example: { energy_wh: 1000, speed_mps: 0 } } },
      },
      paths: {
        '/vehicles/{vehicleID}/example': {
          [method.toLowerCase()]: {
            tags: ['Example', 'Secondary'],
            summary: 'Example operation',
            description: 'Distinct endpoint documentation',
            parameters: [
              { $ref: '#/components/parameters/vehicle' },
              { name: 'search', in: 'query', schema: { type: 'string', default: 'default query' } },
            ],
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/reading' } } } },
            responses: { '409': { description: 'Conflict' } },
          },
        },
      },
    }))
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({
      status: 409, statusText: 'Conflict', body: { error: 'example conflict' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    sessionStorage.setItem('teslasync-api-playground-history', JSON.stringify(
      Array.from({ length: 20 }, (_, index) => mkEntry('GET', `/old/${index}`)),
    ))
    renderPage()
    fireEvent.click(await screen.findByText('/vehicles/{vehicleID}/example'))
    expect(screen.getByText('Example operation')).toBeInTheDocument()
    expect(screen.getByText('Distinct endpoint documentation')).toBeInTheDocument()
    expect(screen.queryByText('Secondary')).toBeNull()
    const vehicle = screen.getByLabelText(/vehicleID/)
    expect(vehicle).toHaveValue('4')
    expect(screen.getByLabelText('search')).toHaveValue('default query')
    const requestRegion = screen.getByRole('region', { name: 'Request' })
    const body = within(requestRegion).getAllByRole('textbox').find(field => field.tagName === 'TEXTAREA')
    expect(body).toHaveValue(JSON.stringify({ energy_wh: 1000, speed_mps: 0 }, null, 2))
    fireEvent.change(vehicle, { target: { value: '$&' } })
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'a & b' } })
    fireEvent.change(body!, { target: { value: '{"energy_wh":2500,"active":false}' } })
    fireEvent.change(screen.getByLabelText('X-API-Key'), { target: { value: ' test-only-key ' } })
    expect(screen.getByText('/api/v1/vehicles/$&/example?search=a%20%26%20b')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('alert')).toHaveTextContent(`This is a ${method} request.`)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send' }))
    await screen.findByText('409 Conflict')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/vehicles/$&/example?search=a%20%26%20b', {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-only-key' },
      body: '{"energy_wh":2500,"active":false}',
    })
    expect(screen.getByRole('region', { name: 'Response body' })).toHaveTextContent('"error": "example conflict"')
    const saved = JSON.parse(sessionStorage.getItem('teslasync-api-playground-history') ?? '[]') as HistoryEntry[]
    expect(saved).toHaveLength(20)
    expect(saved[0]).toEqual({
      method, path: '/vehicles/$&/example', status: 409,
      duration: expect.any(Number), timestamp: expect.any(String),
    })
    expect(saved[19].path).toBe('/old/18')
    expect(JSON.stringify(saved)).not.toContain('test-only-key')
    expect(JSON.stringify(saved)).not.toContain('energy_wh')
    expect(JSON.stringify(saved)).not.toContain('search=')
  })

  it('retains malformed response text, all exposed headers and four copyable snippet formats without secrets', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({
      status: 502, statusText: 'Bad Gateway', contentType: 'application/json', body: '{ malformed response',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const copy = vi.fn().mockResolvedValue(undefined)
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    try {
      renderPage()
      fireEvent.click(await screen.findByText('/vehicles'))
      fireEvent.change(screen.getByLabelText('X-API-Key'), { target: { value: 'test-only-key' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      await screen.findByText('502 Bad Gateway')
      expect(screen.getByRole('region', { name: 'Response body' }).textContent).toBe('{ malformed response')
      const headers = screen.getByRole('button', { name: /Response headers/ })
      fireEvent.click(headers)
      expect(headers).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('content-type:')).toBeInTheDocument()
      expect(screen.getByText('application/json')).toBeInTheDocument()
      fireEvent.click(headers)
      expect(headers).toHaveAttribute('aria-expanded', 'false')
      const snippetToggle = screen.getByRole('button', { name: 'Code snippet' })
      expect(snippetToggle).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(snippetToggle)
      expect(snippetToggle).toHaveAttribute('aria-expanded', 'true')
      for (const format of [
        { label: 'cURL', marker: 'curl -X GET' },
        { label: 'JavaScript', marker: 'const response = await fetch' },
        { label: 'Python', marker: 'response = requests.get' },
        { label: 'Go', marker: 'resp, err := http.Get' },
      ]) {
        const tab = screen.getByRole('button', { name: format.label })
        fireEvent.click(tab)
        expect(tab).toHaveAttribute('aria-pressed', 'true')
        const snippet = screen.getByLabelText('Generated code snippet').textContent
        expect(snippet).toContain(format.marker)
        expect(snippet).toContain('/api/v1/vehicles')
        expect(snippet).not.toContain('test-only-key')
        fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
        await waitFor(() => expect(copy).toHaveBeenLastCalledWith(snippet))
      }
      fireEvent.click(snippetToggle)
      expect(screen.queryByLabelText('Generated code snippet')).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('shows network rejection without recording a resolved HTTP request or losing independent specification counts', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('test-only connection failure')))
    renderPage()
    fireEvent.click(await screen.findByText('/vehicles'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    const failure = await screen.findByText('Network error')
    expect(failure).toHaveClass('text-red-400')
    expect(failure.closest('div')).toHaveClass('bg-red-500/10')
    expect(screen.getByText('— · —')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Response body' })).toHaveTextContent('test-only connection failure')
    expect(screen.getByRole('region', { name: 'Response' })).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    expect(sessionStorage.getItem('teslasync-api-playground-history')).toBeNull()
    expect(within(kpiRegion()).getByText('3')).toBeInTheDocument()
    expect(screen.getByTestId('api-playground-history-summary')).toHaveTextContent('0')
  })
})

describe('playground live-only raw transport boundary', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects historical %s before touching raw transport', async method => {
    window.history.replaceState({}, '', '/?as_of=2026-10-01T00:00:00Z')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(executeRequest('/vehicles/1/wake', method)).rejects.toMatchObject({
      code: 'OPERATIONAL_MODE_READ_ONLY', mode: 'as_of',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects offline %s before touching raw transport', async method => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(executeRequest('/vehicles/1/wake', method)).rejects.toMatchObject({
      code: 'OPERATIONAL_MODE_READ_ONLY', mode: 'cached',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])('preserves %s raw inspection in historical mode', async method => {
    window.history.replaceState({}, '', '/?as_of=2026-10-01T00:00:00Z')
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse({
      status: 403, statusText: 'Forbidden', body: '<raw denied>', contentType: 'text/html',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await executeRequest('/vehicles', method)
    expect(result).toMatchObject({ status: 403, bodyText: '<raw denied>', body: '<raw denied>' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps confirmation but reports a historical write refusal without a network-error label or history', async () => {
    window.history.replaceState({}, '', '/?as_of=2026-10-01T00:00:00Z')
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.click(await screen.findByText('/alerts'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This is a POST request.')
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send' }))
    await screen.findByText('Request failed')
    expect(screen.queryByText('Network error')).toBeNull()
    expect(screen.getByRole('region', { name: 'Response body' })).toHaveTextContent('Return to live mode first.')
    expect(screen.getByText('— · —')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('teslasync-api-playground-history')).toBeNull()
  })
})

describe('submitted request completion identity', () => {
  it.each(['resolve', 'reject'])('retires an old %s completion after endpoint selection without leaking its response or snippet', async outcome => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    let finish!: (response: Response) => void
    let fail!: (reason: Error) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve, reject) => {
      finish = resolve
      fail = reject
    }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.click(await screen.findByText('/vehicles'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByText('/alerts'))
    expect(screen.getByRole('region', { name: 'Response' })).toHaveAttribute('aria-busy', 'false')
    await act(async () => {
      if (outcome === 'resolve') finish(fakeResponse({ body: { old: 'retired' } }))
      else fail(new TypeError('retired failure'))
    })
    expect(screen.getByText('/api/v1/alerts')).toBeInTheDocument()
    expect(screen.getByText('Send a request to see the response')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Response body' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Code snippet' })).toBeNull()
    expect(sessionStorage.getItem('teslasync-api-playground-history')).toBeNull()
  })

  it('keeps a newer submission busy when an older generation finishes and binds only its own snippets', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    let finishOld!: (response: Response) => void
    let finishNew!: (response: Response) => void
    const fetchMock = vi.fn()
      .mockReturnValueOnce(new Promise<Response>(resolve => { finishOld = resolve }))
      .mockReturnValueOnce(new Promise<Response>(resolve => { finishNew = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.click(await screen.findByText('/vehicles'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByText('/vehicles/{vehicleID}/state'))
    fireEvent.change(screen.getByPlaceholderText('integer'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(async () => { finishOld(fakeResponse({ body: { old: true } })) })
    expect(screen.getByRole('region', { name: 'Response' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('integer'), { target: { value: '3' } })
    await act(async () => { finishNew(fakeResponse({ body: { current: true } })) })
    expect(screen.getByRole('region', { name: 'Response body' })).toHaveTextContent('"current": true')
    fireEvent.click(screen.getByRole('button', { name: 'Code snippet' }))
    expect(screen.getByLabelText('Generated code snippet')).toHaveTextContent('/api/v1/vehicles/2/state')
    expect(screen.getByLabelText('Generated code snippet')).not.toHaveTextContent('/vehicles/3/state')
    const saved = JSON.parse(sessionStorage.getItem('teslasync-api-playground-history') ?? '[]') as HistoryEntry[]
    expect(saved).toHaveLength(1)
    expect(saved[0].path).toBe('/vehicles/2/state')
  })

  it('retires pending transport when history replay selects another endpoint without auto-sending', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    sessionStorage.setItem('teslasync-api-playground-history', JSON.stringify([mkEntry('GET', '/vehicles/4/state')]))
    let finish!: (response: Response) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.click(await screen.findByText('/vehicles'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByTitle(/GET \/vehicles\/4\/state → 200/))
    await act(async () => { finish(fakeResponse({ body: { retired: true } })) })
    expect(screen.getByPlaceholderText('integer')).toBeInTheDocument()
    expect(screen.getByText('Send a request to see the response')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Code snippet' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retires a pending completion on unmount without persisting it', async () => {
    mockedRequest.mockResolvedValueOnce(SPEC_YAML)
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => { finish = resolve })))
    const view = renderPage()
    fireEvent.click(await screen.findByText('/vehicles'))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    view.unmount()
    await act(async () => { finish(fakeResponse()) })
    expect(sessionStorage.getItem('teslasync-api-playground-history')).toBeNull()
  })
})

describe('raw response metadata and Python snippet correctness', () => {
  const response: ApiResponse = {
    status: 204, statusText: 'No Content', headers: {}, body: '', bodyText: '',
    duration: 0, size: 0, contentType: 'text/plain',
  }

  it('distinguishes real HTTP zero metadata from missing or invalid measurements', () => {
    const view = render(<ResponseViewer response={response} loading={false} history={[]} onReplay={() => {}} />)
    expect(screen.getByText('204 No Content')).toHaveClass('text-green-400')
    expect(screen.getByText(/0(?:[.,]0+)?ms · 0 B/)).toBeInTheDocument()
    view.rerender(<ResponseViewer response={{ ...response, duration: NaN, size: -1 }} loading={false} history={[]} onReplay={() => {}} />)
    expect(screen.getByText('— · —')).toBeInTheDocument()
    view.rerender(<ResponseViewer response={{ ...response, duration: Infinity, size: Infinity }} loading={false} history={[]} onReplay={() => {}} />)
    expect(screen.getByText('— · —')).toBeInTheDocument()
  })

  it('does not style unknown status as HTTP success or invent unknown measurement zero', () => {
    render(<ResponseViewer response={{ ...response, status: NaN, statusText: '', duration: NaN, size: NaN }} loading={false} history={[]} onReplay={() => {}} />)
    expect(screen.getByText('—')).not.toHaveClass('text-green-400')
    expect(screen.getByText('— · —')).toBeInTheDocument()
  })

  it.each([
    '{"enabled":true,"disabled":false,"optional":null,"n":0}',
    '{"text":"apostrophe\'s, \\"quote\\", \\\\slash, \\nnewline","nested":[true,null]}',
    'null', 'false', '0', '"plain JSON string"',
  ])('round-trips the original JSON body into a Python json.loads argument: %s', body => {
    render(<SnippetPanel method="POST" url="/api/v1/alerts" body={body} />)
    fireEvent.click(screen.getByRole('button', { name: 'Code snippet' }))
    expect(screen.getByRole('button', { name: 'cURL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JavaScript' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Python' }))
    const snippet = screen.getByLabelText('Generated code snippet').textContent ?? ''
    expect(snippet).toContain('import json')
    expect(snippet).toContain(`json=json.loads(${JSON.stringify(body)})`)
    const encoded = snippet.match(/json=json\.loads\((.*)\)\)/)?.[1]
    expect(encoded).toBeDefined()
    expect(JSON.parse(encoded!)).toBe(body)
    expect(JSON.parse(JSON.parse(encoded!))).toEqual(JSON.parse(body))
  })
})
