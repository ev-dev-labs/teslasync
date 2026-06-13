// The data + speech-engine seams the AIVoiceMode shared surface binds to — the native analogue of the browser
// capabilities the web component composes inline (web/src/components/ai/AIVoiceMode.tsx):
//   • the `withAiFeature('voice-mode', …)` gate (reads `useAiEnabled(feature)`),
//   • `useAiStream({ url: '/ai/voice/chat', body: { message, session_id } })`,
//   • the `SpeechRecognition` microphone-to-text engine, and
//   • the `speechSynthesis` text-to-speech engine.
// The view-model depends on these abstractions (real adapters over the shared AI layer + the Android platform in
// production, fakes in tests), never on a concrete store, the network, or a platform service directly, so the view
// performs NO HTTP and touches NO speech API itself (P1/S8 boundary, ADR-002).
//
// As with the sibling AIRAGHelp/AIDigestNarration sources, there is deliberately no concrete production binding
// committed in this file: the shared core ships the AI-settings/usage stores + the resilient SSE client but no AI
// *streaming* store yet (the streaming atoms are the out-of-scope P3 component-library bundle), so the host wires
// the production [AIVoiceModeSource] from the shared S8 AI-mode gate + the SSE client via [aiVoiceModeSource], and
// wires the production [VoiceRecognizer]/[VoiceSynthesizer] over android.speech.SpeechRecognizer /
// android.speech.tts.TextToSpeech. The host's production recognizer requires the `android.permission.RECORD_AUDIO`
// runtime permission and reports [VoiceRecognizer.isAvailable] = false when it is absent or no recognizer service
// exists, exactly reproducing the web feature-detection that renders the "voice not available" hint instead of
// erroring. A test fake implements each seam directly.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the
// co-located factory alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivoicemode

import kotlinx.coroutines.flow.Flow

// ── AI data seam (web withAiFeature gate + useAiStream voice chat) ──────────────────────────────────────────────

/**
 * One parsed frame of the voice-chat stream — the native narrowing of the web `AiStreamEvent` union this surface
 * consumes. [Delta] frames accumulate the spoken reply text; [Done] closes the stream cleanly; [Failed] carries an
 * already-summarized, non-PII transport/HTTP message the render boundary shows (web `stream.error`), so a raw
 * provider payload never reaches the UI.
 */
sealed interface AiVoiceChunk {
    /** A `delta` frame — a chunk of generated prose appended to the reply + teed into the TTS buffer. */
    data class Delta(
        val text: String,
    ) : AiVoiceChunk

    /** The terminal `done` frame — the stream finished cleanly. */
    data object Done : AiVoiceChunk

    /** A terminal `error` frame — carries the summarized failure message (web `stream.error`). */
    data class Failed(
        val message: String,
    ) : AiVoiceChunk
}

/**
 * The data seam the [AIVoiceModeViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network. [aiEnabled] is the AI-feature gate (web
 * `useAiEnabled('voice-mode')`); [connectivity] feeds the prompt's mandated offline surface; [chat] opens the cold
 * voice-chat stream (web `useAiStream`). No HTTP touches the view.
 */
interface AIVoiceModeSource {
    /**
     * Stream whether the `voice-mode` AI feature is enabled (web `useAiEnabled`). When `false` the surface
     * collapses to nothing, mirroring the web `withAiFeature` HOC returning `null`.
     */
    fun aiEnabled(): Flow<Boolean>

    /**
     * Stream device connectivity. `false` renders the offline surface (cached reply kept visible + offline chip)
     * and disables the send action, matching the reused AIFeatureCard's offline contract.
     */
    fun connectivity(): Flow<Boolean>

    /**
     * Open a fresh voice-chat stream for the transcribed [message] under [sessionId] — the native analogue of the
     * web `useAiStream` POST to `/ai/voice/chat` with `{ message, session_id }`. The returned cold [Flow] emits one
     * [AiVoiceChunk] per parsed SSE frame and completes when the stream closes. A terminal failure may be signalled
     * either as a terminal [AiVoiceChunk.Failed] frame or by the flow throwing (the view-model folds a thrown
     * failure into the same error surface).
     */
    fun chat(
        message: String,
        sessionId: String,
    ): Flow<AiVoiceChunk>
}

