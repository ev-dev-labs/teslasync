// Comprehensive unit tests for AIVehiclePaintPreview.
//
// This file elevates the vehicle-paint-preview AI surface. The module
// has a single export — the withAiFeature-gated component — so every
// test here exercises that component through its full behaviour matrix:
//
//   • AI-off contract gate: off mode / per-feature-off render nothing;
//     cloud + toggle-on renders the gated section (positive control so
//     the negative assertions aren't trivially true).
//   • vehicleId guarding (canStart): the CTA is disabled — and the
//     empty-state hint shown — for undefined / 0 / negative / NaN /
//     fractional ids, and enabled (aria-disabled=false, no hint) for a
//     real positive-integer id. The fractional case is the bug-fix
//     guard: a `7.5` id previously slipped through Number.isFinite and
//     would POST a malformed /ai/vehicles/7.5/... route.
//   • stream wiring: clicking POSTs exactly once to the registered
//     SI-clean route with the SSE Accept header; the optional styleHint
//     is trimmed into the body's `style_hint` (and omitted when blank);
//     the first delta renders in the output panel.
//   • double-submit guard + failure path (non-2xx → Helix error).
//   • exported displayName metadata.
//
// react-i18next's useTranslation returns the second argument (English
// fallback) when no provider is mounted, so no i18n setup is needed —
// the same convention the sibling AI tests rely on. @testing-library/
// user-event is intentionally NOT a dependency of this codebase (see
// web/package.json), so interactions use fireEvent.click, matching
// every sibling AI feature test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIVehiclePaintPreview } from './AIVehiclePaintPreview'

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
function enabled() {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { 'vehicle-paint-preview': true },
  })
}

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

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// The action button's accessible name is the universal Helix CTA plus
// the per-feature label ("Ask Helix · Preview paint color"), so this
// UNANCHORED regex locates it whether idle or streaming (aria-label is
// static and composed by AIFeatureCard).
const PREVIEW_BUTTON = { name: /Preview paint color/i }

const ROOT_TESTID = 'ai-feature-vehicle-paint-preview-root'
const NO_VEHICLE_HINT = /Open a vehicle detail page to enable Helix/i

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

describe('AIVehiclePaintPreview — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the vehicle-paint-preview toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'vehicle-paint-preview': true },
      }),
    )

    const { container } = render(<AIVehiclePaintPreview vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_mode is non-off but the per-feature toggle is false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'vehicle-paint-preview': false },
      }),
    )

    const { container } = render(<AIVehiclePaintPreview vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with title, description, badge and CTA when fully enabled (positive control)', () => {
    mockUseSettings.mockReturnValue(enabled())

    render(<AIVehiclePaintPreview vehicleId={7} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'vehicle-paint-preview')
    // Heading + description prove the card is fully wired, not a stub.
    expect(
      screen.getByRole('heading', { name: /Draft a Helix paint preview/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/propose-only paint-color image prompt/i),
    ).toBeInTheDocument()
    // Helix brand badge renders inside the gated root.
    expect(root).toHaveTextContent(/Helix/)
    expect(screen.getByRole('button', PREVIEW_BUTTON)).toBeInTheDocument()
    // No stream has started yet, so the output panel must be absent —
    // proves output is not rendered prematurely.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
  })
})

