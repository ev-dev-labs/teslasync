// Behaviour + hardening coverage for the natural-language alert
// builder (AINLAlertBuilder).
//
// The only export is the withAiFeature-wrapped component. Its
// behaviour has four distinct facets, all exercised here:
//
//   1. Render gate (ADR-015 AI-Off Contract). Off mode OR a
//      per-feature toggle of false OR an unresolved ai_features map
//      hides the surface entirely; the positive control proves the
//      gate is not trivially always-off.
//
//   2. Input guard. The Draft button derives its disabled state from
//      `canStart = vehicleId != null && vehicleId > 0 &&
//      prompt.trim().length > 0`. This covers the undefined / zero /
//      negative vehicleId branches AND the empty / whitespace-only /
//      non-empty prompt branches. The `> 0` guard is the fix for the
//      real bug where a `vehicleId={0}` used to be submittable even
//      though the backend rejects `vehicle_id <= 0` with a 400
//      (internal/api/aialert/handler.go).
//
//   3. Textarea a11y + control. The prompt textarea carries an
//      aria-label (accessible name), a placeholder, and a maxLength
//      matching the backend's builderMaxPromptChars cap, and is a
//      controlled input that reflects typed text.
//
//   4. Stream wiring. Typing a prompt then clicking POSTs exactly once
//      to /api/v1/ai/alerts/rules/draft with a numeric vehicle_id and
//      the prompt, renders the accumulated delta text, guards against
//      double-submit while streaming, and surfaces a non-2xx response
//      as an inline Helix error (the off-mode-at-the-backend fallback).
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
import { AINLAlertBuilder } from '@/components/ai/AINLAlertBuilder'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const FEATURE_ID = 'nl-alert-builder'
const ROOT_TESTID = 'ai-feature-nl-alert-builder-root'
const DRAFT_URL = '/api/v1/ai/alerts/rules/draft'

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

function draftButton() {
  return screen.getByRole('button', { name: /Draft alert/i })
}

function promptInput() {
  return screen.getByRole('textbox', { name: /Alert description/i })
}

// renderReady mounts the enabled surface for the given vehicleId and
// types a prompt so the Draft button is enabled and ready to fire.
function renderReady(
  vehicleId = 7,
  promptText = 'alert me when tire pressure drops below 30 psi',
) {
  const utils = render(<AINLAlertBuilder vehicleId={vehicleId} />)
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

describe('AINLAlertBuilder — render gate (ADR-015)', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    // The toggle is intentionally true to defeat the "hidden because
    // nothing is enabled" shortcut — mode=off must trump it.
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { [FEATURE_ID]: true } }),
    )

    const { container } = render(<AINLAlertBuilder vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the per-feature toggle is false even with mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { [FEATURE_ID]: false } }),
    )

    const { container } = render(<AINLAlertBuilder vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when ai_features is undefined (settings not yet resolved)', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud' }))

    const { container } = render(<AINLAlertBuilder vehicleId={7} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders the gated section with the registered marker + copy when fully enabled (positive control)', () => {
    enableFeature()

    render(<AINLAlertBuilder vehicleId={7} />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID)
    // Title + description framing so the user understands the surface
    // only drafts a rule they still review and save.
    expect(screen.getByText('Draft from natural language')).toBeInTheDocument()
    expect(root).toHaveTextContent(/typed AlertRule draft you can review and save/)
    // The Helix badge rides in the header.
    expect(root).toHaveTextContent(/Helix/)
  })
})

