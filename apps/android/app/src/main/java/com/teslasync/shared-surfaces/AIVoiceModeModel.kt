// Pure, framework-free model for the AIVoiceMode shared surface — the native analogue of everything
// web/src/components/ai/AIVoiceMode.tsx derives around its browser STT/TTS + useAiStream composition. No Compose,
// no Android framework, no HTTP lives here, so every declaration is exercised off-device by the
// :android:testReleaseUnitTest gate and the composable + view-model stay thin layers (ADR-002).
//
// The web surface is the optional voice front-end for the chatbot: SpeechRecognition turns the microphone into a
// transcript, useAiStream POSTs the transcribed text to /ai/voice/chat, and speechSynthesis reads the streamed
// reply aloud (audio never leaves the device — only the transcribed text is sent). It is an opt-in wrapper around
// the typed chatbot: withAiFeature('voice-mode', …) removes the whole panel when AI mode or this feature is off,
// and the card itself is the shared AIFeatureCard scaffold driven by the stream.
//
// This file owns the parity-critical pieces that have nothing to do with Compose or the platform speech engines:
//   - the surface slug + feature-gate id + the PII-safe `view.opened` diagnostic (P1/S11),
//   - the i18n key inventory (every web `t(key, …)` call this surface makes), folded for tests,
//   - the TTS sentence chunker ([popCompleteSentences]) the web buffers deltas through so speech flushes at
//     sentence boundaries rather than word-by-word or only at the end,
//   - the transcript accumulation ([appendFinalTranscript] / [joinInterim]) the web `onresult` handler performs,
//   - the classified voice-input error ([VoiceInputError]) the render boundary localizes (never a raw provider
//     string baked into state),
//   - the input-slot projection ([VoiceInputView] + [transcriptHintFor]) covering the idle / listening / has-text
//     branches the web inputSlot switches on, and
//   - the merged TalkBack announcement builder for the live transcript region.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// identifier (a hyphen is illegal), so the package intentionally diverges from the path — exactly as the sibling
// AIRAGHelp / AIFeatureCard surfaces do. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivoicemode

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no transcript text, VIN, or any
 * generated reply, so a diagnostics line can never leak what the operator dictated or what Helix answered.
 */
const val AI_VOICE_MODE_SLUG: String = "AIVoiceMode"

/**
 * The AI-feature id this surface is gated behind (web `withAiFeature('voice-mode', …)`). The host wires the shared
 * S8 AI-mode gate for this id into [AIVoiceModeSource.aiEnabled]; when off the whole surface collapses.
 */
const val VOICE_MODE_FEATURE_ID: String = "voice-mode"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AI_VOICE_MODE_SLUG] (P1/S11). Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the view calls it from the first-composition effect.
 */
fun recordAIVoiceModeViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("slug" to AI_VOICE_MODE_SLUG))
}

// ── i18n inventory (every web `t(key, fallback)` this surface makes) ─────────────────────────────────────────────

/**
 * The complete set of i18next keys the web AIVoiceMode references, paired with their exact English source text.
 * The view binds the generated Android catalog equivalents (`translation_voiceMode_*`, present in P1/S10 — the
 * compile-time `R.string` reference is the catalog-presence proof); this inventory lets an off-device test assert
 * the full key set so a dropped or renamed string is caught without a device. `sttFailed` carries the `{{reason}}`
 * interpolation (the catalog emits it as the Android `%1$s` positional argument).
 */
object VoiceModeKeys {
    const val TITLE: String = "voiceMode.title"
    const val DESCRIPTION: String = "voiceMode.description"
    const val BUTTON: String = "voiceMode.button"
    const val TRANSCRIPT_LABEL: String = "voiceMode.transcriptLabel"
    const val LISTENING_HINT: String = "voiceMode.listeningHint"
    const val IDLE_HINT: String = "voiceMode.idleHint"
    const val UNSUPPORTED_HINT: String = "voiceMode.unsupportedHint"
    const val EMPTY_HINT: String = "voiceMode.emptyHint"
    const val ACTION_START_LISTENING: String = "voiceMode.actions.startListening"
    const val ACTION_STOP_LISTENING: String = "voiceMode.actions.stopListening"
    const val ACTION_START_LISTENING_SHORT: String = "voiceMode.actions.startListeningShort"
    const val ACTION_STOP_LISTENING_SHORT: String = "voiceMode.actions.stopListeningShort"
    const val ACTION_MUTE_TTS: String = "voiceMode.actions.muteTts"
    const val ACTION_UNMUTE_TTS: String = "voiceMode.actions.unmuteTts"
    const val ACTION_MUTE_TTS_SHORT: String = "voiceMode.actions.muteTtsShort"
    const val ACTION_UNMUTE_TTS_SHORT: String = "voiceMode.actions.unmuteTtsShort"
    const val ACTION_STOP_ALL: String = "voiceMode.actions.stopAll"
    const val ACTION_STOP_ALL_SHORT: String = "voiceMode.actions.stopAllShort"
    const val ERROR_STT_FAILED: String = "voiceMode.errors.sttFailed"
    const val ERROR_UNSUPPORTED: String = "voiceMode.errors.unsupported"

