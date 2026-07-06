// Comprehensive unit + behaviour coverage for AITripPlannerLLMAgent —
// the co-located Project Apex elevation test.
//
// The file has a single runtime export: `AITripPlannerLLMAgent` (an
// InnerSection wrapped with withAiFeature). It is a propose-only
// planning surface — it POSTs a fully-typed trip-planning body to a
// fixed route and streams a plain-English draft; nothing is saved and
// the onEvent handler is a deliberate no-op. So the facets worth
// exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, unresolved settings, and the positive control);
//   - the precondition gate that computes `canStart` + the
//     coarsest-first empty-state hint (vehicle → origin → destination),
//     including the numeric-vehicle guard that keeps a non-numeric /
//     zero / negative id from enabling the button while the payload
//     would silently carry vehicle_id 0;
//   - the SSE wiring contract: exactly one POST to the registered
//     `/api/v1/ai/trips/plan/draft` route with the correct
//     method/headers and a body whose SI/preference fields default
//     correctly (current_soc 80, charge_limit_soc 90, min_arrival_soc
//     20, speed_factor 1.0) and pass provided values through verbatim;
//   - the streaming lifecycle (thinking indicator + computed-disabled
//     button while in flight, double-submit guard, re-run after a
//     completed stream, HTTP-error + terminal error-frame fallbacks
//     rendered in AiOutputPanel);
//   - the propose-only render contract: a stray typed `tool_result`
//     frame never leaks a second control into the DOM; and
//   - lifecycle hygiene (cancel-on-unmount aborts the in-flight fetch)
//     plus the stable public surface (displayName).
//
// Network is mocked with a hand-rolled ReadableStream emitting the SSE
// frames internal/ai/stream/writer.go produces — the same convention
// the sibling AI feature tests use. No real network is touched.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so interactions use fireEvent.click.
// react-i18next returns the English fallback (2nd arg) with no provider
// mounted, so assertions read the defaults.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AITripPlannerLLMAgent } from '@/components/ai/AITripPlannerLLMAgent'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-trip-planner-llm-agent-root'
const DRAFT_ROUTE = '/api/v1/ai/trips/plan/draft'
const TITLE = 'Draft a plan with Helix'

const ORIGIN = { lat: 37.7749, lng: -122.4194, name: 'Home' }
const DESTINATION = { lat: 34.0522, lng: -118.2437, name: 'LA' }

// A complete AppSettings with realistic non-AI defaults. Per-test cases
// override `ai_mode` + `ai_features` to flip the gate.
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
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'hourly',
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
      ai_features: { 'trip-planner-llm-agent': true },
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
// (clamping to the last) so a re-run is distinguishable from the first.
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
// never closes) so the component stays in `state='streaming'`. Records
// the AbortSignal of each call and counts invocations.
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

function draftButton(): HTMLElement {
  return screen.getByRole('button', { name: /Draft a plan/i })
}

async function clickDraft(): Promise<HTMLElement> {
  const btn = draftButton()
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

describe('AITripPlannerLLMAgent — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'trip-planner-llm-agent': true },
      }),
    )

    const { container } = render(
      <AITripPlannerLLMAgent
        vehicleId={1}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'trip-planner-llm-agent': false },
      }),
    )

    const { container } = render(
      <AITripPlannerLLMAgent
        vehicleId={1}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the settings query has not resolved yet', () => {
    // useAiEnabled fails closed on an undefined settings object.
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(
      <AITripPlannerLLMAgent
        vehicleId={1}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge and an enabled button when both mode and toggle are on', () => {
    enableFeature()

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'trip-planner-llm-agent')

    // Deterministic title + description + badge copy renders.
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()
    expect(
      screen.getByText(/grounded in your past charging history along the corridor/i),
    ).toBeInTheDocument()

    // The action button is enabled (idle stream, all inputs present) and
    // exposes the per-feature verb through its accessible name. Disabled
    // state is a COMPUTED expression, so aria-disabled mirrors 'false'.
    const button = draftButton()
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(ariaLabel).toContain('Draft a plan')

    // All preconditions satisfied → no empty-state hint is shown.
    expect(
      screen.queryByText(/Select a vehicle to let Helix draft a trip plan/i),
    ).not.toBeInTheDocument()

    // Idle: nothing has streamed, so no output panel exists yet.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })
})

describe('AITripPlannerLLMAgent — precondition gate + empty-state hints', () => {
  it('disables the button and shows the vehicle hint when no vehicle is in scope', () => {
    enableFeature()

    render(
      <AITripPlannerLLMAgent origin={ORIGIN} destination={DESTINATION} />,
    )

    const button = draftButton()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText('Select a vehicle to let Helix draft a trip plan.'),
    ).toBeInTheDocument()
  })

  it('reports the vehicle gate first: a non-numeric vehicleId keeps the button disabled instead of enabling it with a silent vehicle_id 0 payload', () => {
    enableFeature()

    // Regression guard: the previous `!!vehicleId` check treated a
    // non-empty string as "has a vehicle", enabling the button while the
    // memoised body would carry vehicle_id 0. The numeric guard now
    // gates on a finite positive id, so the button stays disabled.
    render(
      <AITripPlannerLLMAgent
        vehicleId={'not-a-number'}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )

    const button = draftButton()
    expect(button).toBeDisabled()
    expect(
      screen.getByText('Select a vehicle to let Helix draft a trip plan.'),
    ).toBeInTheDocument()
  })

  it('advances to the origin hint once a vehicle is present but no origin', () => {
    enableFeature()

    render(
      <AITripPlannerLLMAgent vehicleId={7} destination={DESTINATION} />,
    )

    const button = draftButton()
    expect(button).toBeDisabled()
    expect(
      screen.getByText('Set a starting point for Helix to plan the route from.'),
    ).toBeInTheDocument()
    // The coarser vehicle hint is NOT shown once the vehicle gate passes.
    expect(
      screen.queryByText('Select a vehicle to let Helix draft a trip plan.'),
    ).not.toBeInTheDocument()
  })

  it('advances to the destination hint once vehicle + origin are present but no destination', () => {
    enableFeature()

    render(<AITripPlannerLLMAgent vehicleId={7} origin={ORIGIN} />)

    const button = draftButton()
    expect(button).toBeDisabled()
    expect(
      screen.getByText('Set a destination for Helix to plan the route to.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Set a starting point for Helix to plan the route from.'),
    ).not.toBeInTheDocument()
  })
})

