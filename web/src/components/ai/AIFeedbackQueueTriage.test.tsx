// Comprehensive unit + behaviour coverage for AIFeedbackQueueTriage —
// the co-located Project Apex elevation test.
//
// The component has a single runtime export: `AIFeedbackQueueTriage`
// (an InnerSection wrapped with withAiFeature). It is a propose-only,
// read-only advisor surface — no reducer, no captured typed proposal,
// and no Apply hand-off (the deterministic manual triage controls on
// FeedbackQueuePage stay the sole write path). So the facets worth
// exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, an absent per-feature key, and the positive control that
//     proves the gate is real);
//   - the input gate: the "Suggest triage" button's `disabled` is a
//     COMPUTED expression derived from
//     `haveFeedback = isFinite(id) && id > 0`, never a literal
//     `disabled`. This is proved across a matrix of absent / zero /
//     negative / NaN ids, plus the empty-state hint that explains the
//     disabled control (a bare unexplained button is a violation);
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/feedback/triage/draft` route with the correct method
//     / headers and the snake_case `{ feedback_id }` body — the LLM's
//     scope can never be widened past the in-scope row);
//   - the streaming lifecycle (thinking indicator + disabled button
//     while in flight, double-submit guard, HTTP-error + error-frame
//     fallbacks rendered in AiOutputPanel); and
//   - the stable public surface (displayName).
//
// Network is mocked with a hand-rolled ReadableStream emitting the SSE
// frames internal/ai/stream/writer.go produces — the same convention
// the sibling AI feature tests use. No real network is touched.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so interactions use fireEvent.click,
// consistent with every other AI feature test. react-i18next returns
// the English fallback (2nd arg) with no provider mounted, so
// assertions read the defaults.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIFeedbackQueueTriage } from '@/components/ai/AIFeedbackQueueTriage'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-feedback-queue-triage-root'
const DRAFT_ROUTE = '/api/v1/ai/feedback/triage/draft'
const EMPTY_HINT = 'Select a feedback row to suggest triage labels.'

// A complete AppSettings with realistic non-AI defaults. Per-test
// cases override `ai_mode` + `ai_features` to flip the gate.
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

// enableFeature flips the gate fully on: ai_mode != off AND the
// per-feature toggle true. Most on-mode tests below start here.
function enableFeature() {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'feedback-queue-triage': true },
    }),
  )
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from text
// chunks — byte-for-byte the input useAiStream's parser consumes.
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

// sseFrame formats one SSE event exactly as the backend writer emits it.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// installStreamingFetch wires globalThis.fetch to reply once with the
// given SSE body and records every call for URL/body assertions.
function installStreamingFetch(
  sseBody: string,
  status = 200,
): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  ) as unknown as typeof globalThis.fetch
  return calls
}

// installNeverClosingFetch keeps every stream open (never enqueues,
// never closes) so the component stays in `state='streaming'` and
// counts how many times fetch was invoked.
function installNeverClosingFetch(): { count: () => number } {
  let fetchCount = 0
  globalThis.fetch = vi.fn(async () => {
    fetchCount += 1
    return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch
  return { count: () => fetchCount }
}

function suggestButton(): HTMLElement {
  return screen.getByRole('button', { name: /Suggest triage/i })
}

async function clickSuggest(): Promise<HTMLElement> {
  const btn = suggestButton()
  await act(async () => {
    fireEvent.click(btn)
  })
  return btn
}

beforeEach(() => {
  mockUseSettings.mockReset()
  // Loud default: a test that forgets to install its own fetch fails
  // clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AIFeedbackQueueTriage — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'feedback-queue-triage': true },
      }),
    )

    const { container } = render(<AIFeedbackQueueTriage feedbackId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Suggest triage/i }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'feedback-queue-triage': false },
      }),
    )

    const { container } = render(<AIFeedbackQueueTriage feedbackId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the feature key is absent from ai_features', () => {
    // Fail-closed: an on mode with an unrelated toggle set, but no
    // `feedback-queue-triage` key, must still resolve to disabled.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'local',
        ai_features: { 'alert-tuning-suggestions': true },
      }),
    )

    const { container } = render(<AIFeedbackQueueTriage feedbackId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge and an enabled button when both mode and toggle are on', () => {
    enableFeature()

    render(<AIFeedbackQueueTriage feedbackId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'feedback-queue-triage')

    // The deterministic title + badge + description copy renders.
    expect(screen.getByText('Helix triage advisor')).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()
    // A distinctive phrase from the privacy-contract description proves
    // the description branch rendered (not just the header).
    expect(screen.getByText(/redacted envelope/i)).toBeInTheDocument()

    // The Suggest button is enabled (a row IS in scope, idle stream)
    // and exposes the per-feature verb through its accessible name.
    const button = suggestButton()
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(ariaLabel).toContain('Suggest triage')

    // Idle: no output panel yet, and no empty hint (a row IS in scope)
    // — proves both conditional branches.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AIFeedbackQueueTriage — input gate (computed disabled + empty state)', () => {
  it('disables the Suggest button and shows the empty-state hint when no feedbackId is available', () => {
    enableFeature()

    render(<AIFeedbackQueueTriage />)

    const button = suggestButton()
    expect(button).toBeDisabled()
    // The disabled attribute is mirrored by aria-disabled (computed,
    // screen-reader-visible disabled state — never a literal disabled).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The empty hint explains WHY the button is disabled instead of
    // leaving a bare, unexplained control.
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
  ])(
    'keeps the Suggest button disabled for an invalid feedbackId (%s)',
    (_label, id) => {
      enableFeature()

      render(<AIFeedbackQueueTriage feedbackId={id} />)

      expect(suggestButton()).toBeDisabled()
      expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
    },
  )

  it('does not open a stream when the (disabled) button is clicked without a feedback row', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AIFeedbackQueueTriage />)

    await act(async () => {
      fireEvent.click(suggestButton())
    })
    // Give any rogue fetch a macrotask to land.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(0)
    // The 0-sentinel body must never leak onto the wire.
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it('enables the Suggest button once a valid feedbackId resolves via rerender', () => {
    enableFeature()

    const { rerender } = render(<AIFeedbackQueueTriage />)
    expect(suggestButton()).toBeDisabled()
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()

    rerender(<AIFeedbackQueueTriage feedbackId={7} />)
    expect(suggestButton()).toBeEnabled()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AIFeedbackQueueTriage — SSE wiring + streaming lifecycle', () => {
  it('POSTs exactly once to the registered route with the in-scope feedback_id and renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', {
        text:
          'Proposed status: acknowledged; category: bug; priority: high. This mirrors the redacted envelope only.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    const calls = installStreamingFetch(sseBody)

    render(<AIFeedbackQueueTriage feedbackId={42} />)

    await clickSuggest()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(DRAFT_ROUTE)
    expect(init?.method).toBe('POST')
    // snake_case body key, in-scope row id, and nothing else.
    expect(JSON.parse(init?.body as string)).toEqual({ feedback_id: 42 })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed proposal renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(/Proposed status: acknowledged/)
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /priority: high/,
    )
  })

  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(<AIFeedbackQueueTriage feedbackId={42} />)
    const button = await clickSuggest()

    await waitFor(() => expect(button).toBeDisabled())
    const indicator = screen.getByTestId('ai-thinking-indicator')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('role', 'status')
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AIFeedbackQueueTriage feedbackId={42} />)
    const button = await clickSuggest()

    await waitFor(() => expect(tracker.count()).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(1)
  })

  it('surfaces an HTTP error in the output panel when the stream route returns non-2xx', async () => {
    enableFeature()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AIFeedbackQueueTriage feedbackId={42} />)
    await clickSuggest()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })

  it('surfaces a terminal SSE error frame in the output panel', async () => {
    enableFeature()
    installStreamingFetch(sseFrame('error', { message: 'provider_unavailable' }))

    render(<AIFeedbackQueueTriage feedbackId={42} />)
    await clickSuggest()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AIFeedbackQueueTriage — public surface', () => {
  it('exposes a stable displayName for the gated component', () => {
    expect(AIFeedbackQueueTriage.displayName).toBe('AIFeedbackQueueTriage')
  })
})
