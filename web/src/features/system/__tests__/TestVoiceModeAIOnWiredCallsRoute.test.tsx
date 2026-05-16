// Phase-50 / 0055 — V1 Helix voice mode.
// Phase-50 / W1 inline wiring (per slice prompt 0055) — on-mode
// wiring test proving the "Speak to Helix" button opens an SSE
// stream against the registered backend route POST
// /api/v1/ai/voice/chat.
//
// `TestVoiceModeAIOnWiredCallsRoute` is the load-bearing
// positive wiring proof for slice 0055's W1 inline addendum. It
// mounts the AIVoiceMode component with ai_mode='cloud' + the
// per-feature toggle on, stubs the browser SpeechRecognition API
// with a deterministic transcript producer, stubs global fetch
// with a deterministic SSE byte stream, simulates a transcript
// being dictated, clicks the action button, and asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/voice/chat` is enqueued. The path MUST match
//      the registry entry verbatim — a typo here is invisible to
//      the off-mode test (which only asserts absence) and would
//      silently 404 in production.
//   2. The request body carries the dictated transcript as
//      `message` and a non-empty `session_id` (the backend's
//      WithScopedVoiceModeSession binding depends on this).
//   3. The first `delta` event's text renders inside the gated
//      wrapper `data-testid="ai-feature-voice-mode-root"`.
//   4. A second click while `state === 'streaming'` is a no-op —
//      the second fetch call is NOT enqueued (the double-submit
//      guard inside useAiStream + the AIFeatureCard disabled
//      mirror).
//   5. The existing off-mode test
//      (`TestVoiceModeAIOffNoVoiceControlsOrStorage`) continues
//      to pass unchanged — wiring MUST NOT regress the off-mode
//      absence invariant. That assertion lives in the sibling
//      file and is exercised independently by the npm runner.
//
// HX (Helix UX) addendum compliance:
//   - The CTA is located via `getByRole('button', { name:
//     /Speak to Helix/i })` — UNANCHORED regex because
//     AIFeatureCard composes the accessible name as
//     "Ask Helix · Speak to Helix". An anchored regex would not
//     match.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIVoiceMode } from '@/components/ai/AIVoiceMode'

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
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'hourly',
  critical_flash_enabled: true,
  tab_badge_enabled: true,
}

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } }
}