/**
 * Builds an [AIVoiceModeSource] from the flows + opener a host wires to the shared layer: [aiEnabled] from the
 * shared S8 AI-mode gate, [connectivity] from the platform connectivity monitor, and [chat] from the AI SSE
 * client. This is the production seam — re-collecting [chat] performs a genuine new request, which backs the
 * surface's send/retry affordance (the web `stream.start()`). A test fake implements [AIVoiceModeSource] directly.
 */
fun aiVoiceModeSource(
    aiEnabled: () -> Flow<Boolean>,
    connectivity: () -> Flow<Boolean>,
    chat: (message: String, sessionId: String) -> Flow<AiVoiceChunk>,
): AIVoiceModeSource =
    object : AIVoiceModeSource {
        override fun aiEnabled(): Flow<Boolean> = aiEnabled()

        override fun connectivity(): Flow<Boolean> = connectivity()

        override fun chat(
            message: String,
            sessionId: String,
        ): Flow<AiVoiceChunk> = chat(message, sessionId)
    }

// ── Speech-to-text seam (web SpeechRecognition) ─────────────────────────────────────────────────────────────────

/**
 * One event from a live recognition session — the native narrowing of the web `SpeechRecognition` `onresult` /
 * `onerror` / `onend` callbacks. [Partial] is the in-flight hypothesis shown as a live preview (web
 * `interimResults`); [Final] is a committed utterance appended to the transcript; [Failure] is the terminal
 * `onerror` reason (web `voiceMode.errors.sttFailed`); [Ended] is the clean `onend` (the session closed without
 * error).
 */
sealed interface SttEvent {
    /** An interim recognition hypothesis — the live preview trailing the committed transcript. */
    data class Partial(
        val text: String,
    ) : SttEvent

    /** A finalized utterance — appended to the committed transcript. */
    data class Final(
        val text: String,
    ) : SttEvent

    /** The session ended in error with a terminal [reason] (the recognizer's error label). */
    data class Failure(
        val reason: String,
    ) : SttEvent

    /** The session ended cleanly (web `onend`) — listening stops with no error. */
    data object Ended : SttEvent
}

/**
 * The microphone-to-text seam — the native counterpart of the web `SpeechRecognition` engine. A production binding
 * adapts android.speech.SpeechRecognizer (created + driven on the main thread, decoding its
 * `RecognitionListener` callbacks into [SttEvent]s and tearing the recognizer down on cancellation); a test fake
 * emits a scripted sequence. [isAvailable] mirrors the web `getSpeechRecognitionCtor() !== null` feature detection
 * (production: `SpeechRecognizer.isRecognitionAvailable(context)` plus the RECORD_AUDIO grant).
 */
interface VoiceRecognizer {
    /** Whether an on-device recognizer exists and may be used — web `sttSupported`. */
    fun isAvailable(): Boolean

    /**
     * Open one recognition session in [languageTag] (a BCP-47 tag, e.g. `en-US`). The returned cold [Flow] emits
     * [SttEvent]s until the session ends ([SttEvent.Ended] or [SttEvent.Failure]) or the collector cancels (the
     * view-model owns cancellation when the user taps "stop mic" or leaves the screen).
     */
    fun listen(languageTag: String): Flow<SttEvent>
}

// ── Text-to-speech seam (web speechSynthesis) ───────────────────────────────────────────────────────────────────

/**
 * The text-to-speech seam — the native counterpart of the web `speechSynthesis`. A production binding adapts
 * android.speech.tts.TextToSpeech (initialized once, speaking each sentence with `QUEUE_ADD` so the reply is read
 * in order); a test fake records spoken sentences. The view-model decides WHAT to speak (it sentence-chunks the
 * stream via [popCompleteSentences] and only speaks while spoken-replies are enabled), so an implementation only
 * needs to utter, stop, and release.
 */
interface VoiceSynthesizer {
    /** Speak [text] in [languageTag], queued after anything already speaking (web `speechSynthesis.speak`). */
    fun speak(
        text: String,
        languageTag: String,
    )

    /** Stop any in-flight utterance immediately (web `speechSynthesis.cancel`). */
    fun stop()

    /** Release the engine's resources when the surface is torn down (no web analogue — JVM/GC handles the web). */
    fun shutdown()
}
