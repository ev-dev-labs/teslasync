// Comprehensive unit + behaviour coverage for
// AIWatchFaceNLResponse — the co-located Project Apex elevation test.
//
// The module has a single runtime export: `AIWatchFaceNLResponse`
// (an InnerSection wrapped with withAiFeature). Unlike the empty-body
// narrator surfaces (AISafetySettingExplainer), this one owns a
// free-text <Textarea>: the user types a glance-style question (or
// leaves it empty for a default summary) and the Ask button POSTs the
// message to /api/v1/ai/watch/respond, streaming a NARRATIVE reply
// into the shared AiOutputPanel. So the facets worth exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, unresolved settings, and the positive control that proves
//     the gate is real — title / badge / description / textarea /
//     enabled button all present);
//   - the message body shaping contract: a typed question serializes
//     as `{ message: '<trimmed>' }`, an empty OR whitespace-only
//     textarea serializes as `{}` (the deterministic "give a glance
//     summary" default-prompt path), and surrounding whitespace is
//     trimmed off before it hits the wire;
//   - the SSE wiring contract (exactly one POST to the registered
//     route with method=POST, Accept: text/event-stream,
//     Content-Type: application/json) and the MaxMessageChars cap
//     mirrored onto the textarea's maxLength so a parser-rejection 400
//     never reaches the user;
//   - the streaming lifecycle (thinking indicator + computed-disabled
//     button while in flight, double-submit guard, re-run after a
//     completed stream clears the previous narration, HTTP-error +
//     terminal error-frame fallbacks rendered in AiOutputPanel);
//   - the computed `canStart` branches — the button is disabled when
//     the trimmed message exceeds MaxMessageChars (over-cap) and when
//     the stream pauses at `paused-confirm`, and re-enabled once the
//     over-cap text is cleared; disablement is a COMPUTED expression,
//     never a literal `disabled`;
//   - the NARRATIVE render contract: even when a stray `tool_result`
//     frame arrives, no proposal preview and no "Apply" affordance
//     ever leaks into the DOM (the onEvent handler is a deliberate
//     no-op — this surface narrates, it never proposes a change);
//   - lifecycle hygiene (cancel-on-unmount aborts the in-flight fetch)
//     plus the stable public surface (displayName).
//
// Network is mocked with a hand-rolled ReadableStream emitting the SSE
// frames internal/ai/stream/writer.go produces — the same convention
// the sibling feature tests use. No real network is touched.
// @testing-library/user-event is intentionally NOT a dependency of
// this codebase (see web/package.json), so interactions use
// fireEvent, consistent with every other AI feature test.
// react-i18next returns the English fallback (2nd arg) with no
// provider mounted, so assertions read the defaults.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIWatchFaceNLResponse } from '@/components/ai/AIWatchFaceNLResponse'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-watch-face-nl-response-root'
const RESPOND_ROUTE = '/api/v1/ai/watch/respond'
const TITLE = 'Ask Helix about your watch face'
const INPUT_LABEL = /Your question for Helix/i
const BUTTON_NAME = /Ask about my car/i
// MaxMessageChars mirrors the component constant (kept in lockstep with
// the Go handler's aiWatchFaceNLResponseMaxMessageLen). The cap test
// deliberately reads it here so a future change to the source constant
// that forgets to update the textarea maxLength shows up as a failure.
const MAX_MESSAGE_CHARS = 1000

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
// per-feature toggle true. Every on-mode test below starts here.
function enableFeature() {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'watch-face-nl-response': true },
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

interface FetchCall {
  url: string
  init?: RequestInit
}

// installStreamingFetch wires globalThis.fetch to reply once with the
// given SSE body and records every call for URL/body assertions.
function installStreamingFetch(sseBody: string, status = 200): FetchCall[] {
  const calls: FetchCall[] = []
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

// installSequentialFetch returns a different SSE body per invocation
// (clamping to the last one) so a re-run can be distinguished from the
// first run by its rendered text.
function installSequentialFetch(bodies: string[]): FetchCall[] {
  const calls: FetchCall[] = []
  let i = 0
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      const body = bodies[Math.min(i, bodies.length - 1)]
      i++
      return new Response(makeReadableStream([body]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  ) as unknown as typeof globalThis.fetch
  return calls
}

// installNeverClosingFetch keeps every stream open (never enqueues,
// never closes) so the component stays in `state='streaming'`. It
// records the AbortSignal of each call and counts invocations.
function installNeverClosingFetch(): {
  count: () => number
  signal: () => AbortSignal | null | undefined
} {
  let fetchCount = 0
  let lastSignal: AbortSignal | null | undefined = null
  globalThis.fetch = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCount += 1
      lastSignal = init?.signal
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  ) as unknown as typeof globalThis.fetch
  return { count: () => fetchCount, signal: () => lastSignal }
}

function askButton(): HTMLElement {
  return screen.getByRole('button', { name: BUTTON_NAME })
}

function questionInput(): HTMLTextAreaElement {
  return screen.getByLabelText(INPUT_LABEL) as HTMLTextAreaElement
}

async function typeQuestion(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(questionInput(), { target: { value } })
  })
}

