// Co-located unit + wiring test for AIYearReviewNarration.
//
// AIYearReviewNarration exports a single symbol: the
// `withAiFeature('yir-narration', InnerSection)` gated component.
// This suite covers every facet of its observable behaviour:
//
//   1. Render gate (ADR-015): the surface is absent when ai_mode='off'
//      OR the per-feature toggle is off, and present (with the
//      registered `ai-feature-yir-narration-root` test id) only when
//      both are on. The positive control proves the negative
//      assertions are not trivially true.
//
//   2. canStart contract: the Generate button's disabled state is a
//      COMPUTED mirror of the backend's `vehicle_id > 0` validation
//      (internal/api/aiyir/handler.go rejects vehicle_id <= 0 with a
//      400). An unresolved vehicle (undefined) OR a placeholder
//      0/negative id keeps the button disabled and surfaces the
//      empty-state hint; a valid id enables it and hides the hint. The
//      vehicleId=0 case is the regression guard for the fix — the
//      previous `vehicleId != null` gate wrongly enabled the button
//      for id 0 (0 != null === true), guaranteeing a 400.
//
//   3. On-mode SSE wiring: clicking the button POSTs exactly once to
//      the registered route `/api/v1/ai/analytics/year-in-review/narrate`
//      with the `{ vehicle_id, year }` body (year defaults to the
//      previous calendar year) + SSE headers, renders the first delta,
//      coalesces a double-submit while streaming, and surfaces a
//      stream error on a non-2xx response.
//
// Network is stubbed at the `fetch` boundary (the same pattern used
// by the sibling wiring tests); no real request is ever made.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIYearReviewNarration } from '@/components/ai/AIYearReviewNarration'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test overrides flip ai_mode + ai_features to
// exercise the gate's off (negative) and on (positive) paths.
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

// enabled() returns the fully-on settings shape (mode + toggle) so
// the on-mode tests read one intent-revealing helper instead of
// repeating the two-field override.
function enabled(overrides: Partial<AppSettings> = {}) {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { 'yir-narration': true },
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

const ROOT_TESTID = 'ai-feature-yir-narration-root'
const BUTTON_NAME = /Generate narration/i
const EMPTY_HINT = /select a vehicle above/i
// The component narrates the previous calendar year; compute it
// dynamically so the assertion never rots at year boundaries.
const EXPECTED_YEAR = new Date().getFullYear() - 1

beforeEach(() => {
  mockUseSettings.mockReset()
  // Loud default so a test that forgets to install its own fetch
  // mock fails clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AIYearReviewNarration — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the yir-narration toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'yir-narration': true },
      }),
    )

    const { container } = render(<AIYearReviewNarration vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: BUTTON_NAME })).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'yir-narration': false },
      }),
    )

    const { container } = render(<AIYearReviewNarration vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIYearReviewNarration vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'yir-narration')
    // The Helix title heading + Generate button prove the InnerSection
    // body actually mounted (not just the gate wrapper).
    expect(
      screen.getByRole('heading', { name: /Helix narration/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeInTheDocument()
  })
})

describe('AIYearReviewNarration — canStart mirrors the backend vehicle_id > 0 contract', () => {
  it('disables the button and shows the empty-state hint when no vehicle is selected', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIYearReviewNarration />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it('disables the button when vehicleId is 0 — the invalid-id regression guard', () => {
    // The previous `vehicleId != null` gate wrongly enabled the
    // button for id 0 (0 != null === true), guaranteeing a 400 from
    // the handler's `vehicle_id > 0` check. The fixed gate keeps it
    // disabled.
    mockUseSettings.mockReturnValue(enabled())

    render(<AIYearReviewNarration vehicleId={0} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).toBeDisabled()
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it('disables the button for a negative vehicleId (defensive edge case)', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIYearReviewNarration vehicleId={-3} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).toBeDisabled()
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it('enables the button and omits the empty-state hint for a valid vehicleId', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIYearReviewNarration vehicleId={7} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    // The per-feature verb is preserved in the accessible name even
    // though the visible CTA is the universal "Ask Helix".
    expect(button.getAttribute('aria-label')).toContain('Generate narration')
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AIYearReviewNarration — on-mode SSE wiring', () => {
  it('POSTs once to /api/v1/ai/analytics/year-in-review/narrate with { vehicle_id, year } and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled())

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'You drove 12,400 km across 214 trips and saved $1,180 versus gas this year.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 55, out: 20 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIYearReviewNarration vehicleId={42} />)

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
    expect(url).toBe('/api/v1/ai/analytics/year-in-review/narrate')
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: 42,
      year: EXPECTED_YEAR,
    })

    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The accumulated delta text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'You drove 12,400 km across 214 trips and saved $1,180 versus gas this year.',
      )
    })
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

    render(<AIYearReviewNarration vehicleId={42} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the button is computed-disabled.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
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

    render(<AIYearReviewNarration vehicleId={42} />)

    const button = screen.getByRole('button', { name: BUTTON_NAME })
    await act(async () => {
      fireEvent.click(button)
    })

    // useAiStream maps a non-ok response to `stream_http_<status>` and
    // flips to state='error'; AiOutputPanel renders the Helix error
    // affordance (role=alert) rather than any narration text.
    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_404')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
