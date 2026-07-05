// Co-located Project Apex elevation suite for AIVoiceMode.
//
// The module exposes a single runtime export: `AIVoiceMode`, an
// InnerSection wrapped with `withAiFeature('voice-mode', …)`. It layers
// browser SpeechRecognition (STT) and speechSynthesis (TTS) on top of
// the shared `useAiStream` SSE pipeline. The facets worth exercising:
//
//   - the ADR-015 AI-off visibility gate (off-mode hides the whole
//     subtree; the positive control proves the gate is real);
//   - the STT transcript contract: interim results are a live PREVIEW
//     and MUST NOT be folded into the committed transcript (the
//     regression guard for the interim-duplication bug), only FINAL
//     results are committed, and successive final utterances join with a
//     single space;
//   - the `canStart` / empty-state contract: the CTA is disabled with a
//     hint until a final transcript exists, and interim-only text does
//     not enable it;
//   - the SSE send wiring (exactly one POST to /api/v1/ai/voice/chat
//     with `{ message, session_id }` + SSE headers, first delta rendered);
//   - the TTS chunker: complete sentences are spoken as deltas stream in
//     and the trailing fragment is flushed on `done`; muting cancels
//     in-flight speech and silences subsequent deltas;
//   - error + unsupported states (an STT error surfaces + resets the mic;
//     an absent SpeechRecognition ctor disables the mic and shows a hint);
//   - stop-all, draft persistence (persist while idle, clear after a
//     completed send, restore on mount, wipe on unmount), and the stable
//     public surface (displayName).
//
// Network is mocked at the `fetch` boundary and the browser speech APIs
// are stubbed — no real device/network is touched. `@testing-library/
// user-event` is intentionally not a dependency of this repo, so
// interactions use `fireEvent`, consistent with the sibling AI tests.
// react-i18next returns the English fallback (2nd arg) with no provider
// mounted, so assertions read the defaults.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
  cleanup,
} from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIVoiceMode } from '@/components/ai/AIVoiceMode'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

const TRANSCRIPT_DRAFT_KEY = 'ai.voiceMode.transcriptDraft'

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

// enabledSettings is the fully-on shape (mode + per-feature toggle) so
// the on-mode tests read one intent-revealing helper.
function enabledSettings(overrides: Partial<AppSettings> = {}) {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { 'voice-mode': true },
    ...overrides,
  })
}

// ── SSE helpers (byte-for-byte identical to the writer + sibling tests) ──
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

// ── SpeechRecognition stub ──────────────────────────────────────────────
// A flexible stand-in for the vendor-prefixed browser API. Unlike the
// single-shot sibling stub, `emit` accepts a batch of {transcript,
// isFinal} results so a test can drive the interim→final revision cycle
// that surfaces the duplication bug.
interface AltLike {
  transcript: string
}
interface ResultLike {
  isFinal: boolean
  length: number
  item(i: number): AltLike
  [index: number]: AltLike
}
interface ResultsLike {
  length: number
  item(i: number): ResultLike
  [index: number]: ResultLike
}
interface ResultEventLike {
  resultIndex: number
  results: ResultsLike
}
type ResultSpec = { transcript: string; isFinal: boolean }

function makeResult(spec: ResultSpec): ResultLike {
  const alt: AltLike = { transcript: spec.transcript }
  return {
    isFinal: spec.isFinal,
    length: 1,
    item: () => alt,
    0: alt,
  } as unknown as ResultLike
}

function buildResults(specs: ResultSpec[]): ResultsLike {
  const built: Record<string | number, unknown> = {
    length: specs.length,
    item: (i: number) => makeResult(specs[i]),
  }
  specs.forEach((s, i) => {
    built[i] = makeResult(s)
  })
  return built as unknown as ResultsLike
}

const recognitions: StubSpeechRecognition[] = []