async function clickAsk(): Promise<HTMLElement> {
  const btn = askButton()
  await act(async () => {
    fireEvent.click(btn)
  })
  return btn
}

// parseBody reads back the JSON string the component POSTed.
function parseBody(init: RequestInit | undefined): unknown {
  return JSON.parse(init?.body as string)
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

describe('AIWatchFaceNLResponse — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'watch-face-nl-response': true },
      }),
    )

    const { container } = render(<AIWatchFaceNLResponse />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: BUTTON_NAME })).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'watch-face-nl-response': false },
      }),
    )

    const { container } = render(<AIWatchFaceNLResponse />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the settings query has not resolved yet', () => {
    // useAiEnabled fails closed on an undefined settings object.
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AIWatchFaceNLResponse />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge, description, an empty enabled button and the question textarea', () => {
    enableFeature()

    render(<AIWatchFaceNLResponse />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'watch-face-nl-response')

    // The deterministic title + Helix badge + description copy renders.
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()
    expect(
      screen.getByText(/Ask Helix a glance-style natural-language question/i),
    ).toBeInTheDocument()

    // The action button is enabled from mount (an empty message is a
    // valid one-tap summary) and exposes the per-feature verb through
    // its accessible name. The disabled state is COMPUTED, so the
    // idle aria-disabled mirror reads 'false'.
    const button = askButton()
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(ariaLabel).toContain('Ask about my car')

    // The free-text question surface is present and empty.
    const input = questionInput()
    expect(input.tagName).toBe('TEXTAREA')
    expect(input).toHaveValue('')

    // Idle: nothing has streamed, so no output panel exists yet.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })

  it('caps the textarea at MaxMessageChars so the backend parser is never sent an over-length message', () => {
    enableFeature()

    render(<AIWatchFaceNLResponse />)

    // The maxLength mirrors the Go handler cap; keeping them in sync is
    // the whole point of the source constant's "keep in sync" comment.
    expect(questionInput()).toHaveAttribute('maxlength', String(MAX_MESSAGE_CHARS))
  })
})

describe('AIWatchFaceNLResponse — message body shaping + SSE wiring', () => {
  it('POSTs exactly once to the registered route with the trimmed message and the SSE headers, then renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', {
        text:
          'Battery is at 82 percent with about 225 miles of range. The car is locked and sentry is off.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 120, out: 40 } })
    const calls = installStreamingFetch(sseBody)

    render(<AIWatchFaceNLResponse />)

    await typeQuestion('how is my battery doing?')
    const button = askButton()
    expect(button).not.toBeDisabled()
    await clickAsk()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(RESPOND_ROUTE)
    expect(init?.method).toBe('POST')
    // The body carries the typed message verbatim — proves the surface
    // feeds the handler parser the same shape the Go test exercises.
    expect(typeof init?.body).toBe('string')
    expect(parseBody(init)).toEqual({ message: 'how is my battery doing?' })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed narrative renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(
        /Battery is at 82 percent with about 225 miles of range/,
      )
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /The car is locked and sentry is off\./,
    )
  })

  it('POSTs {} when the message is empty (deterministic default-summary path)', async () => {
    enableFeature()
    const calls = installStreamingFetch(sseFrame('done', { finish_reason: 'stop' }))

    render(<AIWatchFaceNLResponse />)

    // No typing — the glance-style one-tap summary. The button must be
    // enabled and the body must serialize as the empty object.
    const button = askButton()
    expect(button).not.toBeDisabled()
    await clickAsk()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(parseBody(calls[0].init)).toEqual({})
  })

  it('POSTs {} when the message is whitespace-only (trim collapses to the default path)', async () => {
    enableFeature()
    const calls = installStreamingFetch(sseFrame('done', { finish_reason: 'stop' }))

    render(<AIWatchFaceNLResponse />)

    await typeQuestion('   \n\t  ')
    await clickAsk()

    await waitFor(() => expect(calls).toHaveLength(1))
    // trimmedMessage.length === 0 → message omitted → `{}` on the wire.
    expect(parseBody(calls[0].init)).toEqual({})
  })

  it('trims surrounding whitespace off the message before sending', async () => {
    enableFeature()
    const calls = installStreamingFetch(sseFrame('done', { finish_reason: 'stop' }))

    render(<AIWatchFaceNLResponse />)

    await typeQuestion('   is the car locked?   ')
    await clickAsk()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(parseBody(calls[0].init)).toEqual({ message: 'is the car locked?' })
  })
})

