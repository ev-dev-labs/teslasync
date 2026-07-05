// Co-located unit + wiring test for AIChargingCurveFingerprintClustering.
//
// The module exports a single symbol: the
// `withAiFeature('charging-curve-fingerprint-clustering', InnerSection)`
// gated component. This suite covers every observable facet of its
// behaviour so the file can be marked production-grade:
//
//   1. Render gate (ADR-015 §I5/§I6): the surface is entirely absent
//      when ai_mode='off' OR the per-feature toggle is off, and present
//      (with the registered
//      `ai-feature-charging-curve-fingerprint-clustering-root` test id)
//      only when both are on. The positive control proves the two
//      negative assertions are not trivially true (a typo in the
//      registry/HOC that hid the section forever would still pass the
//      negatives).
//
//   2. canStart contract: the Explain button's disabled state is a
//      COMPUTED mirror of the backend's `vehicle_id > 0` validation
//      (internal/api/aichargcurve/handler.go). Unlike its sibling
//      AIAnomalyExplanations, this component accepts `string | number`
//      because ChargingCurvePage may pass the active-vehicle id as a
//      route-param string. The coercion branch is covered explicitly:
//        - undefined            → disabled + empty hint
//        - 0 (number)           → disabled (regression guard for `> 0`)
//        - '0' (string)         → disabled (coerced to 0)
//        - 'not-a-number'       → disabled (coerced to NaN)
//        - 7 (number)           → enabled, no hint
//        - '42' (string)        → enabled, no hint (coercion path)
//
//   3. On-mode SSE wiring: clicking Explain POSTs exactly once to the
//      registered route /api/v1/ai/charging/curves/clusters/explain
//      with the `{ vehicle_id }` body + SSE headers, renders the first
//      delta, coerces a string id to a NUMBER in the body (so the Go
//      parser receives the int64 it expects), coalesces a double-submit
//      while streaming, and surfaces a stream error on a non-2xx
//      response.
//
// Network is stubbed at the `fetch` boundary — the same pattern the
// sibling wiring tests use; no real request is ever made.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so interactions use fireEvent.click.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIChargingCurveFingerprintClustering } from '@/components/ai/AIChargingCurveFingerprintClustering'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test overrides flip ai_mode + ai_features to exercise
// the gate's off (negative) and on (positive) paths.
const baseSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
}

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } }
}

// enabled() returns the fully-on settings shape (mode + toggle) so the
// on-mode tests read one intent-revealing helper instead of repeating
// the two-field override.
function enabled(overrides: Partial<AppSettings> = {}) {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { 'charging-curve-fingerprint-clustering': true },
    ...overrides,
  })
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// arbitrarily-sized text chunks, matching the helper used by the
// useAiStream + sibling wiring tests so the SSE parser receives
// byte-for-byte equivalent input.
function makeReadableStream(chunks: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]))
        i++
      } else {
        controller.close()
      }
    },
  })
}

// sseFrame formats a single SSE event the way
// internal/ai/stream/writer.go emits it.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const ROOT_TESTID = 'ai-feature-charging-curve-fingerprint-clustering-root'
const FEATURE_ID = 'charging-curve-fingerprint-clustering'
const ROUTE = '/api/v1/ai/charging/curves/clusters/explain'
const BUTTON_NAME = /Explain clusters/i
const TITLE = /Explain the charging-curve cluster fingerprints/i
const EMPTY_HINT = /Select a vehicle to explain its charging-curve clusters/i

beforeEach(() => {
  mockUseSettings.mockReset()
  // Loud default so a test that forgets to install its own fetch mock
  // fails clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AIChargingCurveFingerprintClustering — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'charging-curve-fingerprint-clustering': true },
      }),
    )

    const { container } = render(
      <AIChargingCurveFingerprintClustering vehicleId={42} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: BUTTON_NAME }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'charging-curve-fingerprint-clustering': false },
      }),
    )

    const { container } = render(
      <AIChargingCurveFingerprintClustering vehicleId={42} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIChargingCurveFingerprintClustering vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // The title heading + Explain button prove the InnerSection body
    // actually mounted (not just the gate wrapper).
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument()
  })
})