class StubSpeechRecognition {
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((ev: ResultEventLike) => void) | null = null
  onerror: ((ev: { error: string }) => void) | null = null
  onend: ((ev: Event) => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  constructor() {
    recognitions.push(this)
  }
  emit(specs: ResultSpec[], resultIndex = 0): void {
    if (!this.onresult) return
    this.onresult({ resultIndex, results: buildResults(specs) })
  }
  emitError(error: string): void {
    this.onerror?.({ error })
  }
  emitEnd(): void {
    this.onend?.(new Event('end'))
  }
}

function lastRecognition(): StubSpeechRecognition {
  const rec = recognitions[recognitions.length - 1]
  if (!rec) throw new Error('no SpeechRecognition instance was created')
  return rec
}

// ── speechSynthesis stub ────────────────────────────────────────────────
const speakMock = vi.fn()
const cancelMock = vi.fn()

class StubUtterance {
  lang = ''
  rate = 1
  pitch = 1
  constructor(public text: string) {}
}

function spokenSentences(): string[] {
  return speakMock.mock.calls.map((c) => (c[0] as StubUtterance).text)
}

function installSpeechGlobals(): void {
  const g = globalThis as unknown as {
    SpeechRecognition: unknown
    webkitSpeechRecognition: unknown
  }
  g.SpeechRecognition = StubSpeechRecognition
  g.webkitSpeechRecognition = StubSpeechRecognition
  const w = window as unknown as {
    speechSynthesis: unknown
    SpeechSynthesisUtterance: unknown
  }
  w.speechSynthesis = { speak: speakMock, cancel: cancelMock }
  w.SpeechSynthesisUtterance = StubUtterance
}

function removeSpeechRecognition(): void {
  const g = globalThis as unknown as {
    SpeechRecognition?: unknown
    webkitSpeechRecognition?: unknown
  }
  delete g.SpeechRecognition
  delete g.webkitSpeechRecognition
}

// ── fetch mock helpers ──────────────────────────────────────────────────
type FetchCall = { url: string; init: RequestInit | undefined }

function mockFetchSSE(body: string, calls: FetchCall[]): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(makeReadableStream([body]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  ) as unknown as typeof globalThis.fetch
}

function mockFetchNeverCloses(counter: { count: number }): void {
  globalThis.fetch = vi.fn(async () => {
    counter.count += 1
    return new Response(
      new ReadableStream<Uint8Array>({
        start() {
          // Never enqueue, never close — stays in `streaming`.
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }) as unknown as typeof globalThis.fetch
}

// Drive the mic: click Speak, emit the given batch, then end the session.
async function dictate(specs: ResultSpec[]): Promise<void> {
  const micButton = screen.getByTestId('ai-feature-voice-mode-mic-start')
  await act(async () => {
    fireEvent.click(micButton)
  })
  await act(async () => {
    lastRecognition().emit(specs)
    lastRecognition().emitEnd()
  })
}

const SEND_BUTTON = /Speak to Helix/i

beforeEach(() => {
  mockUseSettings.mockReset()
  recognitions.length = 0
  speakMock.mockClear()
  cancelMock.mockClear()
  installSpeechGlobals()
  window.localStorage.removeItem(TRANSCRIPT_DRAFT_KEY)
  // Loud default so a test that forgets to install its own fetch mock
  // fails clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked')
  }) as unknown as typeof globalThis.fetch
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  removeSpeechRecognition()
  window.localStorage.removeItem(TRANSCRIPT_DRAFT_KEY)
})

describe('AIVoiceMode — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the voice-mode toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { 'voice-mode': true } }),
    )

    const { container } = render(<AIVoiceMode />)

    expect(container).toBeEmptyDOMElement()
    expect(
      screen.queryByTestId('ai-feature-voice-mode-root'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: SEND_BUTTON }),
    ).not.toBeInTheDocument()
  })

  it('renders the fully-composed panel (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabledSettings())

    render(<AIVoiceMode />)

    const root = screen.getByTestId('ai-feature-voice-mode-root')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'voice-mode')
    expect(
      screen.getByRole('heading', { name: /Voice mode/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-feature-voice-mode-mic-start'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-feature-voice-mode-tts-toggle'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: SEND_BUTTON }),
    ).toBeInTheDocument()
  })
})