describe('AIWatchFaceNLResponse — streaming lifecycle', () => {
  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(<AIWatchFaceNLResponse />)
    await typeQuestion('what is my range?')
    const button = await clickAsk()

    await waitFor(() => expect(button).toBeDisabled())
    // aria-disabled is kept in lockstep with the visual disabled so
    // screen-reader users perceive the in-flight state.
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The empty-but-open panel shows the animated thinking indicator.
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AIWatchFaceNLResponse />)
    const button = await clickAsk()

    await waitFor(() => expect(tracker.count()).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    // fireEvent.click bypasses the disabled attribute, exercising the
    // AIFeatureCard's isStreaming guard + the hook's runningRef
    // coalescer as defence in depth.
    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(1)
  })

  it('re-runs after a completed stream, clearing the previous narration', async () => {
    enableFeature()
    const first =
      sseFrame('delta', { text: 'First glance: battery 80 percent, locked.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
    const second =
      sseFrame('delta', { text: 'Second glance: charging started, 60 percent.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
    const calls = installSequentialFetch([first, second])

    render(<AIWatchFaceNLResponse />)
    const button = await clickAsk()

    const panel = await screen.findByTestId('ai-output-panel')
    await waitFor(() => expect(panel).toHaveTextContent(/First glance/))

    // Stream done → button is enabled again (state='done', not busy).
    await waitFor(() => expect(button).toBeEnabled())

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(calls).toHaveLength(2))
    // The re-run resets the accumulator: the new text replaces the old.
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Second glance: charging started, 60 percent\./,
      ),
    )
    expect(screen.getByTestId('ai-output-panel')).not.toHaveTextContent(
      /First glance/,
    )
  })

  it('surfaces an HTTP error in the output panel when the stream route returns non-2xx', async () => {
    enableFeature()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AIWatchFaceNLResponse />)
    await clickAsk()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })

  it('surfaces a terminal SSE error frame in the output panel', async () => {
    enableFeature()
    installStreamingFetch(sseFrame('error', { message: 'provider_unavailable' }))

    render(<AIWatchFaceNLResponse />)
    await clickAsk()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AIWatchFaceNLResponse — computed canStart branches', () => {
  it('disables the button when the trimmed message exceeds MaxMessageChars and re-enables it once cleared', async () => {
    enableFeature()
    // A loud fetch: this test must never reach the network — the guard
    // is meant to stop the over-cap message before it is sent.
    const tracker = installNeverClosingFetch()

    render(<AIWatchFaceNLResponse />)
    const button = askButton()
    expect(button).toBeEnabled()

    // jsdom does not enforce maxLength on programmatic value changes,
    // so we can drive the trimmed length past the cap and prove the
    // computed `messageWithinCap` branch disables the button.
    await typeQuestion('a'.repeat(MAX_MESSAGE_CHARS + 1))
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-disabled', 'true')

    // Exactly at the cap is allowed (<=), so the button re-enables.
    await typeQuestion('b'.repeat(MAX_MESSAGE_CHARS))
    await waitFor(() => expect(button).toBeEnabled())

    // Clearing the field returns to the enabled default-summary state.
    await typeQuestion('')
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveAttribute('aria-disabled', 'false')

    // The over-cap state never issued a request.
    expect(tracker.count()).toBe(0)
  })

  it('disables the action button (computed canStart) when the stream pauses for confirmation', async () => {
    enableFeature()
    // A lone confirm_request pauses the hook at 'paused-confirm'. This
    // narrative surface provides no ConfirmDialog, so canStart flips to
    // false — proving the computed `state !== 'paused-confirm'` branch
    // rather than a literal disabled.
    installStreamingFetch(
      sseFrame('confirm_request', {
        continuation_id: 'cont-1',
        tool: 'query_watch_context',
        args: {},
        summary: 'Confirm read of watch-face context',
      }),
    )

    render(<AIWatchFaceNLResponse />)
    const button = await clickAsk()

    // Once the stream settles at paused-confirm the button stays
    // disabled AND the empty panel disappears (paused-confirm is
    // neither streaming, done, nor error) — distinguishing it from the
    // still-streaming and completed states.
    await waitFor(() => {
      expect(button).toBeDisabled()
      expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('AIWatchFaceNLResponse — narrative render contract, lifecycle + public surface', () => {
  it('never renders a proposal preview or an "Apply" affordance, even when a tool_result frame arrives', async () => {
    enableFeature()
    // A stray typed tool_result must be ignored by the no-op onEvent
    // handler: this surface NARRATES, it never proposes a change.
    installStreamingFetch(
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'query_watch_context',
        ok: true,
        data: { proposed: { is_locked: false } },
      }) +
        sseFrame('delta', {
          text: 'Your car is locked and the battery is at 74 percent.',
        }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 8, out: 4 } }),
    )

    render(<AIWatchFaceNLResponse />)
    await clickAsk()

    // The narrative still renders...
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Your car is locked and the battery is at 74 percent\./,
      ),
    )
    // ...but no proposal preview / Apply hand-off leaked in.
    expect(
      screen.queryByRole('button', { name: /Apply/i }),
    ).not.toBeInTheDocument()
    // The only button in the card is the single Helix action button.
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('aborts the in-flight stream when the component unmounts', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    const { unmount } = render(<AIWatchFaceNLResponse />)
    await clickAsk()

    await waitFor(() => expect(tracker.count()).toBe(1))
    const signal = tracker.signal()
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    unmount()

    // The dedicated cleanup effect cancels the stream so a stale stream
    // cannot bleed into a subsequent mount of the panel.
    expect(signal?.aborted).toBe(true)
  })

  it('exposes a stable displayName for the gated component', () => {
    expect(AIWatchFaceNLResponse.displayName).toBe('AIWatchFaceNLResponse')
  })
})