// makeReadableStream constructs a ReadableStream<Uint8Array>
// from arbitrarily-sized text chunks. Mirrors the helper used by
// useAiStream.test.ts so the parser receives byte-for-byte
// equivalent input.
function makeReadableStream(
  chunks: Array<string>,
): ReadableStream<Uint8Array> {
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

// ---------------------------------------------------------------
// SpeechRecognition stub. The production component feature-
// detects `window.SpeechRecognition` / `window.webkitSpeechRecognition`
// and tears down on .abort()/unmount. The stub mimics just enough
// of the API for the test to drive a "user dictates" event.
// ---------------------------------------------------------------
type RecogHandler = (ev: { resultIndex: number; results: unknown }) => void

let lastRecog: {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  fireResult: (text: string) => void
  fireEnd: () => void
} | null = null

class StubSpeechRecognition {
  continuous = false
  interimResults = false
  lang = ''
  onresult: RecogHandler | null = null
  onerror: ((ev: { error: string }) => void) | null = null
  onend: ((ev: Event) => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  constructor() {
    lastRecog = {
      start: this.start,
      stop: this.stop,
      abort: this.abort,
      fireResult: (text: string) => {
        if (!this.onresult) return
        this.onresult({
          resultIndex: 0,
          results: {
            length: 1,
            item: () => ({
              isFinal: true,
              length: 1,
              item: () => ({ transcript: text }),
              0: { transcript: text },
            }),
            0: {
              isFinal: true,
              length: 1,
              item: () => ({ transcript: text }),
              0: { transcript: text },
            },
          },
        })
      },
      fireEnd: () => {
        this.onend?.(new Event('end'))
      },
    }
  }
}

beforeEach(() => {
  mockUseSettings.mockReset()
  lastRecog = null
  ;(globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
    StubSpeechRecognition
  ;(globalThis as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
    StubSpeechRecognition
  // Stub speechSynthesis so the TTS plumbing inside the
  // delta handler does not throw in jsdom (which does not
  // implement the API natively).
  ;(window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    speak: vi.fn(),
    cancel: vi.fn(),
  }
  ;(window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    class {
      constructor(public text: string) {}
      lang = ''
      rate = 1
      pitch = 1
    }
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
  window.localStorage.removeItem('ai.voiceMode.transcriptDraft')
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as unknown as { SpeechRecognition?: unknown })
    .SpeechRecognition
  delete (globalThis as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition
  window.localStorage.removeItem('ai.voiceMode.transcriptDraft')
})

describe('TestVoiceModeAIOnWiredCallsRoute (voice-mode on-mode SPA wiring)', () => {
  it('TestVoiceModeAIOnWiredCallsRoute: dictating a transcript and clicking Speak to Helix POSTs once to /api/v1/ai/voice/chat and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'voice-mode': true },
      }),
    )

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'Your Model 3 is at 78 percent and not currently charging.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 64, out: 22 } })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    render(<AIVoiceMode />)

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId('ai-feature-voice-mode-root')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'voice-mode')

    // 2) Drive the mic: click Speak (starts SpeechRecognition),
    // then fire a synthetic result event with the transcript.
    const micButton = screen.getByTestId('ai-feature-voice-mode-mic-start')
    await act(async () => {
      fireEvent.click(micButton)
    })
    expect(lastRecog).not.toBeNull()
    expect(lastRecog?.start).toHaveBeenCalledTimes(1)
    await act(async () => {
      lastRecog!.fireResult('how full is my battery')
      lastRecog!.fireEnd()
    })

    // The transcript renders in the live region.
    const transcript = screen.getByTestId('ai-feature-voice-mode-transcript')
    expect(transcript).toHaveTextContent('how full is my battery')

    // 3) UNANCHORED regex per HX addendum — the accessible name
    // is "Ask Helix · Speak to Helix".
    const sendButton = screen.getByRole('button', {
      name: /Speak to Helix/i,
    })
    await waitFor(() => expect(sendButton).not.toBeDisabled())

    // 4) Click — fires the SSE stream against the registered
    // route.
    await act(async () => {
      fireEvent.click(sendButton)
    })

    // 5) Exactly one fetch must have been enqueued, against
    // the registered backend path with the expected body.
    await waitFor(() => expect(fetchCalls).toHaveLength(1))
    const { url, init } = fetchCalls[0]
    // useAiStream prepends `${getApiBase()}/api/v1`;
    // getApiBase returns '' in the test environment, so the
    // final URL is `/api/v1/ai/voice/chat`.
    expect(url).toBe('/api/v1/ai/voice/chat')
    expect(init?.method).toBe('POST')
    expect(typeof init?.body).toBe('string')
    const parsedBody = JSON.parse(init?.body as string)
    expect(parsedBody.message).toBe('how full is my battery')
    expect(typeof parsedBody.session_id).toBe('string')
    expect(parsedBody.session_id.length).toBeGreaterThan(0)
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    // 6) The first delta's text renders inside the gated
    // wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Your Model 3 is at 78 percent and not currently charging.',
      )
    })
  })

  it('TestVoiceModeAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'voice-mode': true },
      }),
    )

    // Stream that never closes so the component stays in
    // `streaming` for the duration of the test.
    let fetchCount = 0
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as unknown as typeof globalThis.fetch

    render(<AIVoiceMode />)

    // Dictate something so canStart flips true.
    const micButton = screen.getByTestId('ai-feature-voice-mode-mic-start')
    await act(async () => {
      fireEvent.click(micButton)
    })
    await act(async () => {
      lastRecog!.fireResult('what is my range')
      lastRecog!.fireEnd()
    })

    const sendButton = screen.getByRole('button', {
      name: /Speak to Helix/i,
    })
    await waitFor(() => expect(sendButton).not.toBeDisabled())

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(sendButton)
    })
    await waitFor(() => expect(fetchCount).toBe(1))

    // While streaming the button's disabled is COMPUTED from
    // canStart && state !== 'streaming'. The hook's runningRef
    // also coalesces duplicate start() calls, so the second
    // click is a defence-in-depth no-op even if a future
    // refactor accidentally drops the visual disabled.
    await waitFor(() => expect(sendButton).toBeDisabled())
    await act(async () => {
      // fireEvent.click bypasses the disabled attribute, which
      // lets us exercise the runningRef coalescer in
      // useAiStream directly.
      fireEvent.click(sendButton)
    })

    // Give any rogue fetch a microtask to land.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })
})
