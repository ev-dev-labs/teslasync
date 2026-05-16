// Phase-50 / 0055 — V1 Helix voice mode.
//
// What this component is:
//   A browser-native voice front-end for the chatbot streaming
//   endpoint. The user taps a mic button, the browser's
//   SpeechRecognition API transcribes the utterance to text,
//   the text is POSTed to /api/v1/ai/voice/chat (via useAiStream),
//   and the streaming reply is spoken back via the browser's
//   speechSynthesis API. NO audio bytes leave the browser. The
//   only thing that crosses the network is the transcribed text
//   (same shape as the typed chatbot — same redaction, same
//   guard chain).
//
// Why browser-side STT/TTS:
//   ADR-015 §I4 (zero egress in off mode) and §I3 (baseline intact)
//   both push us to keep the audio plumbing client-only. The
//   typed chatbot already handles the language model side of
//   "Tesla questions answered in plain English"; voice mode is
//   purely an input/output transducer on top of that. If we ever
//   want server-side STT/TTS we can layer it as a separate slice
//   without touching this code path.
//
// W1 inline wiring (P11/P12):
//   - useAiStream targets POST /ai/voice/chat (the backend path
//     after stripping the /api/v1 prefix; the hook prepends it).
//   - The primary action button is disabled via a COMPUTED
//     expression
//     (`stream.state === 'streaming' || stream.state === 'paused-confirm'`
//     OR no transcript yet OR no STT support); never a literal
//     `disabled` or `disabled={true}` (Rule W1-A).
//   - The render contract is NARRATIVE: the LLM speaks. There is
//     no typed proposal, no "Apply to form" handoff. Streaming
//     text is rendered via AiOutputPanel (inside AIFeatureCard).
//   - cancel() runs on unmount, on feature-flip, and on user
//     "stop" tap. speechSynthesis.cancel() runs alongside so
//     the speaker stops the moment the user does (no orphaned
//     speech after the stream is aborted).
//   - Component is wrapped with withAiFeature so it is ABSENT
//     (returns null) when ai_mode='off' or the per-feature
//     toggle is off (ADR-015 §I5 hidden UI). The localStorage
//     transcript-draft key is only ever written from inside this
//     wrapped subtree, which is why the off-mode test can prove
//     "no client storage artifacts when AI is off" by simply
//     mounting the page and asserting the key never appears.
//
// HX (Helix UX) contract:
//   - The surface renders through the shared AIFeatureCard
//     scaffold. The per-feature verb "Speak to Helix" is passed
//     via `buttonLabel`. The card composes the accessible name
//     as "Ask Helix · Speak to Helix" — tests locate the button
//     via the unanchored regex /Speak to Helix/i.
//   - i18n keys say "Helix" not "AI" (voiceMode.* namespace).
//
// ADR-015 alignment:
//   - I3 baseline intact: the typed chatbot remains the canonical
//     conversation surface. Voice mode adds an OPT-IN panel above
//     the conversation; the conversation textarea / send button
//     are unaffected.
//   - I5 hidden UI:       withAiFeature returns null in off mode,
//     so the panel is absent from the DOM and the localStorage
//     key is never written.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 when ai_mode='off'.
//   - I12 client/bg:      service-worker chunk `ai-voice-mode`
//     and client storage key `ai.voiceMode.transcriptDraft` are
//     both bounded to this component's mount lifecycle. The
//     storage key is removed on cancel/unmount and never written
//     when the component is not mounted (off-mode invariant).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, MicOff, Square, Volume2, VolumeX } from 'lucide-react'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream, type AiStreamEvent } from '@/hooks/useAiStream'
import { Button } from '@/components/ui'

// ---------------------------------------------------------------
// SpeechRecognition is a vendor-prefixed Web API not in the
// standard DOM lib (lib.dom.d.ts). Declare just the narrow slice
// we use so TypeScript is happy without pulling in a third-party
// typings package.
// ---------------------------------------------------------------
interface SpeechRecognitionAlternativeShim {
  readonly transcript: string
}
interface SpeechRecognitionResultShim {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternativeShim
  [index: number]: SpeechRecognitionAlternativeShim
}
interface SpeechRecognitionResultListShim {
  readonly length: number
  item(index: number): SpeechRecognitionResultShim
  [index: number]: SpeechRecognitionResultShim
}
interface SpeechRecognitionEventShim extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListShim
}
interface SpeechRecognitionErrorEventShim extends Event {
  readonly error: string
}
interface SpeechRecognitionShim extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((ev: SpeechRecognitionEventShim) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEventShim) => void) | null
  onend: ((ev: Event) => void) | null
  start(): void
  stop(): void
  abort(): void
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionShim
}

