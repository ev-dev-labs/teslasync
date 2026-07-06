// Behaviour + hardening coverage for the battery-health forecast
// narrator (AIBatteryHealthForecastNarrative).
//
// The only export is the withAiFeature-wrapped component. Its
// behaviour has three distinct facets, all exercised here:
//
//   1. Render gate (ADR-015 AI-Off Contract). Off mode OR a
//      per-feature toggle of false hides the surface entirely; the
//      positive control proves the gate is not trivially always-off.
//
//   2. Input guard. The Narrate button derives its disabled state
//      from `haveInputs = isFinite(id) && id > 0`, and the POST body
//      always carries a numeric `vehicle_id`. This covers the
//      undefined / zero / non-numeric-string / string-coercion
//      branches of the vehicleId handling.
//
//   3. Stream wiring. Clicking POSTs exactly once to
//      /api/v1/ai/battery/health/narrate, renders the accumulated
//      delta text, guards against double-submit while streaming, and
//      surfaces a non-2xx response as an inline Helix error (the
//      off-mode-at-the-backend fallback path).
//
// react-i18next returns the English fallback (2nd arg to t()) when no
// provider is mounted, so button/label assertions match the default
// copy. getApiBase() returns '' under jsdom, so the fetch URL is the
// bare /api/v1 path. Network is fully mocked — no real requests.

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
import { AIBatteryHealthForecastNarrative } from '@/components/ai/AIBatteryHealthForecastNarrative'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const FEATURE_ID = 'battery-health-forecast-narrative'
const ROOT_TESTID = 'ai-feature-battery-health-forecast-narrative-root'
const NARRATE_URL = '/api/v1/ai/battery/health/narrate'

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

function narrateButton() {
  return screen.getByRole('button', { name: /Narrate forecast/i })
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

describe('AIBatteryHealthForecastNarrative — render gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    // The toggle is intentionally true to defeat the "hidden because
    // nothing is enabled" shortcut — mode=off must trump it.
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )

    const { container } = render(<AIBatteryHealthForecastNarrative vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is false even with mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )

    const { container } = render(<AIBatteryHealthForecastNarrative vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is undefined (settings not yet resolved)', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud' }))

    const { container } = render(<AIBatteryHealthForecastNarrative vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the gated section with the registered marker + copy when fully enabled (positive control)', () => {
    enableFeature()

    render(<AIBatteryHealthForecastNarrative vehicleId={7} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // Deterministic-forecast framing must be present so the user
    // understands the narrator only explains the numbers.
    expect(
      screen.getByText('Explain the battery health forecast'),
    ).toBeInTheDocument()
    expect(root).toHaveTextContent(/grounds every sentence in the same numbers/i)
    // The Helix badge rides in the header.
    expect(root).toHaveTextContent(/Helix/)
  })
})

describe('AIBatteryHealthForecastNarrative — vehicleId input guard', () => {
  it('disables the Narrate button when no vehicleId is resolved', () => {
    enableFeature()

    render(<AIBatteryHealthForecastNarrative />)

    expect(narrateButton()).toBeDisabled()
  })

  it('disables the Narrate button when vehicleId is 0 (parser requires > 0)', () => {
    enableFeature()

    render(<AIBatteryHealthForecastNarrative vehicleId={0} />)

    expect(narrateButton()).toBeDisabled()
  })

  it('disables the Narrate button when vehicleId is a non-numeric string', () => {
    enableFeature()

    render(<AIBatteryHealthForecastNarrative vehicleId="not-a-number" />)

    expect(narrateButton()).toBeDisabled()
  })

  it('enables the Narrate button once a positive vehicleId is present', () => {
    enableFeature()

    render(<AIBatteryHealthForecastNarrative vehicleId={7} />)

    expect(narrateButton()).not.toBeDisabled()
  })
})

describe('AIBatteryHealthForecastNarrative — stream wiring', () => {
  it('POSTs once to the narrate route with a numeric vehicle_id and renders the delta', async () => {
    enableFeature()

    const sseBody =
      sseFrame('delta', {
        text: 'State-of-health is 92%; frequent 100% charges are the dominant degradation driver.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 40, out: 12 } })
    const calls = installStreamingFetch(sseBody)

    render(<AIBatteryHealthForecastNarrative vehicleId={7} />)

    const button = narrateButton()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    // Exactly one request, against the bare /api/v1 path, POST with
    // the streaming Accept header and a numeric vehicle_id body.
    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(NARRATE_URL)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init?.body as string)).toEqual({ vehicle_id: 7 })

    // The accumulated delta renders inside the gated wrapper.
    await waitFor(() => {
      expect(
        screen.getByText(/State-of-health is 92%/),
      ).toBeInTheDocument()
    })
  })

  it('coerces a string vehicleId to a number in the POST body', async () => {
    enableFeature()

    const calls = installStreamingFetch(
      sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
    )

    render(<AIBatteryHealthForecastNarrative vehicleId="7" />)

    await act(async () => {
      fireEvent.click(narrateButton())
    })

    await waitFor(() => expect(calls).toHaveLength(1))
    const parsed = JSON.parse(calls[0].init?.body as string)
    // Not the string "7": the component coerces before building the body.
    expect(parsed).toEqual({ vehicle_id: 7 })
    expect(typeof parsed.vehicle_id).toBe('number')
  })

  it('ignores a second click while streaming (double-submit guard)', async () => {
    enableFeature()

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      // A stream that never enqueues/closes keeps state='streaming'.
      return new Response(
        new ReadableStream<Uint8Array>({ start() {} }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIBatteryHealthForecastNarrative vehicleId={7} />)

    const button = narrateButton()
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

    render(<AIBatteryHealthForecastNarrative vehicleId={7} />)

    await act(async () => {
      fireEvent.click(narrateButton())
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent(/stream_http_404/)
  })
})
