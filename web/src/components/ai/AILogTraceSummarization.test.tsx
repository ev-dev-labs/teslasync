// Co-located unit + wiring test for AILogTraceSummarization.
//
// The module has a single runtime export:
//
//   - `AILogTraceSummarization` — the
//     `withAiFeature('log-trace-summarization', InnerSection)` gated
//     card that lets an operator ask Helix for a factual summary of a
//     bounded log/trace window on the LiveLogsPage.
//
// This suite covers every observable facet so the file can be marked
// production-grade:
//
//   1. Render gate (ADR-015 §I5/§I6): the surface is entirely absent
//      when ai_mode='off', the per-feature toggle is off, the
//      ai_features map is missing, or settings have not resolved; and
//      present (with the registered `-root` test id) only when a
//      non-off mode AND the toggle are both on. The positive control
//      proves the negatives are not trivially true.
//
//   2. Surface structure + a11y: the enabled card renders the Helix
//      heading, the grounded description, the "Helix" badge, and a
//      single Summarize action whose accessible name + tooltip carry
//      the per-feature verb even though the visible label is the
//      universal "Ask Helix" CTA. The button's `disabled` is a
//      COMPUTED expression (never a literal), and when disabled for a
//      missing/invalid window an inline empty-state hint explains why
//      — the control is never silently dead.
//
//   3. Window validation: the button is disabled for every invalid
//      window (missing / reversed / equal / non-finite / non-positive
//      from_unix / > 24h) and enabled at the inclusive 24h boundary.
//      This mirrors the backend parser so the button never submits a
//      request the backend would reject.
//
//   4. On-mode SSE wiring: clicking Summarize POSTs exactly once to
//      the registered route /api/v1/ai/system/logs/summarize with the
//      in-scope window body + SSE headers, renders the delta text,
//      includes vehicle_id only when positive+finite, coalesces a
//      double-submit while streaming, shows the thinking indicator
//      before the first delta, and surfaces a stream error on a
//      non-2xx response.
//
// Network is stubbed at the `fetch` boundary — the same pattern the
// sibling wiring tests (TestLogTraceSummarizationAIOnWiredCallsRoute,
// AIGeofenceAwareAutomationSuggestions) use; no real request is ever
// made. @testing-library/user-event is intentionally NOT a dependency
// of this codebase, so interactions use fireEvent.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AILogTraceSummarization } from '@/components/ai/AILogTraceSummarization'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-log-trace-summarization-root'
const FEATURE_ID = 'log-trace-summarization'
const ROUTE = '/api/v1/ai/system/logs/summarize'
const SUMMARIZE_NAME = /Summarize/i

const FROM_UNIX = 1_700_000_000
const TO_UNIX = 1_700_001_800 // +30 minutes
const ONE_DAY_S = 24 * 60 * 60

// baseSettings is a complete-enough AppSettings with realistic non-AI
// defaults. Per-test overrides flip ai_mode + ai_features to exercise
// the gate.
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

// enabled() returns the fully-on settings shape (non-off mode + toggle)
// so the on-mode tests read one intent-revealing helper.
function enabled(overrides: Partial<AppSettings> = {}) {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { [FEATURE_ID]: true },
    ...overrides,
  })
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// arbitrarily-sized text chunks, matching the helper the useAiStream +
// sibling wiring tests use so the SSE parser receives byte-for-byte
// equivalent input.
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

