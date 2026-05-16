// Phase-50 / 0056 — V2 Helix watch face natural-language response.
// Phase-50 / W1 inline wiring (per slice prompt 0056) — on-mode
// wiring test proving the Ask button opens an SSE stream against
// the registered backend route POST /api/v1/ai/watch/respond.
//
// `TestWatchFaceNlResponseAIOnWiredCallsRoute` is the
// load-bearing positive wiring proof for slice 0056 V2's W1
// inline addendum. It mounts the AIWatchFaceNLResponse component
// with ai_mode='cloud' + the per-feature toggle on, stubs
// global fetch with a deterministic SSE byte stream, clicks the
// Ask button, and asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/watch/respond` is enqueued with
//      `Content-Type: application/json` and a body shape the
//      Go-side handler parser accepts. The path MUST match the
//      registry entry verbatim — a typo here is invisible to the
//      off-mode test (which only asserts absence) and would
//      silently 404 in production.
//   2. The first `delta` event's text renders inside the gated
//      wrapper `data-testid="ai-feature-watch-face-nl-response-root"`.
//   3. A second click while `state === 'streaming'` is a no-op —
//      the second fetch call is NOT enqueued (the double-submit
//      guard inside useAiStream + the visual `disabled` mirror it
//      from canStart). This proves W1 Rule A — the disabled prop
//      is a computed expression that reacts to state.
//   4. With an empty message, the body POSTed is `{}` (the
//      handler's deterministic "give a glance summary" default
//      prompt path). This is the most common case the SPA needs
//      to support (one-click summary, no typing required).
//
// The off-mode invariant test
// (`TestWatchFaceNLAIOffUsesFixedCardsOnly`) lives in the
// sibling file and is exercised independently by the npm test
// runner; wiring MUST NOT regress that absence invariant.
//
// The test name MUST stay
// `TestWatchFaceNlResponseAIOnWiredCallsRoute` per the W1
// inline addendum naming contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIWatchFaceNLResponse } from '@/components/ai/AIWatchFaceNLResponse'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

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

beforeEach(() => {
  mockUseSettings.mockReset()
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TestWatchFaceNlResponseAIOnWiredCallsRoute (watch-face-nl-response on-mode SPA wiring)', () => {
  it('TestWatchFaceNlResponseAIOnWiredCallsRoute: typing a question + clicking Ask POSTs once to /api/v1/ai/watch/respond and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'watch-face-nl-response': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text:
          'Battery is at 82 percent with about 225 miles of range. The car is locked and sentry is off.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 120, out: 40 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIWatchFaceNLResponse />)

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId('ai-feature-watch-face-nl-response-root')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'watch-face-nl-response')

    // 2) Type a question into the textarea.
    const textarea = screen.getByLabelText(/Your question for Helix/i)
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: 'how is my battery doing?' },
      })
    })

    // 3) Click — fires the SSE stream against the registered route.
    const button = screen.getByRole('button', { name: /Ask about my car/i })
    expect(button).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(button)
    })

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path.
    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    expect(url).toBe('/api/v1/ai/watch/respond')
    expect(init?.method).toBe('POST')
    // The body must contain the typed message — proves the
    // component is feeding the handler-side parser the same
    // shape the Go test exercises.
    expect(typeof init?.body).toBe('string')
    const parsedBody = JSON.parse(init?.body as string)
    expect(parsedBody).toEqual({ message: 'how is my battery doing?' })
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // 5) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Battery is at 82 percent with about 225 miles of range. The car is locked and sentry is off.',
      )
    })
  })

  it('TestWatchFaceNlResponseAIOnWiredCallsRoute: clicking Ask with an empty message POSTs {} (default-summary path)', async () => {
    // The watch surface is glance-style — the user often wants
    // a one-click summary with no typing. The component sends
    // `{}` in that case and the Go handler applies its
    // deterministic "give a glance summary" default prompt.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'watch-face-nl-response': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody = sseFrame('done', { finish_reason: 'stop' })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIWatchFaceNLResponse />)

    // Empty message — button is ENABLED (the backend applies a
    // default summary prompt; the UX matches a glance-style
    // single-tap surface).
    const button = screen.getByRole('button', { name: /Ask about my car/i })
    expect(button).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const parsedBody = JSON.parse(fetchCalls[0].init?.body as string)
    expect(parsedBody).toEqual({})
  })

  it('TestWatchFaceNlResponseAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'watch-face-nl-response': true },
      }),
    )

    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close — keeps state='streaming'.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIWatchFaceNLResponse />)

    const button = screen.getByRole('button', { name: /Ask about my car/i })

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the AIFeatureCard mirrors state into the
    // button's disabled attribute. The hook's `runningRef` also
    // coalesces duplicate start() calls, so the second click is a
    // defence-in-depth no-op even if a future refactor accidentally
    // drops the visual disabled.
    await waitFor(() => expect(button).toBeDisabled())
    await act(async () => {
      fireEvent.click(button)
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })
})
