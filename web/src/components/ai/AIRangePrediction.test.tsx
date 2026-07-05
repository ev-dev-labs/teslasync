// Comprehensive unit tests for AIRangePrediction.
//
// This file elevates the ML2 range-prediction AI surface. It covers
// BOTH exports of the source module:
//
//   1. canPredictRange — the pure predicate that gates both the request
//      body's vehicle_id and the "Train range model" button's enabled
//      state. Proves the bug fix: `undefined`, `0` (the `?? 0` body
//      sentinel), negatives, and non-finite ids all collapse to `false`
//      (so no training request can fire for a non-vehicle, which the
//      backend rejects with a 400 "vehicle_id is required and must be
//      > 0"), while any real positive id yields `true`.
//
//   2. AIRangePrediction — the withAiFeature-gated component:
//        • AI-off contract (off mode / per-feature-off / missing flag /
//          unresolved settings all render nothing — fail-closed; a
//          cloud + toggle-on positive control proves the negatives are
//          not trivially true).
//        • canStart guarding (button disabled for undefined / 0 /
//          negative ids, enabled for a real id) with aria-disabled
//          parity, and no network fire while disabled.
//        • stream wiring (clicking POSTs once to the registered
//          /api/v1/ai/ml/range/train route with the in-scope vehicle_id
//          + the default 14-day learning window and an SSE Accept
//          header; the first delta renders in the output panel).
//        • double-submit guard + failure path (non-2xx → Helix error).
//        • exported displayName metadata.
//
// react-i18next's useTranslation returns the second argument (English
// fallback) when no provider is mounted, so no i18n setup is needed —
// the same convention the sibling AI tests rely on. A file-level
// vi.mock('@/hooks/useSettings') takes precedence over the global stub
// in src/test-setup.ts, letting each test drive ai_mode / ai_features.
// @testing-library/user-event is intentionally NOT a dependency of this
// codebase (see web/package.json), so we use fireEvent.click for all
// interactions — the convention every sibling AI wiring test follows.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIRangePrediction, canPredictRange } from './AIRangePrediction'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// A complete AppSettings with realistic non-AI defaults. Per-test cases
// override `ai_mode` + `ai_features` to exercise the gate.
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

// enabled() is the common "feature fully on" settings state used by the
// interaction tests.
function enabled(mode: 'local' | 'cloud' = 'cloud') {
  return settingsPayload({
    ai_mode: mode,
    ai_features: { 'range-prediction-model': true },
  })
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// text chunks — mirrors useAiStream.test.ts so the parser receives
// byte-for-byte equivalent input.
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

// sseFrame formats a single SSE event the way
// internal/ai/stream/writer.go emits it.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// The action button's accessible name is the universal Helix CTA plus
// the per-feature label ("Ask Helix · Train range model"), so this
// regex locates it whether idle or streaming (aria-label is static).
const TRAIN_BUTTON = { name: /Train range model/i }
const ROOT_TESTID = 'ai-feature-range-prediction-model-root'

beforeEach(() => {
  mockUseSettings.mockReset()
  mockUseSettings.mockReturnValue(enabled())
  // Fail loudly if a test triggers the network without arranging a mock.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('canPredictRange', () => {
  it('collapses every "no real vehicle" input to false', () => {
    expect(canPredictRange(undefined)).toBe(false)
    expect(canPredictRange(0)).toBe(false)
    expect(canPredictRange(-1)).toBe(false)
    expect(canPredictRange(-42)).toBe(false)
    // -0 is not > 0.
    expect(canPredictRange(-0)).toBe(false)
  })

  it('rejects non-finite ids (defends the body sentinel against NaN/Infinity)', () => {
    expect(canPredictRange(Number.NaN)).toBe(false)
    expect(canPredictRange(Number.POSITIVE_INFINITY)).toBe(false)
    expect(canPredictRange(Number.NEGATIVE_INFINITY)).toBe(false)
  })

  it('accepts any real positive vehicle id (mirrors the backend vehicle_id > 0 contract)', () => {
    expect(canPredictRange(1)).toBe(true)
    expect(canPredictRange(42)).toBe(true)
    expect(canPredictRange(999999)).toBe(true)
  })
})

describe('AIRangePrediction — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the range-prediction-model toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'range-prediction-model': true },
      }),
    )

    const { container } = render(<AIRangePrediction vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode is non-off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'range-prediction-model': false },
      }),
    )

    const { container } = render(<AIRangePrediction vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the range-prediction-model flag is entirely absent from ai_features', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'local', ai_features: {} }),
    )

    const { container } = render(<AIRangePrediction vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing (fail-closed) when the settings query has not resolved yet', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AIRangePrediction vehicleId={42} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with title, description, badge and CTA when fully enabled (positive control)', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIRangePrediction vehicleId={42} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'range-prediction-model')
    // Heading + description prove the card is fully wired, not a stub.
    expect(
      screen.getByRole('heading', { name: /Learn per-vehicle range model/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/static heuristic curve the projection uses today/i),
    ).toBeInTheDocument()
    // Helix badge text renders inside the gated root.
    expect(root).toHaveTextContent(/Helix/)
    expect(screen.getByRole('button', TRAIN_BUTTON)).toBeInTheDocument()
  })
})

describe('AIRangePrediction — canStart guarding', () => {
  it('enables the CTA for a real vehicle id and mirrors aria-disabled=false', () => {
    render(<AIRangePrediction vehicleId={42} />)

    const button = screen.getByRole('button', TRAIN_BUTTON)
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it('disables the CTA when vehicleId is undefined', () => {
    render(<AIRangePrediction />)

    const button = screen.getByRole('button', TRAIN_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the CTA for the 0 sentinel (bug fix — would POST vehicle_id:0 and 400)', () => {
    render(<AIRangePrediction vehicleId={0} />)

    const button = screen.getByRole('button', TRAIN_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the CTA for a negative vehicleId (bug fix — would POST a non-positive id)', () => {
    render(<AIRangePrediction vehicleId={-5} />)

    expect(screen.getByRole('button', TRAIN_BUTTON)).toBeDisabled()
  })

  it('does not fire the network when the CTA is disabled', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    render(<AIRangePrediction vehicleId={0} />)
    const button = screen.getByRole('button', TRAIN_BUTTON)
    await act(async () => {
      fireEvent.click(button)
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AIRangePrediction — stream wiring', () => {
  it('POSTs once to /api/v1/ai/ml/range/train with the vehicle_id + default 14-day window and renders the first delta', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'Mild/highway bucket learned 178 Wh/km from 22 drives; cold/highway falls back to the linear projection.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 12 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    render(<AIRangePrediction vehicleId={42} />)
    const button = screen.getByRole('button', TRAIN_BUTTON)
    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/ml/range/train')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ vehicle_id: 42, days: 14 })
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Mild\/highway bucket learned 178 Wh\/km from 22 drives/,
      )
    })
  })

  it('guards against double-submit while a stream is in flight', async () => {
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      // Never enqueue, never close — keeps state='streaming'.
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            /* held open */
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIRangePrediction vehicleId={42} />)
    const button = screen.getByRole('button', TRAIN_BUTTON)

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))
    // While streaming the CTA disables itself (computed from stream state).
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      // fireEvent bypasses the disabled attribute, exercising the
      // runningRef coalescer inside useAiStream directly.
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces a Helix error in the output panel when the stream responds non-2xx', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AIRangePrediction vehicleId={42} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', TRAIN_BUTTON))
    })

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })
})

describe('AIRangePrediction — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AIRangePrediction.displayName).toBe('AIRangePrediction')
  })
})