describe('AIChargingCurveFingerprintClustering — canStart mirrors vehicle_id > 0 across string|number', () => {
  it('disables the button and shows the empty-state hint when no vehicle is selected', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIChargingCurveFingerprintClustering />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it('disables the button when vehicleId is 0 — the invalid-id regression guard', () => {
    // A `vehicleId != null` gate would wrongly enable the button for id
    // 0 (0 != null === true), guaranteeing a 400 from the handler's
    // `vehicle_id > 0` check. The `> 0` gate keeps it disabled.
    mockUseSettings.mockReturnValue(enabled())

    render(<AIChargingCurveFingerprintClustering vehicleId={0} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).toBeDisabled()
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it('disables the button when vehicleId is the string "0" (coerced to 0)', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIChargingCurveFingerprintClustering vehicleId="0" />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).toBeDisabled()
  })

  it('disables the button when vehicleId is a non-numeric string (coerced to NaN)', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIChargingCurveFingerprintClustering vehicleId="not-a-number" />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).toBeDisabled()
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it('enables the button and omits the empty-state hint for a valid numeric vehicleId', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIChargingCurveFingerprintClustering vehicleId={7} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })

  it('enables the button for a valid numeric-STRING vehicleId (the coercion path)', () => {
    // ChargingCurvePage sources the active-vehicle id from a route
    // param, which arrives as a string. `Number('42') > 0` must enable
    // the button exactly as the numeric branch does.
    mockUseSettings.mockReturnValue(enabled())

    render(<AIChargingCurveFingerprintClustering vehicleId="42" />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).not.toBeDisabled()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AIChargingCurveFingerprintClustering — on-mode SSE wiring', () => {
  it('POSTs once to the registered route with { vehicle_id } + SSE headers and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'Vehicle Roadie shows a dominant L2 home cluster with steady 7 kW peaks.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIChargingCurveFingerprintClustering vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    // Exactly one POST against the registered backend route. The hook
    // prepends `${getApiBase()}/api/v1`; getApiBase() is '' in tests,
    // so the final URL is the bare route.
    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(init?.body as string)).toEqual({ vehicle_id: 42 })

    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The accumulated delta text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Vehicle Roadie shows a dominant L2 home cluster with steady 7 kW peaks.',
      )
    })
  })

  it('coerces a numeric-string vehicleId to a NUMBER in the POST body', async () => {
    // The Go handler parses vehicle_id as int64; a JSON string would be
    // rejected. This proves the `Number(...)` coercion feeds the wire
    // an int, not the raw route-param string.
    mockUseSettings.mockReturnValue(enabled())

    const bodies: Array<string> = []
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(init?.body as string)
      return new Response(
        makeReadableStream([sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } })]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIChargingCurveFingerprintClustering vehicleId="42" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }))
    })

    await waitFor(() => expect(bodies).toHaveLength(1))
    const parsed = JSON.parse(bodies[0]) as { vehicle_id: unknown }
    expect(parsed).toEqual({ vehicle_id: 42 })
    expect(typeof parsed.vehicle_id).toBe('number')
  })

  it('coalesces a second click while streaming into a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(enabled())

    // A stream that never closes keeps state === 'streaming' for the
    // whole test, so the button stays disabled and the hook's
    // runningRef refuses a second start().
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIChargingCurveFingerprintClustering vehicleId={42} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the button is computed-disabled.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      // fireEvent bypasses the disabled attribute, exercising the
      // hook's runningRef coalescer directly (defence in depth).
      fireEvent.click(button)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces the stream error when the backend returns a non-2xx status', async () => {
    mockUseSettings.mockReturnValue(enabled())

    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof globalThis.fetch

    render(<AIChargingCurveFingerprintClustering vehicleId={42} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    await act(async () => {
      fireEvent.click(button)
    })

    // useAiStream maps a non-ok response to `stream_http_<status>` and
    // flips to state='error'; AiOutputPanel renders the Helix error
    // affordance rather than any narration text.
    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_404')
  })
})