// sseFrame formats a single SSE event the way internal/ai/stream/writer.go
// emits it.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// A never-closing stream response holds the hook at state='streaming'.
function pendingStreamResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {
        // Never enqueue, never close.
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

// stubStreamOnce installs a fetch mock that returns the given SSE body
// once and records the calls made against it.
function stubStreamOnce(sseBody: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(makeReadableStream([sseBody]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch
  return calls
}

async function clickSummarize() {
  const button = screen.getByRole('button', { name: SUMMARIZE_NAME })
  await act(async () => {
    fireEvent.click(button)
  })
  return button
}

beforeEach(() => {
  mockUseSettings.mockReset()
  // Loud default so a DOM test that forgets to install its own fetch
  // mock fails clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── 1. Render gate (ADR-015 AI-off contract) ──────────────────────────────
describe('AILogTraceSummarization — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )
    const { container } = render(
      <AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SUMMARIZE_NAME })).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )
    const { container } = render(
      <AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the ai_features map is entirely absent (fail-closed)', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: undefined }),
    )
    const { container } = render(
      <AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing while settings are still unresolved (settings undefined)', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })
    const { container } = render(
      <AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)
    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    expect(screen.getByRole('button', { name: SUMMARIZE_NAME })).toBeInTheDocument()
  })

  it('also renders under ai_mode=local (local mode is a non-off mode)', () => {
    mockUseSettings.mockReturnValue(enabled({ ai_mode: 'local' }))
    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)
    expect(screen.getByTestId(ROOT_TESTID)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SUMMARIZE_NAME })).toBeInTheDocument()
  })
})

// ── 2. Surface structure + a11y ───────────────────────────────────────────
describe('AILogTraceSummarization — surface structure + a11y', () => {
  it('renders the heading, grounded description, and the Helix badge', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)

    expect(
      screen.getByRole('heading', { name: /Helix log\/trace summary/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/never invents log lines and never speculates about root cause/i),
    ).toBeInTheDocument()
    // "Helix" brand badge sits in the header.
    expect(screen.getAllByText('Helix').length).toBeGreaterThan(0)
  })

  it('exposes a Summarize action whose visible label is the universal Helix CTA but whose accessible name + tooltip carry the verb', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)

    const button = screen.getByRole('button', { name: SUMMARIZE_NAME })
    // Visible label is the universal Helix CTA; the verb lives in the
    // accessible name + tooltip so pointer + screen-reader users still
    // get the contextual hint.
    expect(button).toHaveTextContent(/Ask Helix/i)
    expect(button).toHaveAttribute('title', expect.stringMatching(SUMMARIZE_NAME))
  })

  it('enables the Summarize button (aria-disabled=false) when the window is valid, with no empty hint shown', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)

    const button = screen.getByRole('button', { name: SUMMARIZE_NAME })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    // The empty-state hint is only for the disabled path.
    expect(screen.queryByText(/valid log window/i)).not.toBeInTheDocument()
  })

  it('surfaces an empty-state hint (never a silently dead control) when the window is missing', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AILogTraceSummarization />)

    const button = screen.getByRole('button', { name: SUMMARIZE_NAME })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The wired-in i18n hint explains WHY the button is disabled.
    expect(screen.getByText(/valid log window/i)).toBeInTheDocument()
  })

  it('shows no output panel and no thinking indicator before any summarization has run', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument()
  })
})

// ── 3. Window validation (computed-disabled) ──────────────────────────────
describe('AILogTraceSummarization — window validation', () => {
  const invalidWindows: Array<[string, number | undefined, number | undefined]> = [
    ['a missing window (both undefined)', undefined, undefined],
    ['a missing to_unix', FROM_UNIX, undefined],
    ['a missing from_unix', undefined, TO_UNIX],
    ['a reversed window (to < from)', TO_UNIX, FROM_UNIX],
    ['an equal window (to == from)', FROM_UNIX, FROM_UNIX],
    ['a zero from_unix', 0, TO_UNIX],
    ['a negative from_unix', -1, TO_UNIX],
    ['a window one second over the 24h cap', FROM_UNIX, FROM_UNIX + ONE_DAY_S + 1],
    ['a window far over the 24h cap (25h)', FROM_UNIX, FROM_UNIX + 25 * 60 * 60],
    ['a non-finite from_unix (Infinity)', Number.POSITIVE_INFINITY, TO_UNIX],
    ['a non-finite to_unix (NaN)', FROM_UNIX, Number.NaN],
  ]

  for (const [label, fromUnix, toUnix] of invalidWindows) {
    it(`keeps the Summarize button computed-disabled for ${label}`, () => {
      mockUseSettings.mockReturnValue(enabled())
      render(<AILogTraceSummarization fromUnix={fromUnix} toUnix={toUnix} />)
      const button = screen.getByRole('button', { name: SUMMARIZE_NAME })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-disabled', 'true')
    })
  }

  it('enables the button at the inclusive 24h boundary (windowSeconds === 24h)', () => {
    mockUseSettings.mockReturnValue(enabled())
    render(
      <AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={FROM_UNIX + ONE_DAY_S} />,
    )
    expect(screen.getByRole('button', { name: SUMMARIZE_NAME })).not.toBeDisabled()
  })

  it('reactively enables then re-disables as the window prop transitions valid → invalid', () => {
    mockUseSettings.mockReturnValue(enabled())
    const { rerender } = render(
      <AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    )
    expect(screen.getByRole('button', { name: SUMMARIZE_NAME })).not.toBeDisabled()

    // Widen past the 24h cap — the computed control must re-disable.
    rerender(
      <AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={FROM_UNIX + 25 * 60 * 60} />,
    )
    expect(screen.getByRole('button', { name: SUMMARIZE_NAME })).toBeDisabled()
    expect(screen.getByText(/valid log window/i)).toBeInTheDocument()
  })
})