// Browser globals: Chrome/Edge expose `webkitSpeechRecognition`;
// Safari is `SpeechRecognition` (no prefix on recent builds).
// Firefox does not currently expose either at all — feature
// detection below renders an "STT not supported" hint instead of
// erroring out.
function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// ---------------------------------------------------------------
// localStorage transcript draft (ADR-015 §I12)
// ---------------------------------------------------------------
const TRANSCRIPT_DRAFT_KEY = 'ai.voiceMode.transcriptDraft'

function readTranscriptDraft(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(TRANSCRIPT_DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}
function persistTranscriptDraft(value: string): void {
  if (typeof window === 'undefined') return
  try {
    if (value === '') {
      window.localStorage.removeItem(TRANSCRIPT_DRAFT_KEY)
    } else {
      window.localStorage.setItem(TRANSCRIPT_DRAFT_KEY, value)
    }
  } catch {
    // Storage may be unavailable (Safari private mode, quota) —
    // the panel still works without persistence.
  }
}

// ---------------------------------------------------------------
// Stable session id for the voice transcript. We generate it
// once per component mount; the backend will accept any non-
// empty session_id and bind it to the request context so the
// `stream_chatbot_response` tool refuses cross-session lookups
// (see WithScopedVoiceModeSession in
// internal/ai/tools/voice_mode.go).
// ---------------------------------------------------------------
function newVoiceSessionId(): string {
  return `voice_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

// ---------------------------------------------------------------
// TTS sentence chunking. The backend streams text in arbitrary-
// sized delta chunks; we don't want the browser to speak word-by-
// word (sounds broken) nor wait for the entire reply (poor
// latency). Buffer until we hit a sentence terminator, then
// flush.
// ---------------------------------------------------------------
const SENTENCE_BOUNDARY_RE = /([.!?])\s+/

function popCompleteSentences(buffer: string): {
  spoken: string[]
  remainder: string
} {
  const spoken: string[] = []
  let working = buffer
  let match = SENTENCE_BOUNDARY_RE.exec(working)
  while (match) {
    const cutAt = match.index + match[1].length
    const head = working.slice(0, cutAt).trim()
    if (head) spoken.push(head)
    working = working.slice(cutAt).replace(/^\s+/, '')
    match = SENTENCE_BOUNDARY_RE.exec(working)
  }
  return { spoken, remainder: working }
}

function speakSentence(text: string, lang: string): void {
  if (typeof window === 'undefined') return
  if (typeof window.speechSynthesis === 'undefined') return
  try {
    const utter = new window.SpeechSynthesisUtterance(text)
    utter.lang = lang
    utter.rate = 1.0
    utter.pitch = 1.0
    window.speechSynthesis.speak(utter)
  } catch {
    // speechSynthesis can throw if the user has blocked audio;
    // failure is non-fatal — the text still renders in the panel.
  }
}

function cancelSpeech(): void {
  if (typeof window === 'undefined') return
  if (typeof window.speechSynthesis === 'undefined') return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Ignore.
  }
}

// ---------------------------------------------------------------
// Inner component (the wrapped surface). withAiFeature gates this
// at mount time; everything below executes only when AI is on.
// ---------------------------------------------------------------
function InnerSection(): JSX.Element {
  const { t, i18n } = useTranslation()
  const ttsLang = i18n.language || 'en-US'

  const [transcript, setTranscript] = useState<string>(() =>
    readTranscriptDraft(),
  )
  const [listening, setListening] = useState<boolean>(false)
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true)
  const [sttError, setSttError] = useState<string | null>(null)
  const [sessionId] = useState<string>(() => newVoiceSessionId())

  const sttCtor = useMemo(() => getSpeechRecognitionCtor(), [])
  const sttSupported = sttCtor !== null

  // Recognition instance is created on first mic press and torn
  // down on unmount; we hold the reference so the cleanup effect
  // can call .abort() even when the user navigated away mid-
  // listen.
  const recognitionRef = useRef<SpeechRecognitionShim | null>(null)

  // TTS sentence buffer — text deltas accumulate here and we
  // flush at sentence boundaries. lastSpokenLenRef tracks how
  // much of stream.text we've already chunked so re-renders
  // don't replay the speech.
  const ttsBufferRef = useRef<string>('')
  const lastSpokenLenRef = useRef<number>(0)

  // SSE event handler. NARRATIVE contract — we don't accumulate
  // tool_result envelopes here. The default useAiStream `text`
  // accumulator drives AiOutputPanel; this hook is only here to
  // tee delta text into the TTS buffer.
  const handleEvent = useCallback(
    (ev: AiStreamEvent) => {
      if (ev.type === 'delta' && ttsEnabled) {
        ttsBufferRef.current += ev.text
        const { spoken, remainder } = popCompleteSentences(
          ttsBufferRef.current,
        )
        ttsBufferRef.current = remainder
        for (const sentence of spoken) {
          speakSentence(sentence, ttsLang)
        }
      }
      if (ev.type === 'done' && ttsEnabled) {
        // Speak whatever didn't end with a sentence boundary.
        const tail = ttsBufferRef.current.trim()
        ttsBufferRef.current = ''
        if (tail) speakSentence(tail, ttsLang)
      }
      if (ev.type === 'error') {
        // Stop any in-flight utterances so the user isn't
        // talked over after the connection drops.
        cancelSpeech()
        ttsBufferRef.current = ''
      }
    },
    [ttsEnabled, ttsLang],
  )

  const body = useMemo(
    () => ({ message: transcript.trim(), session_id: sessionId }),
    [transcript, sessionId],
  )

  const stream = useAiStream({
    url: '/ai/voice/chat',
    body,
    onEvent: handleEvent,
  })

  const { cancel: cancelStream, text: streamText } = stream

  // Persist transcript draft as the user dictates. We do NOT
  // persist while the stream is in flight (the user has already
  // committed by hitting Send); we clear on a successful done.
  useEffect(() => {
    if (stream.state === 'streaming' || stream.state === 'paused-confirm') {
      return
    }
    persistTranscriptDraft(transcript)
  }, [transcript, stream.state])

  // Clear the draft after a successful round-trip so a refresh
  // doesn't repaint the just-spoken prompt.
  useEffect(() => {
    if (stream.state === 'done') {
      persistTranscriptDraft('')
      setTranscript('')
      lastSpokenLenRef.current = 0
    }
  }, [stream.state])

  // Reset the TTS chunker when a new stream begins (state goes
  // back to 'streaming' from anything else).
  useEffect(() => {
    if (stream.state === 'streaming' && streamText === '') {
      ttsBufferRef.current = ''
      lastSpokenLenRef.current = 0
    }
  }, [stream.state, streamText])

  // Cleanup on unmount: abort STT, cancel stream, cancel speech.
  // The dedicated effect (vs piling into one) keeps the deps
  // explicit per W1 §6.
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {
          // ignore
        }
        recognitionRef.current = null
      }
      cancelStream()
      cancelSpeech()
      ttsBufferRef.current = ''
      // I12: do not leak the draft past unmount. If the user
      // dictated something and then navigated away without
      // sending, we trade "remember-on-return" for the simpler
      // privacy story.
      persistTranscriptDraft('')
    }
  }, [cancelStream])

  // ----------------------------------------------------------
  // Mic controls
  // ----------------------------------------------------------
  const startListening = useCallback(() => {
    if (!sttCtor) {
      setSttError(
        t(
          'voiceMode.errors.unsupported',
          'Your browser does not support voice input. Try Chrome, Edge, or Safari.',
        ),
      )
      return
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
    setSttError(null)
    const rec = new sttCtor()
    rec.lang = ttsLang
    rec.continuous = false
    rec.interimResults = true
    rec.onresult = (ev: SpeechRecognitionEventShim) => {
      let acc = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        acc += r[0]?.transcript ?? ''
      }
      setTranscript((prev) => {
        const trimmedPrev = prev.replace(/\s+$/, '')
        const next = trimmedPrev ? `${trimmedPrev} ${acc}` : acc
        return next
      })
    }
    rec.onerror = (ev: SpeechRecognitionErrorEventShim) => {
      setSttError(
        t('voiceMode.errors.sttFailed', 'Voice input failed: {{reason}}', {
          reason: ev.error,
        }),
      )
      setListening(false)
    }
    rec.onend = () => {
      setListening(false)
    }
    try {
      rec.start()
      recognitionRef.current = rec
      setListening(true)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setSttError(
        t('voiceMode.errors.sttFailed', 'Voice input failed: {{reason}}', {
          reason,
        }),
      )
    }
  }, [sttCtor, ttsLang, t])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // ignore
      }
    }
    setListening(false)
  }, [])

  const handleStopAll = useCallback(() => {
    stopListening()
    cancelStream()
    cancelSpeech()
    ttsBufferRef.current = ''
  }, [stopListening, cancelStream])

  const toggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev
      if (!next) {
        cancelSpeech()
        ttsBufferRef.current = ''
      }
      return next
    })
  }, [])

  const isBusy =
    stream.state === 'streaming' || stream.state === 'paused-confirm'
  // canStart: we have something to say AND we're not already
  // streaming AND we're not in a paused-confirm gate. AIFeatureCard
  // adds the `!canStart || streaming` disable on the button — we
  // also include `paused-confirm` here so the double-submit guard
  // covers the confirm flow even though this feature does not
  // currently use F4 confirm tools.
  const canStart =
    transcript.trim().length > 0 && !isBusy

  const handleAction = useCallback(() => {
    if (!canStart) return
    // Reset TTS chunker so the assistant's previous reply does
    // not bleed into the next one.
    ttsBufferRef.current = ''
    lastSpokenLenRef.current = 0
    cancelSpeech()
    stream.start()
  }, [canStart, stream])

  const inputSlot = (
    <div className="space-y-3">
      <div
        className="rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-3 text-sm text-white/80 min-h-[3.5rem] whitespace-pre-wrap"
        aria-live="polite"
        aria-label={t('voiceMode.transcriptLabel', 'Voice transcript')}
        data-testid="ai-feature-voice-mode-transcript"
      >
        {transcript.trim().length > 0 ? (
          transcript
        ) : (
          <span className="text-white/40">
            {listening
              ? t(
                  'voiceMode.listeningHint',
                  'Listening — speak now…',
                )
              : t(
                  'voiceMode.idleHint',
                  'Tap the mic and ask Helix anything about your Tesla.',
                )}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {listening ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<MicOff className="h-4 w-4" />}
            onClick={stopListening}
            aria-label={t('voiceMode.actions.stopListening', 'Stop listening')}
            data-testid="ai-feature-voice-mode-mic-stop"
          >
            {t('voiceMode.actions.stopListeningShort', 'Stop mic')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            icon={<Mic className="h-4 w-4" />}
            onClick={startListening}
            aria-label={t('voiceMode.actions.startListening', 'Start listening')}
            disabled={!sttSupported || isBusy}
            aria-disabled={!sttSupported || isBusy ? 'true' : 'false'}
            data-testid="ai-feature-voice-mode-mic-start"
          >
            {t('voiceMode.actions.startListeningShort', 'Speak')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={
            ttsEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )
          }
          onClick={toggleTts}
          aria-pressed={ttsEnabled}
          aria-label={
            ttsEnabled
              ? t('voiceMode.actions.muteTts', 'Mute spoken replies')
              : t('voiceMode.actions.unmuteTts', 'Unmute spoken replies')
          }
          data-testid="ai-feature-voice-mode-tts-toggle"
        >
          {ttsEnabled
            ? t('voiceMode.actions.muteTtsShort', 'Mute Helix')
            : t('voiceMode.actions.unmuteTtsShort', 'Unmute Helix')}
        </Button>
        {isBusy && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Square className="h-4 w-4" />}
            onClick={handleStopAll}
            aria-label={t('voiceMode.actions.stopAll', 'Stop Helix')}
            data-testid="ai-feature-voice-mode-stop"
          >
            {t('voiceMode.actions.stopAllShort', 'Stop')}
          </Button>
        )}
      </div>
      {sttError && (
        <p
          className="text-xs text-rose-300"
          role="status"
          data-testid="ai-feature-voice-mode-stt-error"
        >
          {sttError}
        </p>
      )}
      {!sttSupported && !sttError && (
        <p className="text-xs text-white/40">
          {t(
            'voiceMode.unsupportedHint',
            'Voice input is not available in this browser. You can still type your question into the chatbot below.',
          )}
        </p>
      )}
    </div>
  )

  return (
    <AIFeatureCard
      title={t('voiceMode.title', 'Voice mode')}
      description={t(
        'voiceMode.description',
        'Speak to Helix and hear the reply out loud. Voice input and playback both stay on this device — only the transcribed text is sent to the assistant, never the raw audio.',
      )}
      buttonLabel={t('voiceMode.button', 'Speak to Helix')}
      emptyHint={
        transcript.trim().length === 0
          ? t(
              'voiceMode.emptyHint',
              'Tap the mic and dictate a question first.',
            )
          : undefined
      }
      canStart={canStart}
      stream={stream}
      onAction={handleAction}
      buttonPlacement="below"
      inputSlot={inputSlot}
      buttonTestId="ai-feature-voice-mode-send"
    />
  )
}
InnerSection.displayName = 'AIVoiceModeInner'

/**
 * AIVoiceMode renders the optional browser STT/TTS voice mode
 * panel only when the voice-mode feature is enabled. The wrapping
 * div from {@link withAiFeature} carries
 * `data-testid="ai-feature-voice-mode-root"`, which the off-mode
 * invariant test asserts against.
 */
export const AIVoiceMode = withAiFeature('voice-mode', InnerSection)
AIVoiceMode.displayName = 'AIVoiceMode'
