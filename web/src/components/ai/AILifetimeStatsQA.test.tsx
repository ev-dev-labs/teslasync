// Comprehensive unit + behaviour coverage for AILifetimeStatsQA —
// the co-located Project Apex elevation test.
//
// The file has a single runtime export: `AILifetimeStatsQA` (an
// InnerSection wrapped with withAiFeature). Unlike the pure-narration
// AI cards, this surface carries a prompt input (a question Textarea)
// AND a two-part input gate (`haveVehicle && haveQuestion`), so the
// facets worth exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, and the positive control that proves the gate is real);
//   - the two-part input gate: the Ask button's `disabled` is a
//     COMPUTED expression (`!canStart`), never a literal `disabled`.
//     This is proved across a matrix of absent / zero / negative / NaN
//     / non-numeric-string ids and empty / whitespace-only questions,
//     plus the context-sensitive empty-state hint that explains WHICH
//     precondition is missing (vehicle first, then question);
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/analytics/lifetime/qa` route with the correct method
//     / headers and the `{ vehicle_id, question }` body, including the
//     numeric-string coercion path and the whitespace-trim path);
//   - the streaming lifecycle (thinking indicator + disabled button
//     while in flight, double-submit guard, HTTP-error + error-frame
//     fallbacks rendered in AiOutputPanel); and
//   - the stable public surface (displayName).
//
// Network is mocked with a hand-rolled ReadableStream emitting the SSE
// frames internal/ai/stream/writer.go produces — the same convention
// the sibling feature tests use. No real network is touched.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so interactions use fireEvent,
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
import { AILifetimeStatsQA } from '@/components/ai/AILifetimeStatsQA'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-lifetime-stats-qa-root'
const QA_ROUTE = '/api/v1/ai/analytics/lifetime/qa'
const NO_VEHICLE_HINT = 'Select a vehicle to ask about its lifetime stats.'
const NO_QUESTION_HINT = 'Type a question to ask Helix about your lifetime stats.'

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
      ai_features: { 'lifetime-stats-qa': true },
    }),
  )
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from text
// chunks — byte-for-byte what useAiStream's parser consumes.
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
    return new Response(
      new ReadableStream<Uint8Array>({ start() {} }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }) as unknown as typeof globalThis.fetch
  return { count: () => fetchCount }
}

function askButton(): HTMLElement {
  return screen.getByRole('button', { name: /Ask/i })
}

function questionBox(): HTMLElement {
  return screen.getByLabelText(/Your question/i)
}

async function typeQuestion(value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(questionBox(), { target: { value } })
  })
}

async function clickAsk(): Promise<HTMLElement> {
  const btn = askButton()
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

describe('AILifetimeStatsQA — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'lifetime-stats-qa': true },
      }),
    )

    const { container } = render(<AILifetimeStatsQA vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Ask/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Your question/i)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'lifetime-stats-qa': false },
      }),
    )

    const { container } = render(<AILifetimeStatsQA vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge, question box and a disabled Ask button when both mode and toggle are on', () => {
    enableFeature()

    render(<AILifetimeStatsQA vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'lifetime-stats-qa')

    // The deterministic title + badge copy renders.
    expect(
      screen.getByText('Ask about your lifetime stats'),
    ).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()

    // The prompt Textarea renders with its accessible label + the
    // backend-mirroring maxLength cap and placeholder.
    const box = questionBox()
    expect(box.tagName).toBe('TEXTAREA')
    expect(box).toHaveAttribute('maxLength', '1024')
    expect(box).toHaveAttribute(
      'placeholder',
      expect.stringContaining('How far have I driven in total?'),
    )

    // A vehicle IS in scope but the question is empty, so the Ask
    // button is disabled and the question hint (not the vehicle hint)
    // explains why — proves the context-sensitive branch.
    const button = askButton()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(screen.getByText(NO_QUESTION_HINT)).toBeInTheDocument()
    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()

    // Idle: no output panel yet.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })
})

describe('AILifetimeStatsQA — input gate (computed disabled + empty-state hints)', () => {
  it('disables the Ask button and shows the vehicle hint when no vehicleId is available', () => {
    enableFeature()

    render(<AILifetimeStatsQA />)

    const button = askButton()
    expect(button).toBeDisabled()
    // Computed, screen-reader-visible disabled state (W1 Rule A).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The vehicle precondition is the coarser one and is reported first.
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
    expect(screen.queryByText(NO_QUESTION_HINT)).not.toBeInTheDocument()
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['non-numeric string', 'not-a-vehicle'],
    ['empty string', ''],
  ])(
    'keeps the Ask button disabled + shows the vehicle hint for an invalid vehicleId (%s)',
    (_label, id) => {
      enableFeature()

      render(<AILifetimeStatsQA vehicleId={id} />)

      expect(askButton()).toBeDisabled()
      expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
    },
  )

  it('keeps the Ask button disabled for a valid vehicle but an empty question and shows the question hint', () => {
    enableFeature()

    render(<AILifetimeStatsQA vehicleId={42} />)

    expect(askButton()).toBeDisabled()
    expect(screen.getByText(NO_QUESTION_HINT)).toBeInTheDocument()
  })

  it('keeps the Ask button disabled for a whitespace-only question (trim path)', async () => {
    enableFeature()

    render(<AILifetimeStatsQA vehicleId={42} />)
    await typeQuestion('   \t \n  ')

    // trim() collapses whitespace to '' → haveQuestion false → the
    // question hint stays and the button stays disabled.
    expect(askButton()).toBeDisabled()
    expect(screen.getByText(NO_QUESTION_HINT)).toBeInTheDocument()
  })

  it('enables the Ask button and clears both hints once a valid vehicle AND a non-empty question are present', async () => {
    enableFeature()

    render(<AILifetimeStatsQA vehicleId={7} />)
    expect(askButton()).toBeDisabled()

    await typeQuestion('How far have I driven?')

    expect(askButton()).toBeEnabled()
    expect(askButton()).toHaveAttribute('aria-disabled', 'false')
    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()
    expect(screen.queryByText(NO_QUESTION_HINT)).not.toBeInTheDocument()
  })

  it('walks the hint from vehicle → question → gone as preconditions resolve', async () => {
    enableFeature()

    const { rerender } = render(<AILifetimeStatsQA />)
    // No vehicle → vehicle hint.
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()

    // Vehicle resolves via the active-vehicle context → question hint.
    rerender(<AILifetimeStatsQA vehicleId={9} />)
    expect(screen.getByText(NO_QUESTION_HINT)).toBeInTheDocument()
    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()

    // Question typed → both hints gone, button enabled.
    await typeQuestion('How many charge sessions?')
    expect(screen.queryByText(NO_QUESTION_HINT)).not.toBeInTheDocument()
    expect(askButton()).toBeEnabled()
  })

  it('does not open a stream when the (disabled) Ask button is clicked without preconditions', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AILifetimeStatsQA />)

    await act(async () => {
      fireEvent.click(askButton())
    })
    // Give any rogue fetch a macrotask to land.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(0)
  })
})

describe('AILifetimeStatsQA — SSE wiring + streaming lifecycle', () => {
  it('POSTs exactly once to the registered route with the in-scope vehicle_id + question and renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', {
        text:
          "You've driven a total of 12,345 km across 234 drives \u2014 that is 0.31x around the Earth.",
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 20 } })
    const calls = installStreamingFetch(sseBody)

    render(<AILifetimeStatsQA vehicleId={42} />)
    await typeQuestion('How far have I driven in total?')
    await clickAsk()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(QA_ROUTE)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: 42,
      question: 'How far have I driven in total?',
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed answer renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(
        /You've driven a total of 12,345 km across 234 drives/,
      )
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /0\.31x around the Earth/,
    )
  })

  it('coerces a numeric-string vehicleId into a numeric vehicle_id body field', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AILifetimeStatsQA vehicleId="7" />)
    await typeQuestion('How many drives?')
    await clickAsk()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url).toBe(QA_ROUTE)
    // '7' (string) must become the number 7 — the handler validates
    // vehicle_id > 0 as a number.
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      vehicle_id: 7,
      question: 'How many drives?',
    })
  })

  it('sends the trimmed question in the request body', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AILifetimeStatsQA vehicleId={42} />)
    // Leading / trailing whitespace must be stripped before it reaches
    // the handler-side parser.
    await typeQuestion('   How much have I saved on fuel?   ')
    await clickAsk()

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      vehicle_id: 42,
      question: 'How much have I saved on fuel?',
    })
  })

  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(<AILifetimeStatsQA vehicleId={42} />)
    await typeQuestion('How far in total?')
    const button = await clickAsk()

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AILifetimeStatsQA vehicleId={42} />)
    await typeQuestion('How many drives?')
    const button = await clickAsk()

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

    render(<AILifetimeStatsQA vehicleId={42} />)
    await typeQuestion('How far in total?')
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

    render(<AILifetimeStatsQA vehicleId={42} />)
    await typeQuestion('How far in total?')
    await clickAsk()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AILifetimeStatsQA — public surface', () => {
  it('exposes a stable displayName for the gated component', () => {
    expect(AILifetimeStatsQA.displayName).toBe('AILifetimeStatsQA')
  })
})
