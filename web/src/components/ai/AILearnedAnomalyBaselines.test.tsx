// Behaviour + hardening coverage for the learned per-vehicle anomaly
// baseline narrator (AILearnedAnomalyBaselines).
//
// The only export is the withAiFeature-wrapped component. Its
// behaviour has three distinct facets, all exercised here:
//
//   1. Render gate (ADR-015 AI-Off Contract). Off mode OR a
//      per-feature toggle of false OR an unresolved ai_features map
//      hides the surface entirely; the positive control proves the
//      gate is not trivially always-off.
//
//   2. vehicleId input guard. The Train button derives its disabled
//      state from `canStart = vehicleId != null && vehicleId > 0`,
//      mirroring the backend contract (internal/api/aimlanom/handler.go
//      rejects vehicle_id <= 0 with HTTP 400). This covers the
//      undefined / zero / negative / positive branches — the 0 and
//      negative cases are the regression guard for the pre-hardening
//      `vehicleId != null` bug that left the button enabled for an
//      unresolved (0) vehicle.
//
//   3. Stream wiring. Clicking POSTs exactly once to
//      /api/v1/ai/ml/anomaly-baselines/train with the fixed 14-day
//      learning window, renders the accumulated delta text, shows the
//      streaming placeholder before the first delta, guards against
//      double-submit while streaming, and surfaces a non-2xx response
//      as an inline Helix error (the off-mode-at-the-backend fallback
//      path).
//
// react-i18next returns the English fallback (2nd arg to t()) when no
// provider is mounted, so button/label assertions match the default
// copy. getApiBase() returns '' under jsdom, so the fetch URL is the
// bare /api/v1 path. Network is fully mocked — no real requests.
// @testing-library/user-event is intentionally NOT a dependency of
// this codebase (see web/package.json), so interactions are driven
// with fireEvent.click, consistent with every other SSE wiring test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

// File-level mock wins over the global useSettings stub registered in
// src/test-setup.ts (which defaults ai_mode='off'). Each test drives
// the render gate explicitly via mockUseSettings.mockReturnValue.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AILearnedAnomalyBaselines } from '@/components/ai/AILearnedAnomalyBaselines'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const FEATURE_ID = 'learned-per-vehicle-anomaly-baselines'
const ROOT_TESTID = 'ai-feature-learned-per-vehicle-anomaly-baselines-root'
const TRAIN_URL = '/api/v1/ai/ml/anomaly-baselines/train'

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

function trainButton() {
  return screen.getByRole('button', { name: /Train baseline/i })
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

describe('AILearnedAnomalyBaselines — render gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    // The toggle is intentionally true to defeat the "hidden because
    // nothing is enabled" shortcut — mode=off must trump it.
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )

    const { container } = render(<AILearnedAnomalyBaselines vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is false even with mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )

    const { container } = render(<AILearnedAnomalyBaselines vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is undefined (settings not yet resolved)', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud' }))

    const { container } = render(<AILearnedAnomalyBaselines vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with the registered marker + copy when fully enabled (positive control)', () => {
    enableFeature()

    render(<AILearnedAnomalyBaselines vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // The feature title frames the read-only narration.
    expect(screen.getByText('Learn per-vehicle baseline')).toBeInTheDocument()
    // The description explains the mean/stddev/p5/p95 envelope contract.
    expect(root).toHaveTextContent(/mean, stddev, p5\/p95/)
    // The Helix badge rides in the header.
    expect(root).toHaveTextContent(/Helix/)
  })
})

describe('AILearnedAnomalyBaselines — vehicleId input guard', () => {
  it('disables the Train button when no vehicleId is resolved', () => {
    enableFeature()

    render(<AILearnedAnomalyBaselines />)

    const button = trainButton()
    expect(button).toBeDisabled()
    // The disabled state is a COMPUTED expression mirrored into
    // aria-disabled for screen-reader parity (never a literal
    // disabled={true}).
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the Train button when vehicleId is 0 (backend requires > 0)', () => {
    // Regression guard: the pre-hardening `vehicleId != null` guard left
    // the button ENABLED for an unresolved 0 sentinel, which would fire
    // a request the handler rejects with HTTP 400. canStart now also
    // requires > 0.
    enableFeature()

    render(<AILearnedAnomalyBaselines vehicleId={0} />)

    const button = trainButton()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the Train button when vehicleId is negative', () => {
    enableFeature()

    render(<AILearnedAnomalyBaselines vehicleId={-5} />)

    expect(trainButton()).toBeDisabled()
  })

  it('enables the Train button once a positive vehicleId is present', () => {
    enableFeature()

    render(<AILearnedAnomalyBaselines vehicleId={42} />)

    const button = trainButton()
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })
})

describe('AILearnedAnomalyBaselines — stream wiring', () => {
  it('POSTs once to the train route with vehicle_id + the fixed 14-day window and renders the delta', async () => {
    enableFeature()

    const sseBody =
      sseFrame('delta', {
        text: 'Battery voltage learned envelope p5/p95 sits inside the static safe range; no fallback needed.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } })
    const calls = installStreamingFetch(sseBody)

    render(<AILearnedAnomalyBaselines vehicleId={42} />)

    const button = trainButton()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    // Exactly one request, against the bare /api/v1 path, POST with the
    // streaming Accept header and a numeric vehicle_id + days=14 body.
    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(TRAIN_URL)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')
    const parsed = JSON.parse(init?.body as string)
    expect(parsed).toEqual({ vehicle_id: 42, days: 14 })
    expect(typeof parsed.vehicle_id).toBe('number')

    // The accumulated delta renders inside the gated wrapper.
    await waitFor(() => {
      expect(
        screen.getByText(/learned envelope p5\/p95 sits inside the static safe range/),
      ).toBeInTheDocument()
    })
  })

  it('shows the streaming output panel before the first delta arrives (loading state)', async () => {
    enableFeature()

    // A stream that never enqueues/closes keeps state='streaming' with
    // no text, so AiOutputPanel renders its pending placeholder.
    globalThis.fetch = vi.fn(async () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ) as unknown as typeof globalThis.fetch

    render(<AILearnedAnomalyBaselines vehicleId={7} />)

    await act(async () => {
      fireEvent.click(trainButton())
    })

    // The output panel appears (state moved to 'streaming') even though
    // no delta text has been received yet — never a blank surface.
    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toBeInTheDocument()
    // While streaming the button reflects the in-flight state.
    await waitFor(() => expect(trainButton()).toBeDisabled())
    expect(trainButton()).toHaveAttribute('aria-busy', 'true')
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

    render(<AILearnedAnomalyBaselines vehicleId={42} />)

    const button = trainButton()
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

  it('surfaces a non-2xx response as an inline Helix error', async () => {
    enableFeature()

    // 404 is exactly the AI-off-at-the-backend / feature-guard path.
    globalThis.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AILearnedAnomalyBaselines vehicleId={42} />)

    await act(async () => {
      fireEvent.click(trainButton())
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent(/stream_http_404/)
  })
})