// ── 4. On-mode SSE wiring ─────────────────────────────────────────────────
describe('AILogTraceSummarization — on-mode SSE wiring', () => {
  it('POSTs once to the registered route with the in-scope window body + SSE headers and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const sseBody =
      sseFrame('delta', {
        text: 'The 30-minute window held 142 log events (98 info, 41 warn, 3 error) and 27 trace spans.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 220, out: 90 } })
    const calls = stubStreamOnce(sseBody)

    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)
    const root = screen.getByTestId(ROOT_TESTID)
    await clickSummarize()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(ROUTE)
    expect(init?.method).toBe('POST')
    // The body MUST carry exactly the in-scope window so the LLM cannot
    // widen it — no vehicle_id when the parent did not narrow scope.
    expect(JSON.parse(init?.body as string)).toEqual({
      from_unix: FROM_UNIX,
      to_unix: TO_UNIX,
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() =>
      expect(root).toHaveTextContent(/142 log events \(98 info, 41 warn, 3 error\)/),
    )
  })

  it('includes vehicle_id in the body when the parent narrows scope to one positive vehicle', async () => {
    mockUseSettings.mockReturnValue(enabled())
    const calls = stubStreamOnce(sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }))

    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} vehicleId={42} />)
    await clickSummarize()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      from_unix: FROM_UNIX,
      to_unix: TO_UNIX,
      vehicle_id: 42,
    })
  })

  it('omits vehicle_id when it is zero (all-vehicles), negative, or non-finite', async () => {
    mockUseSettings.mockReturnValue(enabled())

    for (const vehicleId of [0, -3, Number.POSITIVE_INFINITY]) {
      const calls = stubStreamOnce(sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }))
      const { unmount } = render(
        <AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} vehicleId={vehicleId} />,
      )
      await clickSummarize()
      await waitFor(() => expect(calls).toHaveLength(1))
      const parsed = JSON.parse(calls[0].init?.body as string)
      expect(parsed).toEqual({ from_unix: FROM_UNIX, to_unix: TO_UNIX })
      expect(parsed).not.toHaveProperty('vehicle_id')
      unmount()
    }
  })

  it('shows the thinking indicator while streaming before the first delta arrives', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = vi.fn(async () => pendingStreamResponse()) as unknown as typeof globalThis.fetch

    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)
    await clickSummarize()

    await waitFor(() =>
      expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument(),
    )
    // The output panel is open (streaming) but holds no prose yet.
    expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument()
  })

  it('coalesces a double-submit while streaming (button disabled + a second click is a no-op)', async () => {
    mockUseSettings.mockReturnValue(enabled())
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      return pendingStreamResponse()
    }) as unknown as typeof globalThis.fetch

    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)
    const button = await clickSummarize()
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming, `disabled` is computed from `!canStart || streaming`.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces a stream error in the output panel on a non-2xx response', async () => {
    mockUseSettings.mockReturnValue(enabled())
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof globalThis.fetch

    render(<AILogTraceSummarization fromUnix={FROM_UNIX} toUnix={TO_UNIX} />)
    await clickSummarize()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent(/stream_http_500/)
    })
  })
})
