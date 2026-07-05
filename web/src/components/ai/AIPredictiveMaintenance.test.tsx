// Behaviour + hardening coverage for the predictive-maintenance
// advisor (AIPredictiveMaintenance).
//
// The only export is the withAiFeature-wrapped component. Its
// behaviour has four distinct facets, all exercised here:
//
//   1. Render gate (ADR-015 AI-Off Contract). Off mode OR a
//      per-feature toggle of false OR an unresolved ai_features map
//      hides the surface entirely; the positive control proves the
//      gate is not trivially always-off and that the deterministic
//      baseline framing + Helix badge ride in the copy.
//
//   2. vehicleId scope guard. The "Predict maintenance" button
//      derives its disabled state from
//      `haveScope = typeof id === 'number' && isFinite(id) && id > 0`,
//      and the empty hint ("Select a vehicle first.") shows only when
//      the scope is unset. This covers the undefined / zero /
//      negative / NaN / positive branches of the scope handling.
//
//   3. Stream wiring. Clicking POSTs exactly once to
//      /api/v1/ai/maintenance/predict with a numeric vehicle_id body,
//      renders the accumulated delta text, exposes the animated
//      thinking indicator + aria-busy while the first token is
//      pending, guards against double-submit while streaming, and
//      surfaces a non-2xx response as an inline Helix error (the
//      off-mode-at-the-backend fallback path).
//
//   4. a11y + empty state. The action button carries the universal
//      "Ask Helix · Predict maintenance" accessible name plus
//      aria-disabled parity, and the output panel is absent (renders
//      null) until a stream has run.
//
// react-i18next returns the English fallback (2nd arg to t()) when no
// provider is mounted, so button/label/copy assertions match the
// default strings. getApiBase() returns '' under jsdom, so the fetch
// URL is the bare /api/v1 path. Network is fully mocked — no real
// requests. @testing-library/user-event is intentionally NOT a
// dependency of this codebase (see web/package.json), so interactions
// are driven with fireEvent.click, consistent with every other SSE
// wiring test in this directory.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

// File-level mock wins over the global useSettings stub registered in
// src/test-setup.ts (which defaults ai_mode='off'). Each test drives
// the render gate explicitly via mockUseSettings.mockReturnValue.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIPredictiveMaintenance } from '@/components/ai/AIPredictiveMaintenance'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const FEATURE_ID = 'predictive-maintenance'
const ROOT_TESTID = 'ai-feature-predictive-maintenance-root'
const PREDICT_URL = '/api/v1/ai/maintenance/predict'

// A complete AppSettings with realistic non-AI defaults. Individual
// tests override ai_mode / ai_features to walk the gate branches.
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

// enableFeature flips the gate on (ai_mode='cloud' + the per-feature
// toggle) so the always-on inner card renders.
function enableFeature(extra: Partial<AppSettings> = {}) {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { [FEATURE_ID]: true },
      ...extra,
    }),
  )
}

// makeReadableStream builds a ReadableStream<Uint8Array> out of text
// chunks, mirroring the helper useAiStream's own tests use so the SSE
// parser receives byte-for-byte equivalent input.
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

// sseFrame formats one SSE event the way internal/ai/stream/writer.go
// emits it (`event: <name>\ndata: <json>\n\n`).
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// installStreamingFetch records every request and returns the given
// SSE body as a 200 text/event-stream response.
function installStreamingFetch(body: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(makeReadableStream([body]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as unknown as typeof globalThis.fetch
  return calls
}

function predictButton() {
  return screen.getByRole('button', { name: /Predict maintenance/i })
}

beforeEach(() => {
  mockUseSettings.mockReset()
  // Fail loudly if a test forgets to install its own fetch instead of
  // silently timing out on a real network call.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AIPredictiveMaintenance — render gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    // The toggle is intentionally true to defeat the "hidden because
    // nothing is enabled" shortcut — mode=off must trump it.
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )

    const { container } = render(<AIPredictiveMaintenance vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is false even with mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )

    const { container } = render(<AIPredictiveMaintenance vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is undefined (settings not yet resolved)', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud' }))

    const { container } = render(<AIPredictiveMaintenance vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with the registered marker + baseline framing when fully enabled (positive control)', () => {
    enableFeature()

    render(<AIPredictiveMaintenance vehicleId={7} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // Title framing must be present so the operator understands the
    // narrator only explains the deterministic envelope.
    expect(screen.getByText('Helix maintenance advisor')).toBeInTheDocument()
    // The privacy contract + deterministic-baseline caveat ride in the
    // description copy.
    expect(root).toHaveTextContent(/deterministic maintenance envelope/i)
    expect(root).toHaveTextContent(/redacted before the message reaches the provider/i)
    expect(root).toHaveTextContent(/canonical raw view/i)
    // The Helix badge rides in the header.
    expect(root).toHaveTextContent(/Helix/)
  })
})

