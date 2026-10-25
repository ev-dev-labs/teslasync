import { appSettingsPayload } from '@/test/fixtures/appSettings'
import { makeReadableStream, sseFrame } from '@/test/fixtures/aiPayloads'
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





vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIYearReviewNarration } from '@/components/ai/AIYearReviewNarration'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test overrides flip ai_mode + ai_features to
// exercise the gate's off (negative) and on (positive) paths.
// enabled() returns the fully-on settings shape (mode + toggle) so
// the on-mode tests read one intent-revealing helper instead of
// repeating the two-field override.
function enabled(overrides: Partial<AppSettings> = {}) {
  return appSettingsPayload({
    ai_mode: 'cloud',
    ai_features: { 'yir-narration': true },
    ...overrides,
  })
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// arbitrarily-sized text chunks, matching the helper used by the
// useAiStream + sibling wiring tests so the SSE parser receives
// byte-for-byte equivalent input.
// sseFrame formats a single SSE event the way
// internal/ai/stream/writer.go emits it.
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
  vi.useRealTimers()
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

describe('AIYearReviewNarration — independent previous-calendar-year scope', () => {
  it.each([
    ['saved locale/timezone and a different route year', new Date(2026, 9, 14, 12), '?year=2021&from=2021-01-01&to=2022-01-01', 2025],
    ['last instant of the calendar year', new Date(2026, 11, 31, 23, 59, 59, 999), '?year=2021', 2025],
    ['first instant of the calendar year', new Date(2027, 0, 1, 0, 0, 0, 0), '?year=2021', 2026],
    ['before midnight on an ordinary day', new Date(2026, 5, 14, 23, 59, 59, 999), '?from=2026-06-14&to=2026-06-15', 2025],
    ['after midnight on an ordinary day', new Date(2026, 5, 15, 0, 0, 0, 0), '?from=2026-06-14&to=2026-06-15', 2025],
    ['invalid route dates', new Date(2026, 9, 14, 12), '?year=invalid&from=invalid&to=invalid', 2025],
    ['missing route dates', new Date(2026, 9, 14, 12), '', 2025],
  ])('preserves the request default with %s', async (_name, now, query, year) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    mockUseSettings.mockReturnValue(enabled({
      locale: 'de-DE',
      timezone_user: 'Pacific/Kiritimati',
      tz_display_default: 'user',
    }))
    window.history.replaceState({}, '', `/analytics/year-in-review${query}`)
    const fetchMock = vi.fn(async () => new Response(
      makeReadableStream([sseFrame('done', { finish_reason: 'stop' })]),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    globalThis.fetch = fetchMock

    render(<AIYearReviewNarration vehicleId={42} />)

    expect(screen.getByText(
      `Get a short, Helix-written recap of the previous calendar year (${year}), independently of the year selected above.`,
    )).toBeInTheDocument()
    expect(screen.queryByText(/from the slide data above/i)).not.toBeInTheDocument()
    expect(screen.getByText(`${year} Year in review`)).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({ vehicle_id: 42, year })
  })

  it('aborts an in-flight narration when the vehicle changes or is deselected', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const signals: AbortSignal[] = []
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (!signal) throw new Error('Expected an abort signal')
      signals.push(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    })
    const { rerender } = render(<AIYearReviewNarration vehicleId={42} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }))
    })
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)

    rerender(<AIYearReviewNarration vehicleId={7} />)
    await waitFor(() => expect(signals[0].aborted).toBe(true))
    expect(screen.getByRole('button', { name: BUTTON_NAME })).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }))
    })
    expect(signals).toHaveLength(2)
    expect(signals[1].aborted).toBe(false)

    rerender(<AIYearReviewNarration />)
    await waitFor(() => expect(signals[1].aborted).toBe(true))
    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('AIYearReviewNarration — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the yir-narration toggle on', () => {
    mockUseSettings.mockReturnValue(
      appSettingsPayload({
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
      appSettingsPayload({
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
    expect(screen.getByText(`${EXPECTED_YEAR} Year in review`)).toBeInTheDocument()
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
  it('retains completed output within its vehicle scope and clears it when that scope changes', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const narration = 'A long vehicle-specific recap. '.repeat(100)
    const fetchMock = vi.fn(async () => new Response(
      makeReadableStream([
        sseFrame('delta', { text: narration }),
        sseFrame('done', { finish_reason: 'stop', usage: { in: 55, out: 20 } }),
      ]),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    globalThis.fetch = fetchMock
    const { rerender } = render(<AIYearReviewNarration vehicleId={42} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }))
    })
    await waitFor(() => {
      expect(screen.getByTestId(ROOT_TESTID)).toHaveTextContent(narration.trim())
      expect(screen.getByRole('button', { name: BUTTON_NAME })).not.toBeDisabled()
    })

    rerender(<AIYearReviewNarration vehicleId={42} />)
    expect(screen.getByTestId(ROOT_TESTID)).toHaveTextContent(narration.trim())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender(<AIYearReviewNarration vehicleId={7} />)
    expect(screen.getByTestId(ROOT_TESTID)).not.toHaveTextContent(narration.trim())
    expect(screen.getByText(`${EXPECTED_YEAR} Year in review`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: BUTTON_NAME })).not.toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender(<AIYearReviewNarration />)
    expect(screen.getByRole('button', { name: BUTTON_NAME })).toBeDisabled()
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

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