describe('AIVoiceMode — speech-to-text transcript', () => {
  it('commits only final results and never duplicates interim revisions (regression guard)', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    render(<AIVoiceMode />)

    const micButton = screen.getByTestId('ai-feature-voice-mode-mic-start')
    await act(async () => {
      fireEvent.click(micButton)
    })

    // The engine re-fires the same index with a refined transcript until
    // it flips to isFinal. The old handler appended every fire, so this
    // sequence would have produced "how how full how full is my battery".
    await act(async () => {
      lastRecognition().emit([{ transcript: 'how', isFinal: false }])
      lastRecognition().emit([{ transcript: 'how full', isFinal: false }])
      lastRecognition().emit([
        { transcript: 'how full is my battery', isFinal: true },
      ])
    })

    const transcript = screen.getByTestId('ai-feature-voice-mode-transcript')
    expect(transcript.textContent).toBe('how full is my battery')
    expect(transcript).not.toHaveTextContent('how how')
  })

  it('shows interim text as an ephemeral preview that does not enable send', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    render(<AIVoiceMode />)

    const micButton = screen.getByTestId('ai-feature-voice-mode-mic-start')
    await act(async () => {
      fireEvent.click(micButton)
    })
    await act(async () => {
      lastRecognition().emit([{ transcript: 'how full', isFinal: false }])
    })

    // The preview renders…
    const transcript = screen.getByTestId('ai-feature-voice-mode-transcript')
    expect(transcript).toHaveTextContent('how full')
    // …but a purely-interim transcript must NOT arm the send button —
    // un-finalized text is never dispatched.
    expect(screen.getByRole('button', { name: SEND_BUTTON })).toBeDisabled()
  })

  it('joins successive final utterances with a single space', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    render(<AIVoiceMode />)

    const micButton = screen.getByTestId('ai-feature-voice-mode-mic-start')
    await act(async () => {
      fireEvent.click(micButton)
    })
    await act(async () => {
      lastRecognition().emit([{ transcript: 'what is', isFinal: true }])
      lastRecognition().emit([{ transcript: 'my range', isFinal: true }])
    })

    const transcript = screen.getByTestId('ai-feature-voice-mode-transcript')
    expect(transcript.textContent).toBe('what is my range')
  })
})

describe('AIVoiceMode — send wiring', () => {
  it('keeps send disabled with a hint until a transcript is dictated, then enables it', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    render(<AIVoiceMode />)

    const sendButton = screen.getByRole('button', { name: SEND_BUTTON })
    expect(sendButton).toBeDisabled()
    expect(screen.getByText(/dictate a question first/i)).toBeInTheDocument()

    await dictate([{ transcript: 'how full is my battery', isFinal: true }])

    expect(sendButton).not.toBeDisabled()
    expect(
      screen.queryByText(/dictate a question first/i),
    ).not.toBeInTheDocument()
  })

  it('POSTs exactly once to /api/v1/ai/voice/chat with the transcript + a session id and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    const calls: FetchCall[] = []
    const body =
      sseFrame('delta', {
        text: 'Your Model 3 is at 78 percent and not currently charging.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 64, out: 22 } })
    mockFetchSSE(body, calls)

    render(<AIVoiceMode />)
    await dictate([{ transcript: 'how full is my battery', isFinal: true }])

    const sendButton = screen.getByRole('button', { name: SEND_BUTTON })
    await waitFor(() => expect(sendButton).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(sendButton)
    })

    await waitFor(() => expect(calls).toHaveLength(1))
    const { url, init } = calls[0]
    expect(url).toBe('/api/v1/ai/voice/chat')
    expect(init?.method).toBe('POST')
    const parsed = JSON.parse(init?.body as string)
    expect(parsed.message).toBe('how full is my battery')
    expect(typeof parsed.session_id).toBe('string')
    expect(parsed.session_id.length).toBeGreaterThan(0)

    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('Content-Type')).toBe('application/json')

    const root = screen.getByTestId('ai-feature-voice-mode-root')
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Your Model 3 is at 78 percent and not currently charging.',
      )
    })
  })

  it('coalesces a second click while streaming into a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    const counter = { count: 0 }
    mockFetchNeverCloses(counter)

    render(<AIVoiceMode />)
    await dictate([{ transcript: 'what is my range', isFinal: true }])

    const sendButton = screen.getByRole('button', { name: SEND_BUTTON })
    await waitFor(() => expect(sendButton).not.toBeDisabled())
    await act(async () => {
      fireEvent.click(sendButton)
    })
    await waitFor(() => expect(counter.count).toBe(1))
    await waitFor(() => expect(sendButton).toBeDisabled())

    await act(async () => {
      fireEvent.click(sendButton)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(counter.count).toBe(1)
  })

  it('surfaces the stream error when the backend returns a non-2xx status', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof globalThis.fetch

    render(<AIVoiceMode />)
    await dictate([{ transcript: 'how full is my battery', isFinal: true }])

    const sendButton = screen.getByRole('button', { name: SEND_BUTTON })
    await act(async () => {
      fireEvent.click(sendButton)
    })

    const panel = await screen.findByTestId('ai-output-panel')
    expect(panel).toHaveTextContent(/Helix error/i)
    expect(panel).toHaveTextContent('stream_http_404')
  })
})