describe('AIPredictiveMaintenance — vehicleId scope guard', () => {
  it('disables the button and shows the empty hint when no vehicleId is resolved', () => {
    enableFeature()

    render(<AIPredictiveMaintenance />)

    const button = predictButton()
    expect(button).toBeDisabled()
    // The disabled state is a COMPUTED expression mirrored into
    // aria-disabled for screen-reader parity (never a literal
    // disabled={true}).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // The empty-state hint tells the operator what to do next.
    expect(screen.getByText('Select a vehicle first.')).toBeInTheDocument()
  })

  it('disables the button when vehicleId is 0 (scope requires > 0)', () => {
    enableFeature()

    render(<AIPredictiveMaintenance vehicleId={0} />)

    expect(predictButton()).toBeDisabled()
    expect(screen.getByText('Select a vehicle first.')).toBeInTheDocument()
  })

  it('disables the button when vehicleId is negative', () => {
    enableFeature()

    render(<AIPredictiveMaintenance vehicleId={-5} />)

    expect(predictButton()).toBeDisabled()
  })

  it('disables the button when vehicleId is NaN (Number.isFinite branch)', () => {
    enableFeature()

    render(<AIPredictiveMaintenance vehicleId={Number.NaN} />)

    expect(predictButton()).toBeDisabled()
  })

  it('enables the button and hides the empty hint once a positive vehicleId is present', () => {
    enableFeature()

    render(<AIPredictiveMaintenance vehicleId={7} />)

    const button = predictButton()
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    // Idle button must NOT emit aria-busy="false" — the attribute is
    // dropped entirely when not streaming.
    expect(button).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('Select a vehicle first.')).not.toBeInTheDocument()
  })
})

describe('AIPredictiveMaintenance — a11y + empty state', () => {
  it('exposes the universal Helix accessible name + contextual tooltip on the action button', () => {
    enableFeature()

    render(<AIPredictiveMaintenance vehicleId={7} />)

    const button = predictButton()
    // Visible label is the universal CTA; the per-feature verb is
    // preserved in the accessible name + tooltip.
    expect(button).toHaveAttribute('aria-label', 'Ask Helix · Predict maintenance')
    expect(button).toHaveAttribute('title', 'Predict maintenance')
    expect(button).toHaveTextContent('Ask Helix')
  })

  it('does not render the output panel before a stream has run (idle empty state)', () => {
    enableFeature()

    render(<AIPredictiveMaintenance vehicleId={7} />)

    // AiOutputPanel returns null while state==='idle' and text==='',
    // so no dangling empty panel leaks into the DOM.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument()
  })
})

describe('AIPredictiveMaintenance — stream wiring', () => {
  it('POSTs once to the predict route with a numeric vehicle_id and renders the delta', async () => {
    enableFeature()

    const sseBody =
      sseFrame('delta', {
        text: 'Brake fluid service is due within 2,000 km; the 12V auxiliary battery is the next-highest risk.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 45, out: 18 } })
    const calls = installStreamingFetch(sseBody)

    render(<AIPredictiveMaintenance vehicleId={7} />)

    const button = predictButton()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    // Exactly one request, against the bare /api/v1 path, POST with
    // the streaming Accept header and a numeric vehicle_id body.
    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(PREDICT_URL)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')
    const parsed = JSON.parse(init?.body as string)
    expect(parsed).toEqual({ vehicle_id: 7 })
    expect(typeof parsed.vehicle_id).toBe('number')

    // The accumulated delta renders inside the gated wrapper.
    await waitFor(() => {
      expect(screen.getByText(/Brake fluid service is due/)).toBeInTheDocument()
    })
  })

  it('shows the thinking indicator + aria-busy while the first token is pending', async () => {
    enableFeature()

    // A stream that never enqueues/closes keeps state='streaming' with
    // empty text — the pending affordance path.
    globalThis.fetch = vi.fn(async () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ) as unknown as typeof globalThis.fetch

    render(<AIPredictiveMaintenance vehicleId={7} />)

    const button = predictButton()
    await act(async () => {
      fireEvent.click(button)
    })

    // The animated indicator (role=status) surfaces inside the panel.
    const panel = await screen.findByTestId('ai-output-panel')
    const indicator = within(panel).getByTestId('ai-thinking-indicator')
    expect(indicator).toHaveAttribute('role', 'status')

    // The button reports the in-flight state to assistive tech.
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('ignores a second click while streaming (double-submit guard)', async () => {
    enableFeature()

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      // A stream that never enqueues/closes keeps state='streaming'.
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIPredictiveMaintenance vehicleId={7} />)

    const button = predictButton()
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the button reports disabled (computed from
    // isStreaming) and the hook's runningRef coalesces the second call.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(fetchCount).toBe(1)
  })

  it('surfaces a non-2xx response as an inline Helix error (backend-guard fallback)', async () => {
    enableFeature()

    // 404 is exactly the AI-off-at-the-backend / feature-guard path.
    globalThis.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AIPredictiveMaintenance vehicleId={7} />)

    await act(async () => {
      fireEvent.click(predictButton())
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent(/stream_http_404/)
  })
})