describe('AITripPlannerLLMAgent — SSE wiring + request body', () => {
  it('POSTs exactly once to the registered route with the correct method + headers', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', { text: 'Drafting a plan along your corridor…' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 120, out: 40 } })
    const calls = installStreamingFetch(sseBody)

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )

    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(DRAFT_ROUTE)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed narrative renders inside the gated wrapper's panel.
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Drafting a plan along your corridor/,
      ),
    )
  })

  it('sends a fully-typed body with the caller-supplied SI + preference fields verbatim', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
        currentSoc={65}
        chargeLimitSoc={85}
        minArrivalSoc={15}
        speedFactor={1.1}
      />,
    )

    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    const parsed = JSON.parse(calls[0].init?.body as string)
    expect(parsed).toEqual({
      vehicle_id: 42,
      origin: { lat: 37.7749, lng: -122.4194, name: 'Home' },
      destination: { lat: 34.0522, lng: -118.2437, name: 'LA' },
      current_soc: 65,
      charge_limit_soc: 85,
      min_arrival_soc: 15,
      speed_factor: 1.1,
    })
  })

  it('applies SI/preference defaults and coerces a numeric-string vehicleId to a number when optional props are omitted', async () => {
    enableFeature()
    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    // A numeric-string vehicleId (the common case for URL/query params)
    // is coerced to a number; an origin without a name defaults to ''.
    render(
      <AITripPlannerLLMAgent
        vehicleId={'7'}
        origin={{ lat: 1, lng: 2 }}
        destination={{ lat: 3, lng: 4 }}
      />,
    )

    await clickDraft()

    await waitFor(() => expect(calls).toHaveLength(1))
    const parsed = JSON.parse(calls[0].init?.body as string)
    expect(typeof parsed.vehicle_id).toBe('number')
    expect(parsed.vehicle_id).toBe(7)
    expect(parsed.origin).toEqual({ lat: 1, lng: 2, name: '' })
    // Optional SoC / speed fields fall back to the documented defaults.
    expect(parsed.current_soc).toBe(80)
    expect(parsed.charge_limit_soc).toBe(90)
    expect(parsed.min_arrival_soc).toBe(20)
    expect(parsed.speed_factor).toBe(1)
  })
})

describe('AITripPlannerLLMAgent — streaming lifecycle', () => {
  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )
    const button = await clickDraft()

    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )
    const button = await clickDraft()

    await waitFor(() => expect(tracker.count()).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    // fireEvent.click bypasses the disabled attribute, exercising the
    // hook's runningRef coalescer as defence in depth.
    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(1)
  })

  it('re-runs after a completed stream, clearing the previous draft', async () => {
    enableFeature()
    const first =
      sseFrame('delta', { text: 'First draft plan.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
    const second =
      sseFrame('delta', { text: 'Second, refreshed draft plan.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
    const calls = installSequentialFetch([first, second])

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )
    const button = await clickDraft()

    const panel = await screen.findByTestId('ai-output-panel')
    await waitFor(() => expect(panel).toHaveTextContent(/First draft plan/))

    // Stream done → button is enabled again (state='done', not busy).
    await waitFor(() => expect(button).toBeEnabled())

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(calls).toHaveLength(2))
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Second, refreshed draft plan\./,
      ),
    )
    expect(screen.getByTestId('ai-output-panel')).not.toHaveTextContent(
      /First draft plan/,
    )
  })

  it('surfaces an HTTP error in the output panel when the stream route returns non-2xx', async () => {
    enableFeature()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )
    await clickDraft()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })

  it('surfaces a terminal SSE error frame in the output panel', async () => {
    enableFeature()
    installStreamingFetch(sseFrame('error', { message: 'provider_unavailable' }))

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )
    await clickDraft()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AITripPlannerLLMAgent — propose-only contract + public surface', () => {
  it('ignores stray typed tool_result frames: the draft renders and no second control leaks into the DOM', async () => {
    enableFeature()
    // The onEvent handler is a deliberate no-op — a stray tool_result
    // envelope must not spawn an "Apply"/proposal affordance. Only the
    // single Helix action button should ever exist in the card.
    installStreamingFetch(
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'project_charging_history',
        ok: true,
        data: { proposed: { chargers: ['Kettleman City'] } },
      }) +
        sseFrame('delta', { text: 'Here is a corridor draft you can review.' }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 8, out: 4 } }),
    )

    render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )
    await clickDraft()

    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /corridor draft you can review/,
      ),
    )
    expect(
      screen.queryByRole('button', { name: /Apply/i }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('aborts the in-flight stream when the component unmounts', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    const { unmount } = render(
      <AITripPlannerLLMAgent
        vehicleId={42}
        origin={ORIGIN}
        destination={DESTINATION}
      />,
    )
    await clickDraft()

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
    expect(AITripPlannerLLMAgent.displayName).toBe('AITripPlannerLLMAgent')
  })
})
