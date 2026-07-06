// Comprehensive unit + behaviour coverage for
// AISafetySettingExplainer — the co-located Project Apex elevation
// test.
//
// The component has a single runtime export:
// `AISafetySettingExplainer` (an InnerSection wrapped with
// withAiFeature). It is a pure NARRATIVE surface — no reducer, no
// captured typed proposal, and no "Apply to form" hand-off. It POSTs
// an empty body to a fixed route and streams a plain-English summary
// of the install's safety settings. So the facets worth exercising
// are:
//
//   - the ADR-015 AI-off visibility gate (off-mode, per-feature toggle
//     off, and the positive control that proves the gate is real);
//   - the SSE wiring contract (exactly one POST to the registered
//     `/api/v1/ai/settings/safety/explain` route with the correct
//     method / headers and the EMPTY `{}` body — a non-empty body
//     would mean the surface invented fields the user never picked);
//   - the streaming lifecycle (thinking indicator + computed-disabled
//     button while in flight, double-submit guard, re-run after a
//     completed stream, HTTP-error + terminal error-frame fallbacks
//     rendered in AiOutputPanel);
//   - the NARRATIVE render contract: even when a stray `tool_result`
//     frame arrives, no proposal preview and no "Apply" affordance
//     ever leaks into the DOM (the onEvent handler is a deliberate
//     no-op);
//   - the computed `canStart` branch — the only input that flips the
//     action button off is `state === 'paused-confirm'`, never a
//     literal `disabled`; and
//   - lifecycle hygiene (cancel-on-unmount aborts the in-flight
//     fetch) plus the stable public surface (displayName).
//
// Network is mocked with a hand-rolled ReadableStream emitting the SSE
// frames internal/ai/stream/writer.go produces — the same convention
// the sibling feature tests use. No real network is touched.
// @testing-library/user-event is intentionally NOT a dependency of
// this codebase (see web/package.json), so interactions use
// fireEvent.click, consistent with every other AI feature test.
// react-i18next returns the English fallback (2nd arg) with no
// provider mounted, so assertions read the defaults.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AISafetySettingExplainer } from '@/components/ai/AISafetySettingExplainer'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const ROOT_TESTID = 'ai-feature-safety-setting-explainer-root'
const SUGGEST_TESTID = 'ai-feature-safety-setting-explainer-suggest'
const EXPLAIN_ROUTE = '/api/v1/ai/settings/safety/explain'
const TITLE = 'Explain my safety settings'

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
      ai_features: { 'safety-setting-explainer': true },
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

function explainButton(): HTMLElement {
  return screen.getByTestId(SUGGEST_TESTID)
}

async function clickExplain(): Promise<HTMLElement> {
  const btn = explainButton()
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

describe('AISafetySettingExplainer — AI-off visibility gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the per-feature toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'safety-setting-explainer': true },
      }),
    )

    const { container } = render(<AISafetySettingExplainer />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByTestId(SUGGEST_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode!=off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'safety-setting-explainer': false },
      }),
    )

    const { container } = render(<AISafetySettingExplainer />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the settings query has not resolved yet', () => {
    // useAiEnabled fails closed on an undefined settings object.
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AISafetySettingExplainer />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section (positive control) with title, badge and an enabled button when both mode and toggle are on', () => {
    enableFeature()

    render(<AISafetySettingExplainer />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'safety-setting-explainer')

    // The deterministic title + description copy renders.
    expect(screen.getByText(TITLE)).toBeInTheDocument()
    expect(screen.getByText('Helix')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Ask Helix to explain the safety-related TeslaSync settings/i,
      ),
    ).toBeInTheDocument()

    // The action button is enabled (idle stream) and exposes the
    // per-feature verb through its accessible name. The disabled state
    // is a COMPUTED expression, never a literal — so aria-disabled is
    // mirrored to 'false' when idle.
    const button = explainButton()
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    const ariaLabel = button.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('Ask Helix')
    expect(ariaLabel).toContain('Explain my settings')

    // Idle: nothing has streamed, so no output panel exists yet.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })
})