    /** Every key above, in declaration order — the off-device key-inventory assertion iterates this. */
    val ALL: List<String> =
        listOf(
            TITLE,
            DESCRIPTION,
            BUTTON,
            TRANSCRIPT_LABEL,
            LISTENING_HINT,
            IDLE_HINT,
            UNSUPPORTED_HINT,
            EMPTY_HINT,
            ACTION_START_LISTENING,
            ACTION_STOP_LISTENING,
            ACTION_START_LISTENING_SHORT,
            ACTION_STOP_LISTENING_SHORT,
            ACTION_MUTE_TTS,
            ACTION_UNMUTE_TTS,
            ACTION_MUTE_TTS_SHORT,
            ACTION_UNMUTE_TTS_SHORT,
            ACTION_STOP_ALL,
            ACTION_STOP_ALL_SHORT,
            ERROR_STT_FAILED,
            ERROR_UNSUPPORTED,
        )
}

// ── Voice-input error (web `sttError` state, classified instead of a baked-in string) ───────────────────────────

/**
 * The classification of a speech-to-text failure — the native mirror of the web `sttError` state, kept structured
 * so the render boundary localizes it (web bakes the localized string into state because the component is also the
 * view; native keeps i18n at the render edge per ADR-002). [Unsupported] is the "no recognizer on this device"
 * branch (web `getSpeechRecognitionCtor() === null`); [Failed] carries the recognizer's terminal reason for the
 * `voiceMode.errors.sttFailed` interpolation.
 */
sealed interface VoiceInputError {
    /** No on-device speech recognizer is available — web `voiceMode.errors.unsupported`. */
    data object Unsupported : VoiceInputError

    /** The recognizer ended in error — web `voiceMode.errors.sttFailed` with [reason] as `{{reason}}`. */
    data class Failed(
        val reason: String,
    ) : VoiceInputError
}

// ── TTS sentence chunking (web popCompleteSentences) ────────────────────────────────────────────────────────────

/** A flush of the TTS buffer: the [spoken] complete sentences to utter now, and the unfinished [remainder]. */
data class SpokenSplit(
    val spoken: List<String>,
    val remainder: String,
)

private val SENTENCE_BOUNDARY = Regex("([.!?])\\s+")

/**
 * Splits a TTS buffer into complete sentences plus a trailing remainder — the exact native port of the web
 * `popCompleteSentences`. The backend streams arbitrary-sized delta chunks; we neither want the engine to speak
 * word-by-word (sounds broken) nor wait for the whole reply (poor latency), so we flush each time the buffer
 * crosses a sentence terminator (`.`, `!`, `?` followed by whitespace) and keep the unfinished tail buffered.
 */
fun popCompleteSentences(buffer: String): SpokenSplit {
    val spoken = mutableListOf<String>()
    var working = buffer
    var match = SENTENCE_BOUNDARY.find(working)
    while (match != null) {
        val cutAt = match.range.first + match.groupValues[1].length
        val head = working.substring(0, cutAt).trim()
        if (head.isNotEmpty()) spoken.add(head)
        working = working.substring(cutAt).trimStart()
        match = SENTENCE_BOUNDARY.find(working)
    }
    return SpokenSplit(spoken, working)
}

// ── Transcript accumulation (web onresult / interim handling) ───────────────────────────────────────────────────

/**
 * Appends a finalized recognition [chunk] to the [committed] transcript — the native port of the web `onresult`
 * accumulation (`trimmedPrev ? "${trimmedPrev} ${acc}" : acc`): the prior transcript's trailing whitespace is
 * trimmed and the new chunk is joined with a single separating space, or becomes the transcript outright when the
 * prior was empty. A blank [chunk] leaves the transcript unchanged.
 */