describe('AIVoiceMode — text-to-speech playback', () => {
  it('speaks each complete sentence from streamed deltas and flushes the tail on done', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    const calls: FetchCall[] = []
    const body =
      sseFrame('delta', { text: 'Your battery is at 80 percent. ' }) +
      sseFrame('delta', { text: 'It is not charging' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 10, out: 8 } })
    mockFetchSSE(body, calls)

    render(<AIVoiceMode />)
    await dictate([{ transcript: 'battery status', isFinal: true }])

    const sendButton = screen.getByRole('button', { name: SEND_BUTTON })
    await act(async () => {
      fireEvent.click(sendButton)
    })

    await waitFor(() =>
      expect(spokenSentences()).toContain('Your battery is at 80 percent.'),
    )
    await waitFor(() =>
      expect(spokenSentences()).toContain('It is not charging'),
    )
  })

  it('mutes spoken replies when the TTS toggle is pressed and silences subsequent deltas', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    const calls: FetchCall[] = []
    const body =
      sseFrame('delta', { text: 'Hello there. ' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 3, out: 2 } })
    mockFetchSSE(body, calls)

    render(<AIVoiceMode />)

    const toggle = screen.getByTestId('ai-feature-voice-mode-tts-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await act(async () => {
      fireEvent.click(toggle)
    })
    // Muting cancels any in-flight utterance and flips the toggle state.
    expect(cancelMock).toHaveBeenCalled()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await dictate([{ transcript: 'say hello', isFinal: true }])
    const sendButton = screen.getByRole('button', { name: SEND_BUTTON })
    await act(async () => {
      fireEvent.click(sendButton)
    })

    // The reply still renders in the panel, proving the stream ran…
    const root = screen.getByTestId('ai-feature-voice-mode-root')
    await waitFor(() => expect(root).toHaveTextContent('Hello there.'))
    // …but nothing was ever spoken while muted.
    expect(speakMock).not.toHaveBeenCalled()
  })
})