describe('AIVehiclePaintPreview — vehicleId (canStart) guarding', () => {
  it('enables the CTA for a real integer vehicleId and mirrors aria-disabled=false with no empty hint', () => {
    render(<AIVehiclePaintPreview vehicleId={7} />)

    const button = screen.getByRole('button', PREVIEW_BUTTON)
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    // The empty-state hint is suppressed once a vehicle is resolved.
    expect(screen.queryByText(NO_VEHICLE_HINT)).not.toBeInTheDocument()
  })

  it('disables the CTA and shows the empty hint when vehicleId is undefined', () => {
    render(<AIVehiclePaintPreview />)

    const button = screen.getByRole('button', PREVIEW_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
  })

  it('disables the CTA for the 0 placeholder id (would POST /ai/vehicles/0/…)', () => {
    render(<AIVehiclePaintPreview vehicleId={0} />)

    expect(screen.getByRole('button', PREVIEW_BUTTON)).toBeDisabled()
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
  })

  it('disables the CTA for a negative vehicleId', () => {
    render(<AIVehiclePaintPreview vehicleId={-3} />)

    expect(screen.getByRole('button', PREVIEW_BUTTON)).toBeDisabled()
  })

  it('disables the CTA for a NaN vehicleId', () => {
    render(<AIVehiclePaintPreview vehicleId={Number.NaN} />)

    expect(screen.getByRole('button', PREVIEW_BUTTON)).toBeDisabled()
  })

  it('disables the CTA for a fractional vehicleId (bug fix — a "7.5" id would POST a malformed /ai/vehicles/7.5/… route)', () => {
    render(<AIVehiclePaintPreview vehicleId={7.5} />)

    const button = screen.getByRole('button', PREVIEW_BUTTON)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(NO_VEHICLE_HINT)).toBeInTheDocument()
  })

  it('does not fire the network when the CTA is disabled (no vehicleId)', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('should not be called')
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    render(<AIVehiclePaintPreview />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', PREVIEW_BUTTON))
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AIVehiclePaintPreview — stream wiring', () => {
  it('POSTs once to /api/v1/ai/vehicles/7/paint-preview/draft with an empty body + SSE Accept header and renders the first delta', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'Drafted a midnight-blue paint-preview prompt in a cinematic studio scene.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 24 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    render(<AIVehiclePaintPreview vehicleId={7} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', PREVIEW_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    // getApiBase() returns '' in the test environment, so the final URL
    // is the bare registered route.
    expect(url).toBe('/api/v1/ai/vehicles/7/paint-preview/draft')
    expect(init?.method).toBe('POST')
    // No styleHint → empty JSON object; the vehicleID travels via the
    // URL path, not the body.
    expect(JSON.parse(init?.body as string)).toEqual({})
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /Drafted a midnight-blue paint-preview prompt/i,
      )
    })
  })

  it('trims a padded styleHint into the request body under the snake_case style_hint key', async () => {
    const fetchCalls: Array<RequestInit | undefined> = []
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push(init)
        return new Response(
          makeReadableStream([
            sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      },
    ) as unknown as typeof globalThis.fetch

    render(<AIVehiclePaintPreview vehicleId={7} styleHint="  studio  " />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', PREVIEW_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    expect(JSON.parse(fetchCalls[0]?.body as string)).toEqual({
      style_hint: 'studio',
    })
  })

  it('omits style_hint from the body when styleHint is whitespace-only', async () => {
    const fetchCalls: Array<RequestInit | undefined> = []
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push(init)
        return new Response(
          makeReadableStream([
            sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        )
      },
    ) as unknown as typeof globalThis.fetch

    render(<AIVehiclePaintPreview vehicleId={7} styleHint="   " />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', PREVIEW_BUTTON))
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const parsed = JSON.parse(fetchCalls[0]?.body as string)
    expect(parsed).toEqual({})
    expect(parsed).not.toHaveProperty('style_hint')
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

    render(<AIVehiclePaintPreview vehicleId={7} />)
    const button = screen.getByRole('button', PREVIEW_BUTTON)

    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))
    // While streaming the CTA disables itself (computed from state).
    await waitFor(() => expect(button).toBeDisabled())

    await act(async () => {
      fireEvent.click(button)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })

  it('surfaces a Helix error in the output panel when the stream responds non-2xx', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof globalThis.fetch

    render(<AIVehiclePaintPreview vehicleId={7} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', PREVIEW_BUTTON))
    })

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel')
      expect(panel).toHaveTextContent(/Helix error/i)
      expect(panel).toHaveTextContent(/stream_http_404/)
    })
  })
})

describe('AIVehiclePaintPreview — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AIVehiclePaintPreview.displayName).toBe('AIVehiclePaintPreview')
  })
})