describe('AINLAlertBuilder — vehicleId + prompt input guard', () => {
  it('disables the Draft button and shows the empty hint when no vehicleId is resolved', () => {
    enableFeature()

    render(<AINLAlertBuilder />)

    const button = draftButton()
    expect(button).toBeDisabled()
    // The disabled state is a COMPUTED expression mirrored into
    // aria-disabled for screen-reader parity (never a literal
    // disabled={true}).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    // Empty-state affordance guides the user on what is missing.
    expect(
      screen.getByText(/Choose a vehicle and describe the alert/i),
    ).toBeInTheDocument()
  })

  it('disables the Draft button when vehicleId is 0 (backend requires > 0)', () => {
    // Regression guard: the previous `vehicleId != null` check let a
    // zero id through, which the handler rejects with a 400.
    enableFeature()

    render(<AINLAlertBuilder vehicleId={0} />)
    // Even with a non-empty prompt, a zero vehicleId must stay disabled.
    fireEvent.change(promptInput(), { target: { value: 'alert me on low tire pressure' } })

    expect(draftButton()).toBeDisabled()
    expect(draftButton()).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the Draft button when vehicleId is negative', () => {
    enableFeature()

    render(<AINLAlertBuilder vehicleId={-5} />)
    fireEvent.change(promptInput(), { target: { value: 'alert me on low tire pressure' } })

    expect(draftButton()).toBeDisabled()
  })

  it('disables the Draft button when the prompt is empty even with a valid vehicleId', () => {
    enableFeature()

    render(<AINLAlertBuilder vehicleId={7} />)

    expect(draftButton()).toBeDisabled()
  })

  it('disables the Draft button when the prompt is only whitespace (trim branch)', () => {
    enableFeature()

    render(<AINLAlertBuilder vehicleId={7} />)
    fireEvent.change(promptInput(), { target: { value: '    \n\t ' } })

    expect(draftButton()).toBeDisabled()
  })

  it('enables the Draft button and hides the empty hint once a vehicleId + prompt are present', () => {
    enableFeature()

    render(<AINLAlertBuilder vehicleId={7} />)
    fireEvent.change(promptInput(), { target: { value: 'alert me when SOC drops below 20%' } })

    const button = draftButton()
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    expect(
      screen.queryByText(/Choose a vehicle and describe the alert/i),
    ).not.toBeInTheDocument()
  })
})

describe('AINLAlertBuilder — prompt textarea a11y + control', () => {
  it('exposes an accessible name, placeholder, and the backend prompt cap on the textarea', () => {
    enableFeature()

    render(<AINLAlertBuilder vehicleId={7} />)

    const textarea = promptInput()
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute('placeholder', expect.stringMatching(/battery cell voltage spread/i))
    // maxLength mirrors builderMaxPromptChars (4096) so an oversized
    // paste cannot produce a guaranteed backend 400.
    expect(textarea).toHaveAttribute('maxlength', '4096')
  })

  it('reflects typed text as a controlled input', () => {
    enableFeature()

    render(<AINLAlertBuilder vehicleId={7} />)

    const textarea = promptInput() as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'notify me when charging stalls' } })
    expect(textarea.value).toBe('notify me when charging stalls')
  })
})

describe('AINLAlertBuilder — stream wiring', () => {
  it('POSTs once to the draft route with a numeric vehicle_id + prompt and renders the delta', async () => {
    enableFeature()

    const sseBody =
      sseFrame('delta', {
        text: 'Drafted AlertRule: trigger when tire pressure falls below 30 psi with warning severity.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 60, out: 20 } })
    const calls = installStreamingFetch(sseBody)

    renderReady(7, 'alert me when tire pressure drops below 30 psi')

    const button = draftButton()
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    // Exactly one request, against the bare /api/v1 path, POST with the
    // streaming Accept header and a numeric vehicle_id + prompt body.
    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe(DRAFT_URL)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')
    const parsed = JSON.parse(init?.body as string)
    expect(parsed).toEqual({
      vehicle_id: 7,
      prompt: 'alert me when tire pressure drops below 30 psi',
    })
    expect(typeof parsed.vehicle_id).toBe('number')

    // The accumulated delta renders inside the gated wrapper.
    await waitFor(() => {
      expect(screen.getByText(/Drafted AlertRule/)).toBeInTheDocument()
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

    renderReady(7)

    const button = draftButton()
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

    renderReady(7)

    await act(async () => {
      fireEvent.click(draftButton())
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent(/stream_http_404/)
  })
})