describe('AISafetySettingExplainer — SSE wiring + streaming lifecycle', () => {
  it('POSTs exactly once to the registered route with an EMPTY body and renders the first delta', async () => {
    enableFeature()
    const sseBody =
      sseFrame('delta', {
        text:
          'Helix sees quiet hours ON from 22:00 to 07:00 and the alert digest set to hourly. No values were changed.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 110, out: 32 } })
    const calls = installStreamingFetch(sseBody)

    render(<AISafetySettingExplainer />)

    await clickExplain()

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(EXPLAIN_ROUTE)
    expect(init?.method).toBe('POST')
    // The body is the empty object — the backend reads identity from
    // ForwardAuth and applies a deterministic default question.
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(init?.body as string)).toEqual({})
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // The streamed narrative renders inside the gated wrapper's panel.
    const root = screen.getByTestId(ROOT_TESTID)
    await waitFor(() => {
      expect(root).toHaveTextContent(
        /quiet hours ON from 22:00 to 07:00 and the alert digest set to hourly/,
      )
    })
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
      /No values were changed\./,
    )
  })

  it('shows the thinking indicator and disables the button while streaming', async () => {
    enableFeature()
    installNeverClosingFetch()

    render(<AISafetySettingExplainer />)
    const button = await clickExplain()

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

    render(<AISafetySettingExplainer />)
    const button = await clickExplain()

    await waitFor(() => expect(tracker.count()).toBe(1))
    await waitFor(() => expect(button).toBeDisabled())

    // fireEvent.click bypasses the disabled attribute, exercising the
    // component's isBusy guard + the hook's runningRef coalescer as
    // defence in depth.
    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tracker.count()).toBe(1)
  })

  it('re-runs after a completed stream, clearing the previous narration', async () => {
    enableFeature()
    const first =
      sseFrame('delta', { text: 'First summary of your safety settings.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
    const second =
      sseFrame('delta', { text: 'Second, refreshed summary.' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 5 } })
    const calls = installSequentialFetch([first, second])

    render(<AISafetySettingExplainer />)
    const button = await clickExplain()

    const panel = await screen.findByTestId('ai-output-panel')
    await waitFor(() => expect(panel).toHaveTextContent(/First summary/))

    // Stream done → button is enabled again (state='done', not busy).
    await waitFor(() => expect(button).toBeEnabled())

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(calls).toHaveLength(2))
    // The re-run resets the accumulator: the new text replaces the old.
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Second, refreshed summary\./,
      ),
    )
    expect(screen.getByTestId('ai-output-panel')).not.toHaveTextContent(
      /First summary/,
    )
  })

  it('surfaces an HTTP error in the output panel when the stream route returns non-2xx', async () => {
    enableFeature()
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AISafetySettingExplainer />)
    await clickExplain()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })

  it('surfaces a terminal SSE error frame in the output panel', async () => {
    enableFeature()
    installStreamingFetch(sseFrame('error', { message: 'provider_unavailable' }))

    render(<AISafetySettingExplainer />)
    await clickExplain()

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error:/)
      expect(panel).toHaveTextContent(/provider_unavailable/)
    })
  })
})

describe('AISafetySettingExplainer — narrative render contract', () => {
  it('never renders a proposal preview or an "Apply" affordance, even when a tool_result frame arrives', async () => {
    enableFeature()
    // A stray typed tool_result must be ignored by the no-op onEvent
    // handler: this surface EXPLAINS, it never proposes a change.
    installStreamingFetch(
      sseFrame('tool_result', {
        id: 'tc1',
        name: 'query_safety_settings',
        ok: true,
        data: { proposed: { quiet_hours_enabled: false } },
      }) +
        sseFrame('delta', {
          text: 'Your quiet hours are enabled; here is what that means.',
        }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 8, out: 4 } }),
    )

    render(<AISafetySettingExplainer />)
    await clickExplain()

    // The narrative still renders...
    await waitFor(() =>
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /here is what that means/,
      ),
    )
    // ...but no proposal preview / Apply hand-off leaked in.
    expect(
      screen.queryByRole('button', { name: /Apply/i }),
    ).not.toBeInTheDocument()
    // The only button in the card is the single Helix action button.
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('disables the action button (computed canStart) when the stream pauses for confirmation', async () => {
    enableFeature()
    // A lone confirm_request pauses the hook at 'paused-confirm'. This
    // narrative surface provides no ConfirmDialog, so canStart flips to
    // false — the ONLY input that disables the button aside from an
    // in-flight stream. Proves the computed `state !== 'paused-confirm'`
    // branch rather than a literal disabled.
    installStreamingFetch(
      sseFrame('confirm_request', {
        continuation_id: 'cont-1',
        tool: 'query_safety_settings',
        args: {},
        summary: 'Confirm read of safety settings',
      }),
    )

    render(<AISafetySettingExplainer />)
    const button = await clickExplain()

    // Once the stream settles at paused-confirm the button stays
    // disabled AND the empty panel disappears (paused-confirm is
    // neither streaming, done, nor error) — which distinguishes it from
    // the still-streaming and completed states.
    await waitFor(() => {
      expect(button).toBeDisabled()
      expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('AISafetySettingExplainer — lifecycle + public surface', () => {
  it('aborts the in-flight stream when the component unmounts', async () => {
    enableFeature()
    const tracker = installNeverClosingFetch()

    const { unmount } = render(<AISafetySettingExplainer />)
    await clickExplain()

    await waitFor(() => expect(tracker.count()).toBe(1))
    const signal = tracker.signal()
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    unmount()

    // The dedicated cleanup effect cancels the stream so a stale
    // stream cannot bleed into a subsequent mount of the panel.
    expect(signal?.aborted).toBe(true)
  })

  it('exposes a stable displayName for the gated component', () => {
    expect(AISafetySettingExplainer.displayName).toBe('AISafetySettingExplainer')
  })
})
