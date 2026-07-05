// Behaviour + hardening coverage for the natural-language search
// surface (AINLSearch).
//
// The only export is the withAiFeature-wrapped component. Its
// behaviour has four distinct facets, all exercised here:
//
//   1. Render gate (ADR-015 AI-Off Contract). Off mode OR a
//      per-feature toggle of false OR an unresolved ai_features map
//      hides the surface entirely; the positive control proves the
//      gate is not trivially always-off.
//
//   2. Input guard. The Search button derives its disabled state from
//      `canStart = prompt.trim().length > 0`. This covers the empty /
//      whitespace-only / non-empty prompt branches, matching the
//      backend which trims and rejects an empty prompt with a 400
//      (internal/api/aisearch/handler.go).
//
//   3. Textarea a11y + control. The prompt textarea carries an
//      aria-label (accessible name), a placeholder, and a maxLength
//      matching the backend's maxPromptChars cap, and is a controlled
//      input that reflects typed text.
//
//   4. Stream wiring. Typing a prompt then clicking POSTs exactly once
//      to /api/v1/ai/search/query with ONLY a prompt field (the
//      handler deliberately does NOT accept a vehicle_id), renders the
//      accumulated delta text, guards against double-submit while
//      streaming, and surfaces a non-2xx response as an inline Helix
//      error (the off-mode-at-the-backend fallback).
//
// react-i18next returns the English fallback (2nd arg to t()) when no
// provider is mounted, so button/label assertions match the default
// copy. getApiBase() returns '' under jsdom, so the fetch URL is the
// bare /api/v1 path. Network is fully mocked — no real requests.
// @testing-library/user-event is intentionally NOT a dependency of
// this codebase (see web/package.json), so we drive interactions with
// fireEvent, consistent with every other SSE wiring test.

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
import { AINLSearch } from '@/components/ai/AINLSearch'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const FEATURE_ID = 'nl-search'
const ROOT_TESTID = 'ai-feature-nl-search-root'
const QUERY_URL = '/api/v1/ai/search/query'

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

function searchButton() {
  return screen.getByRole('button', { name: /Search with Helix/i })
}

function promptInput() {
  return screen.getByRole('textbox', { name: /Search query/i })
}

// renderReady mounts the enabled surface and types a prompt so the
// Search button is enabled and ready to fire.
function renderReady(
  promptText = 'drives last weekend over 200 km with phantom drain',
) {
  const utils = render(<AINLSearch />)
  fireEvent.change(promptInput(), { target: { value: promptText } })
  return { ...utils, promptText }
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

describe('AINLSearch — render gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    // The toggle is intentionally true to defeat the "hidden because
    // nothing is enabled" shortcut — mode=off must trump it.
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )

    const { container } = render(<AINLSearch />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is false even with mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )

    const { container } = render(<AINLSearch />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is undefined (settings not yet resolved)', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud' }))

    const { container } = render(<AINLSearch />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with the registered marker + copy when fully enabled (positive control)', () => {
    enableFeature()

    render(<AINLSearch />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // Title + description framing so the user understands what the
    // search surface does.
    expect(screen.getByText('Search with natural language')).toBeInTheDocument()
    expect(root).toHaveTextContent(/surface drives, charging sessions, and alerts/)
    // The Helix badge rides in the header.
    expect(root).toHaveTextContent(/Helix/)
  })
})

describe('AINLSearch — prompt input guard', () => {
  it('disables the Search button and shows the empty hint when the prompt is empty', () => {
    enableFeature()

    render(<AINLSearch />)

    const button = searchButton()
    expect(button).toBeDisabled()
    // The disabled state is a COMPUTED expression mirrored into
    // aria-disabled for screen-reader parity (never a literal
    // disabled={true}).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // Empty-state affordance guides the user on what is missing.
    expect(
      screen.getByText(/Type a question above to search/i),
    ).toBeInTheDocument()
  })

  it('disables the Search button when the prompt is only whitespace (trim branch)', () => {
    enableFeature()

    render(<AINLSearch />)
    fireEvent.change(promptInput(), { target: { value: '   \n\t ' } })

    expect(searchButton()).toBeDisabled()
    expect(searchButton()).toHaveAttribute('aria-disabled', 'true')
  })

  it('enables the Search button and hides the empty hint once a prompt is present', () => {
    enableFeature()

    render(<AINLSearch />)
    fireEvent.change(promptInput(), { target: { value: 'charging sessions over 50 kWh' } })

    const button = searchButton()
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    expect(
      screen.queryByText(/Type a question above to search/i),
    ).not.toBeInTheDocument()
  })
})

describe('AINLSearch — prompt textarea a11y + control', () => {
  it('exposes an accessible name, placeholder, and the backend prompt cap on the textarea', () => {
    enableFeature()

    render(<AINLSearch />)

    const textarea = promptInput()
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute(
      'placeholder',
      expect.stringMatching(/phantom drain/i),
    )
    // maxLength mirrors maxPromptChars (4096) so an oversized paste
    // cannot produce a guaranteed backend 400.
    expect(textarea).toHaveAttribute('maxlength', '4096')
  })

  it('reflects typed text as a controlled input', () => {
    enableFeature()

    render(<AINLSearch />)

    const textarea = promptInput() as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'alerts from last Tuesday' } })
    expect(textarea.value).toBe('alerts from last Tuesday')
  })
})

describe('AINLSearch — stream wiring', () => {
  it('POSTs once to the search route with ONLY a prompt (no vehicle_id) and renders the delta', async () => {
    enableFeature()

    const sseBody =
      sseFrame('delta', {
        text: 'Found 3 drives last weekend over 200 km, including "Coastal loop" with notable phantom drain overnight.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 30 } })
    const calls = installStreamingFetch(sseBody)

    const { promptText } = renderReady()

    const button = searchButton()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    // Exactly one request, against the bare /api/v1 path, POST with the
    // streaming Accept header and a prompt-only body.
    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(QUERY_URL)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')
    const parsed = JSON.parse(init?.body as string)
    // The backend handler deliberately accepts ONLY a prompt field —
    // asserting deep equality guards against a vehicle_id (or any
    // other key) leaking back into the request shape.
    expect(parsed).toEqual({ prompt: promptText })
    expect(parsed.vehicle_id).toBeUndefined()

    // The accumulated delta renders inside the gated wrapper.
    await waitFor(() => {
      expect(screen.getByText(/Found 3 drives last weekend/)).toBeInTheDocument()
    })
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

    renderReady()

    const button = searchButton()
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

    renderReady()

    await act(async () => {
      fireEvent.click(searchButton())
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent(/stream_http_404/)
  })
})