fun appendFinalTranscript(
    committed: String,
    chunk: String,
): String {
    val incoming = chunk.trim()
    if (incoming.isEmpty()) return committed
    val base = committed.trimEnd()
    return if (base.isEmpty()) incoming else "$base $incoming"
}

/**
 * Joins the [committed] transcript with the live [interim] preview into the text shown + sent — the in-flight
 * recognition hypothesis trails the committed text with a single space, mirroring the web transcript growing as
 * the user speaks. Either part being blank yields the other, trimmed.
 */
fun joinInterim(
    committed: String,
    interim: String,
): String {
    val base = committed.trimEnd()
    val live = interim.trim()
    return when {
        live.isEmpty() -> base
        base.isEmpty() -> live
        else -> "$base $live"
    }
}

// ── Input-slot projection (web inputSlot: transcript + hints + controls) ────────────────────────────────────────

/**
 * The render-ready snapshot of the voice input slot — the native projection of the web inputSlot's transcript box
 * and its controls. Pure so every branch (idle hint vs listening hint vs transcript, the mic start/stop swap, the
 * TTS mute/unmute swap, the stop affordance while busy, the error + unsupported hints) is classified and tested
 * off-device.
 *
 * @property transcript the effective transcript shown + sent (committed + live interim), already joined.
 * @property listening whether the recognizer is actively capturing (web `listening`).
 * @property ttsEnabled whether spoken replies are on (web `ttsEnabled`); flips the mute/unmute control + label.
 * @property sttSupported whether an on-device recognizer exists (web `sttSupported`); gates the mic + shows a hint.
 * @property error the classified speech-to-text failure, or `null` (web `sttError`).
 * @property busy whether a chat stream is in flight (web `isBusy`); shows the stop-all control + disables the mic.
 */
data class VoiceInputView(
    val transcript: String,
    val listening: Boolean,
    val ttsEnabled: Boolean,
    val sttSupported: Boolean,
    val error: VoiceInputError?,
    val busy: Boolean,
) {
    /** Web `transcript.trim().length > 0` — drives the hint vs transcript choice and the send `canStart`. */
    val hasTranscript: Boolean get() = transcript.isNotBlank()

    /** Web mic enable rule `disabled={!sttSupported || isBusy}` — the mic is tappable only when supported + idle. */
    val micEnabled: Boolean get() = sttSupported && !busy

    /** Show the persistent "voice not available" hint — web `!sttSupported && !sttError`. */
    val showUnsupportedHint: Boolean get() = !sttSupported && error == null

    /** Show the stop-all control — web renders it only `{isBusy && …}`. */
    val showStop: Boolean get() = busy
}

/** Which hint the transcript box shows when empty — web `listening ? listeningHint : idleHint`, or none. */
enum class TranscriptHint { Idle, Listening, None }

/**
 * Selects the transcript box hint — none once any transcript exists (the text itself shows), the "listening" hint
 * while capturing, otherwise the idle "tap the mic" invitation. Mirrors the web inputSlot's nested ternary.
 */
fun transcriptHintFor(view: VoiceInputView): TranscriptHint =
    when {
        view.hasTranscript -> TranscriptHint.None
        view.listening -> TranscriptHint.Listening
        else -> TranscriptHint.Idle
    }

// ── Accessibility (web aria-label + aria-live transcript region) ────────────────────────────────────────────────

/**
 * Builds the merged TalkBack announcement for the live transcript region from already-localized parts — the field
 * [label] (web `aria-label="Voice transcript"`) and its current [body] (the transcript, or the active hint). Pure
 * so the polite-live-region label presence is unit-tested without a Compose host. A blank body folds to the label
 * alone.
 */
fun transcriptAnnouncement(
    label: String,
    body: String,
): String {
    val spoken = body.trim()
    return if (spoken.isEmpty()) label else "$label. $spoken"
}

// ── Session id (web newVoiceSessionId) ──────────────────────────────────────────────────────────────────────────

/**
 * Builds the stable per-session voice id — the native port of the web `voice_${Date.now()}_${rand}`. The backend
 * accepts any non-empty session id and binds it to the request context so the streaming tool refuses cross-session
 * lookups; kept pure (the [nowMs] stamp + the [suffix] entropy are injected) so the format is deterministic in
 * tests.
 */
fun newVoiceSessionId(
    nowMs: Long,
    suffix: String,
): String = "voice_${nowMs}_$suffix"