describe('AIVoiceMode — error and unsupported states', () => {
  it('surfaces an STT error and resets the mic when recognition emits an error', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    render(<AIVoiceMode />)

    const micButton = screen.getByTestId('ai-feature-voice-mode-mic-start')
    await act(async () => {
      fireEvent.click(micButton)
    })
    // While listening the mic swaps to the stop control.
    expect(
      screen.getByTestId('ai-feature-voice-mode-mic-stop'),
    ).toBeInTheDocument()

    await act(async () => {
      lastRecognition().emitError('no-speech')
    })

    const errorEl = screen.getByTestId('ai-feature-voice-mode-stt-error')
    expect(errorEl).toHaveTextContent(/Voice input failed/i)
    // The mic reverts to the start control once the error resets listening.
    expect(
      screen.getByTestId('ai-feature-voice-mode-mic-start'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('ai-feature-voice-mode-mic-stop'),
    ).not.toBeInTheDocument()
  })

  it('disables the mic and shows a hint when SpeechRecognition is unavailable', () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    // Firefox path: neither prefixed nor unprefixed ctor exists.
    removeSpeechRecognition()

    render(<AIVoiceMode />)

    const micButton = screen.getByTestId('ai-feature-voice-mode-mic-start')
    expect(micButton).toBeDisabled()
    expect(micButton).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText(/Voice input is not available in this browser/i),
    ).toBeInTheDocument()
  })
})

describe('AIVoiceMode — stop, persistence, and lifecycle', () => {
  it('stops the mic and cancels in-flight speech when the stop button is pressed mid-stream', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    const counter = { count: 0 }
    mockFetchNeverCloses(counter)

    render(<AIVoiceMode />)
    await dictate([{ transcript: 'keep talking', isFinal: true }])

    const sendButton = screen.getByRole('button', { name: SEND_BUTTON })
    await act(async () => {
      fireEvent.click(sendButton)
    })

    const stopButton = await screen.findByTestId('ai-feature-voice-mode-stop')
    const cancelsBefore = cancelMock.mock.calls.length
    await act(async () => {
      fireEvent.click(stopButton)
    })

    // handleStopAll cancels speech and stops the recognition session.
    expect(cancelMock.mock.calls.length).toBeGreaterThan(cancelsBefore)
    expect(lastRecognition().stop).toHaveBeenCalled()
  })

  it('persists the transcript draft while idle and clears it after a completed send', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    const calls: FetchCall[] = []
    mockFetchSSE(
      sseFrame('delta', { text: 'Ok.' }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
      calls,
    )

    render(<AIVoiceMode />)
    await dictate([{ transcript: 'remember me', isFinal: true }])

    // Idle → the draft is mirrored to localStorage for refresh recovery.
    await waitFor(() =>
      expect(window.localStorage.getItem(TRANSCRIPT_DRAFT_KEY)).toBe(
        'remember me',
      ),
    )

    const sendButton = screen.getByRole('button', { name: SEND_BUTTON })
    await act(async () => {
      fireEvent.click(sendButton)
    })

    // A successful round-trip wipes the draft and resets the field so a
    // refresh does not repaint the just-spoken prompt.
    await waitFor(() =>
      expect(window.localStorage.getItem(TRANSCRIPT_DRAFT_KEY)).toBeNull(),
    )
    const transcript = screen.getByTestId('ai-feature-voice-mode-transcript')
    await waitFor(() => expect(transcript).toHaveTextContent(/Tap the mic/i))
  })

  it('restores a saved transcript draft on mount', () => {
    window.localStorage.setItem(TRANSCRIPT_DRAFT_KEY, 'saved draft text')
    mockUseSettings.mockReturnValue(enabledSettings())

    render(<AIVoiceMode />)

    const transcript = screen.getByTestId('ai-feature-voice-mode-transcript')
    expect(transcript).toHaveTextContent('saved draft text')
    expect(
      screen.getByRole('button', { name: SEND_BUTTON }),
    ).not.toBeDisabled()
  })

  it('aborts recognition and wipes the draft on unmount', async () => {
    mockUseSettings.mockReturnValue(enabledSettings())
    const { unmount } = render(<AIVoiceMode />)

    await dictate([{ transcript: 'cleanup please', isFinal: true }])
    const rec = lastRecognition()

    await act(async () => {
      unmount()
    })

    expect(rec.abort).toHaveBeenCalled()
    expect(window.localStorage.getItem(TRANSCRIPT_DRAFT_KEY)).toBeNull()
  })

  it('exposes a stable displayName', () => {
    expect(AIVoiceMode.displayName).toBe('AIVoiceMode')
  })
})
