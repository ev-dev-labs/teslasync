// Comprehensive unit + behaviour coverage for
// AIStateMachineDebuggerNarrator — the co-located Project Apex
// elevation test.
//
// The module has a single runtime export:
// `AIStateMachineDebuggerNarrator` (an InnerSection wrapped with
// withAiFeature). It is a pure read-only narration surface with no
// reducer, captured proposal, or Apply hand-off. The facets worth
// exercising are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, and the positive control that proves the gate is real);
//   - the input gate: the "Narrate transitions" button's `disabled` is
//     a COMPUTED expression derived from the (vehicle, window) triple —
//     `haveScope` requires a finite positive vehicleId, a finite
//     positive fromUnix, and a finite toUnix > fromUnix — never a
//     literal `disabled`. Proved across a matrix of absent / zero /
//     negative / NaN / reversed / equal inputs, plus the empty-state
//     hint that explains the disabled button;
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/system/fsm/narrate` route with the correct method /
//     headers and the in-scope `{ vehicle_id, from_unix, to_unix }`
//     body so the LLM cannot widen the window);
//   - the streaming lifecycle (thinking indicator + disabled button
//     while in flight, multi-delta accumulation, double-submit guard,
//     re-enable after done, HTTP-error + error-frame fallbacks rendered
//     in AiOutputPanel); and
//   - the stable public surface (displayName).
//
// Network is mocked with a hand-rolled ReadableStream emitting the SSE
// frames internal/ai/stream/writer.go produces — the same convention
// the sibling feature tests use. No real network is touched.
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
import { AIStateMachineDebuggerNarrator } from '@/components/ai/AIStateMachineDebuggerNarrator'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-state-machine-debugger-narrator-root'
const FEATURE_ID = 'state-machine-debugger-narrator'
const NARRATE_ROUTE = '/api/v1/ai/system/fsm/narrate'
const EMPTY_HINT = 'Select a vehicle and a valid time window first.'

const VEHICLE_ID = 42
const FROM_UNIX = 1700000000
const TO_UNIX = 1700001800

// The narration surface accepts an optional (vehicle, window) triple.
type NarratorProps = {
  vehicleId?: number
  fromUnix?: number
  toUnix?: number
}

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
      ai_features: { [FEATURE_ID]: true },
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

function narrateButton(): HTMLElement {
  return screen.getByRole('button', { name: /Narrate transitions/i })
}

async function clickNarrate(): Promise<HTMLElement> {
  const btn = narrateButton()
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

describe('AIStateMachineDebuggerNarrator — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { [FEATURE_ID]: true },
      }),
    )

    const { container } = render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Narrate transitions/i }),
    ).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { [FEATURE_ID]: false },
      }),
    )

    const { container } = render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the ai_features map is entirely absent', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud' }))

    const { container } = render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge, description and an enabled button when mode + toggle + scope are all present', () => {
    enableFeature()

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)

    // The deterministic title + badge + description copy renders.
    expect(screen.getByText('Helix FSM narrator')).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()
    expect(
      screen.getByText(/reads only the deterministic FSM envelope/i),
    ).toBeInTheDocument()

    // The Narrate button is enabled (scope resolved, idle stream) and
    // exposes the per-feature verb through its accessible name.
    const button = narrateButton()
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(ariaLabel).toContain('Narrate transitions')

    // Idle: no output panel yet, and no empty hint (a full scope IS in
    // place) — proves both conditional branches.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AIStateMachineDebuggerNarrator — input gate (computed disabled + empty state)', () => {
  it('disables the Narrate button and shows the empty-state hint when no scope props are supplied', () => {
    enableFeature()

    render(<AIStateMachineDebuggerNarrator />)

    const button = narrateButton()
    expect(button).toBeDisabled()
    // The disabled attribute is mirrored by aria-disabled (W1 Rule A:
    // computed, screen-reader-visible disabled state).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The empty hint explains WHY the button is disabled instead of
    // leaving a bare, unexplained control.
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
  })

  it.each<[string, NarratorProps]>([
    ['missing vehicleId', { fromUnix: FROM_UNIX, toUnix: TO_UNIX }],
    ['zero vehicleId', { vehicleId: 0, fromUnix: FROM_UNIX, toUnix: TO_UNIX }],
    ['negative vehicleId', { vehicleId: -5, fromUnix: FROM_UNIX, toUnix: TO_UNIX }],
    ['NaN vehicleId', { vehicleId: Number.NaN, fromUnix: FROM_UNIX, toUnix: TO_UNIX }],
    ['missing fromUnix', { vehicleId: VEHICLE_ID, toUnix: TO_UNIX }],
    ['zero fromUnix', { vehicleId: VEHICLE_ID, fromUnix: 0, toUnix: TO_UNIX }],
    ['negative fromUnix', { vehicleId: VEHICLE_ID, fromUnix: -1, toUnix: TO_UNIX }],
    ['NaN fromUnix', { vehicleId: VEHICLE_ID, fromUnix: Number.NaN, toUnix: TO_UNIX }],
    ['missing toUnix', { vehicleId: VEHICLE_ID, fromUnix: FROM_UNIX }],
    ['reversed window (to < from)', { vehicleId: VEHICLE_ID, fromUnix: TO_UNIX, toUnix: FROM_UNIX }],
    ['equal window (to == from)', { vehicleId: VEHICLE_ID, fromUnix: FROM_UNIX, toUnix: FROM_UNIX }],
    ['NaN toUnix', { vehicleId: VEHICLE_ID, fromUnix: FROM_UNIX, toUnix: Number.NaN }],
  ])(
    'keeps the Narrate button disabled for an invalid scope (%s)',
    (_label, props) => {
      enableFeature()

      render(<AIStateMachineDebuggerNarrator {...props} />)

      expect(narrateButton()).toBeDisabled()
      expect(narrateButton()).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()
    },
  )

  it('does not open a stream when the (disabled) button is clicked without a scope', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(<AIStateMachineDebuggerNarrator />)

    await act(async () => {
      fireEvent.click(narrateButton())
    })
    // Give any rogue fetch a macrotask to land.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(0)
  })

  it('enables the Narrate button once a full valid scope resolves via rerender', () => {
    enableFeature()

    const { rerender } = render(
      <AIStateMachineDebuggerNarrator vehicleId={VEHICLE_ID} fromUnix={FROM_UNIX} />,
    )
    // Window is incomplete (toUnix missing) → disabled + hint.
    expect(narrateButton()).toBeDisabled()
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument()

    rerender(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )
    expect(narrateButton()).toBeEnabled()
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument()
  })
})

describe('AIStateMachineDebuggerNarrator — SSE wiring + streaming lifecycle', () => {
  it('POSTs exactly once to the registered route with the in-scope (vehicle_id, from_unix, to_unix) triple and renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', {
        text:
          'The vehicle FSM trace shows a steady drive cycle with no flap events.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 220, out: 90 } })
    const calls = installStreamingFetch(sseBody)

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )

    await clickNarrate()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(NARRATE_ROUTE)
    expect(init?.method).toBe('POST')
    // The body MUST carry exactly the in-scope triple so the LLM cannot
    // widen the window it narrates.
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: VEHICLE_ID,
      from_unix: FROM_UNIX,
      to_unix: TO_UNIX,
    })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed narrative renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(
        /steady drive cycle with no flap events\./,
      )
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /steady drive cycle with no flap events/,
    )
  })

  it('accumulates multiple delta frames in arrival order into the output panel', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', { text: 'The DriveFSM transitioned parked→driving once ' }) +
      sseFrame('delta', { text: 'and stayed there for the whole window.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 20 } })
    installStreamingFetch(sseBody)

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )

    await clickNarrate()

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        'The DriveFSM transitioned parked→driving once and stayed there for the whole window.',
      )
    })
  })

  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )
    const button = await clickNarrate()

    await waitFor(() => expect(button).toBeDisabled())
    expect(screen.getByTestId('ai-thinking-indicator')).toBeInTheDocument()
    expect(button).toHaveTextContent(/Helix is thinking/)
  })

  it('guards against double-submit: a second click while streaming issues no new request', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )
    const button = await clickNarrate()

    await waitFor(() => expect(tracker.count()).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(1)
  })

  it('re-enables the Narrate button and keeps the narrative visible after the stream completes', async () => {
    enableFeature()
    installStreamingFetch(
      sseFrame('delta', { text: 'Two flap events on the ChargeFSM.' }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 5, out: 5 } }),
    )

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )
    const button = await clickNarrate()

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        'Two flap events on the ChargeFSM.',
      )
    })
    // After 'done' the computed disabled resolves back to enabled.
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveTextContent(/Ask Helix/)
  })

  it('surfaces an HTTP error in the output panel when the stream route returns non-2xx', async () => {
    enableFeature()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )
    await clickNarrate()

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
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    )
    await clickNarrate()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AIStateMachineDebuggerNarrator — public surface', () => {
  it('exposes a stable displayName for the gated component', () => {
    expect(AIStateMachineDebuggerNarrator.displayName).toBe(
      'AIStateMachineDebuggerNarrator',
    )
  })
})
