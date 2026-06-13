// UI-thread-free state holder backing the AIVoiceMode shared surface — the native port of the web component's
// `withAiFeature('voice-mode', …)` gate + the InnerSection state machine (transcript / listening / ttsEnabled /
// sttError / sessionId) + `useAiStream({ url:'/ai/voice/chat' })` composition (web/src/components/ai/AIVoiceMode.tsx).
// It binds the AI gate + connectivity + voice-chat stream (P1/S8) through [AIVoiceModeSource] and drives the
// [VoiceRecognizer] (microphone → transcript) and [VoiceSynthesizer] (streamed reply → speech) seams, folding each
// parsed frame onto an immutable [VoiceModeState]. The view never performs HTTP and never touches a speech API —
// it only collects [state] and calls [setLanguage] / [startListening] / [stopListening] / [toggleTts] / [send] /
// [stopAll] / [onViewOpened].
//
// The streamed reply is teed into a sentence-buffer ([popCompleteSentences]) and spoken sentence-by-sentence only
// while spoken-replies are enabled (web handleEvent's delta/done/error branches), and a successful round-trip
// clears the transcript so a refresh does not repaint the just-spoken prompt (web's done effect). The reused
// AIFeatureCard scaffold reads the folded [AiFeatureStream] + `canStart` + connectivity and renders every mandated
// output state (loading / empty / content / error / stale / offline); this holder owns only the voice-specific
// state on top of it.
//
// Privacy note (documented, not silent — Honesty Covenant #9): the web persists a transcript draft to localStorage
// while not streaming and clears it on a successful round-trip AND on unmount, deliberately trading
// "remember-on-return" for the simpler privacy story. The native ViewModel already provides exactly that lifetime
// — the in-memory transcript survives recomposition + configuration changes (the web "while mounted" window) and
// is dropped when the holder is cleared (the web "unmount" point) — so no on-device persistence is added and the
// privacy story is identical.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivoicemode

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.sharedsurfaces.aifeaturecard.AiFeatureStream
import io.teslasync.android.sharedsurfaces.aifeaturecard.AiStreamPhase
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.random.Random

private const val DEFAULT_LANGUAGE: String = "en-US"
private const val STREAM_ERROR: String = "stream_error"
private const val STT_FAILED: String = "stt_failed"
private const val SUFFIX_LENGTH: Int = 8
private const val BASE36: String = "0123456789abcdefghijklmnopqrstuvwxyz"

/** Eight base-36 characters — the native analogue of the web `Math.random().toString(36).slice(2, 10)` suffix. */
private fun randomSessionSuffix(): String = buildString { repeat(SUFFIX_LENGTH) { append(BASE36[Random.nextInt(BASE36.length)]) } }

/** The default session-id provider — the web `voice_${Date.now()}_${rand}` built from the wall clock + entropy. */
private fun defaultVoiceSessionId(): String = newVoiceSessionId(System.currentTimeMillis(), randomSessionSuffix())

/**
 * The immutable surface state the [AIVoiceModeViewModel] exposes. It carries the AI feature gate (web
 * `withAiFeature`), connectivity (the offline surface), the committed transcript + the live interim hypothesis
 * (web `transcript`), whether the recognizer is capturing (web `listening`), whether spoken replies are on (web
 * `ttsEnabled`), whether a recognizer exists (web `sttSupported`), the classified speech-to-text error (web
 * `sttError`), and the folded voice-chat [AiFeatureStream] the reused AIFeatureCard renders.
 *
 * @property gated whether the AI feature is on (web `useAiEnabled('voice-mode')`); `false` collapses the surface.
 * @property online whether the device is connected (drives the offline surface + disables send).
 * @property committedTranscript the finalized transcript (web `transcript`, sans the in-flight hypothesis).
 * @property interim the live recognition hypothesis trailing the committed transcript (web `interimResults`).
 * @property listening whether the microphone session is active (web `listening`).
 * @property ttsEnabled whether streamed replies are spoken (web `ttsEnabled`).
 * @property sttSupported whether an on-device recognizer exists (web `sttSupported`).
 * @property inputError the classified speech-to-text failure, or `null` (web `sttError`).
 * @property stream the folded voice-chat stream the AIFeatureCard scaffold projects.
 */
data class VoiceModeState(
    val gated: Boolean = true,
    val online: Boolean = true,
    val committedTranscript: String = "",
    val interim: String = "",
    val listening: Boolean = false,
    val ttsEnabled: Boolean = true,
    val sttSupported: Boolean = true,
    val inputError: VoiceInputError? = null,
    val stream: AiFeatureStream = AiFeatureStream(),
) {
    /** The effective transcript shown + sent — the committed text plus the live interim hypothesis (web parity). */
    val transcript: String get() = joinInterim(committedTranscript, interim)

    /** Web `isBusy = state==='streaming' || state==='paused-confirm'` — a chat round-trip is in flight. */
    val busy: Boolean get() = stream.phase == AiStreamPhase.Streaming || stream.phase == AiStreamPhase.PausedConfirm

    /** Web `canStart = transcript.trim().length > 0 && !isBusy` — the send action is available. */
    val canStart: Boolean get() = transcript.isNotBlank() && !busy

    /** The render-ready input-slot projection the composable paints (web inputSlot derivation). */
    val inputView: VoiceInputView
        get() = VoiceInputView(transcript, listening, ttsEnabled, sttSupported, inputError, busy)
}

/**
 * Lifecycle-aware state holder backing the Compose AIVoiceMode surface. It owns no networking or speech API: it
 * collects the AI gate + connectivity ([source]), reduces the recognizer's [SttEvent]s into the transcript, opens
 * the voice-chat stream on [send] and folds its [AiVoiceChunk]s into [AiFeatureStream] while teeing the prose into
 * the [synthesizer], and exposes the PII-safe `view.opened` diagnostic.
 *
 * @param source the AI-gate + connectivity + chat-stream seam (a shared-AI-layer adapter in production, a fake in
 *   tests). The holder owns no networking — it only reduces this port's frames.
 * @param recognizer the microphone-to-text engine (android.speech.SpeechRecognizer adapter in production).
 * @param synthesizer the text-to-speech engine (android.speech.tts.TextToSpeech adapter in production).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + listen/send events
 *   carrying only the non-PII surface slug (never the transcript or any generated reply).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param sessionIdProvider the voice session-id factory (web `newVoiceSessionId`); injectable for deterministic
 *   tests. The recognition + speech language defaults to `en-US` and is updated via [setLanguage] (web
 *   `i18n.language`), which the view drives from the device locale on first composition.
 */
class AIVoiceModeViewModel(
    private val source: AIVoiceModeSource,
    private val recognizer: VoiceRecognizer,
    private val synthesizer: VoiceSynthesizer,
    logger: Logger,
    scope: CoroutineScope? = null,
    sessionIdProvider: () -> String = ::defaultVoiceSessionId,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(VoiceModeState(sttSupported = recognizer.isAvailable()))

    /** The live surface state — the AI gate, connectivity, transcript, listening/TTS flags, error, and stream. */
    val state: StateFlow<VoiceModeState> = mutableState.asStateFlow()

    private val sessionId: String = sessionIdProvider()
    private var language: String = DEFAULT_LANGUAGE
    private var listenJob: Job? = null
    private var chatJob: Job? = null
    private var ttsBuffer: String = ""
    private var viewOpenedRecorded = false

    init {
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gated = enabled) } } }
        launch { source.connectivity().collect { online -> mutableState.update { it.copy(online = online) } } }
    }

    /** Updates the recognition + speech language (web `i18n.language`); a blank tag falls back to the default. */
    fun setLanguage(languageTag: String) {
        language = languageTag.ifBlank { DEFAULT_LANGUAGE }
    }

    /**
     * Starts a microphone session (web `startListening`): with no on-device recognizer it surfaces the
     * "unsupported" error (web `voiceMode.errors.unsupported`) and does nothing else; a session already running is
     * a no-op; otherwise the prior error is cleared and each [SttEvent] is reduced into the transcript. A thrown
     * recognizer failure becomes the "failed" error (web `onerror`), and a clean completion stops listening.
     */
    @Suppress("TooGenericExceptionCaught")
    fun startListening() {
        val current = mutableState.value
        if (!current.sttSupported) {
            mutableState.update { it.copy(inputError = VoiceInputError.Unsupported) }
            return
        }
        if (current.listening) return
        logger.info("aiVoiceMode.listen")
        listenJob?.cancel()
        mutableState.update { it.copy(listening = true, interim = "", inputError = null) }
        listenJob =
            stateScope.launch {
                try {
                    recognizer.listen(language).collect { event -> reduceStt(event) }
                    mutableState.update { it.copy(listening = false, interim = "") }
                } catch (cancellation: CancellationException) {
                    mutableState.update { it.copy(listening = false, interim = "") }
                    throw cancellation
                } catch (error: Throwable) {
                    mutableState.update {
                        it.copy(listening = false, interim = "", inputError = VoiceInputError.Failed(error.message ?: STT_FAILED))
                    }
                }
            }
    }

    /** Stops the microphone session (web `stopListening`) — cancels recognition and drops the live hypothesis. */
    fun stopListening() {
        listenJob?.cancel()
        listenJob = null
        mutableState.update { it.copy(listening = false, interim = "") }
    }

    /**
     * Toggles spoken replies (web `toggleTts`): disabling immediately stops any in-flight utterance and clears the
     * sentence buffer so a half-spoken reply is not resumed when re-enabled.
     */
    fun toggleTts() {
        val next = !mutableState.value.ttsEnabled
        if (!next) {
            synthesizer.stop()
            ttsBuffer = ""
        }
        mutableState.update { it.copy(ttsEnabled = next) }
    }

    /**
     * Opens a voice-chat stream for the current transcript (web `handleAction` → `stream.start()`): a no-op with a
     * blank transcript, while a stream is already in flight, or while offline (the reused AIFeatureCard already
     * disables the action then). The transcript is pinned at call time (web pins `body` via useMemo), the sentence
     * buffer + any in-flight speech are reset, and each frame is folded into the stream while complete sentences
     * are spoken. A thrown transport failure folds into the same error surface as a terminal failure frame.
     */
    fun send() {
        val current = mutableState.value
        if (!current.canStart || !current.online) return
        val message = current.transcript.trim()
        logger.info("aiVoiceMode.send")
        synthesizer.stop()
        ttsBuffer = ""
        chatJob?.cancel()
        mutableState.update { it.copy(stream = AiFeatureStream(phase = AiStreamPhase.Streaming)) }
        chatJob =
            stateScope.launch {
                source
                    .chat(message, sessionId)
                    .catch { cause -> failChat(cause.message ?: STREAM_ERROR) }
                    .collect { chunk -> reduceChat(chunk) }
                finishChatIfStreaming()
            }
    }

    /** Stops everything (web `handleStopAll`) — listening, the chat stream, and speech — keeping any last reply. */
    fun stopAll() {
        stopListening()
        chatJob?.cancel()
        chatJob = null
        synthesizer.stop()
        ttsBuffer = ""
        mutableState.update {
            if (it.stream.phase == AiStreamPhase.Streaming) it.copy(stream = it.stream.copy(phase = AiStreamPhase.Idle)) else it
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no transcript or generated reply. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAIVoiceModeViewOpened(logger)
    }

    override fun onCleared() {
        listenJob?.cancel()
        chatJob?.cancel()
        synthesizer.stop()
        synthesizer.shutdown()
        ttsBuffer = ""
        super.onCleared()
    }

    private fun reduceStt(event: SttEvent) {
        when (event) {
            is SttEvent.Partial -> mutableState.update { it.copy(interim = event.text) }
            is SttEvent.Final ->
                mutableState.update {
                    it.copy(committedTranscript = appendFinalTranscript(it.committedTranscript, event.text), interim = "")
                }

            is SttEvent.Failure ->
                mutableState.update { it.copy(listening = false, interim = "", inputError = VoiceInputError.Failed(event.reason)) }

            SttEvent.Ended -> mutableState.update { it.copy(listening = false, interim = "") }
        }
    }

    private fun reduceChat(chunk: AiVoiceChunk) {
        when (chunk) {
            is AiVoiceChunk.Delta -> {
                mutableState.update { it.copy(stream = it.stream.copy(text = it.stream.text + chunk.text)) }
                speakDelta(chunk.text)
            }

            AiVoiceChunk.Done -> {
                flushTtsTail()
                completeChat()
            }

            is AiVoiceChunk.Failed -> failChat(chunk.message)
        }
    }

    /** Buffers a delta and speaks any complete sentences it produced — web handleEvent's `delta` branch. */
    private fun speakDelta(text: String) {
        if (!mutableState.value.ttsEnabled) return
        ttsBuffer += text
        val split = popCompleteSentences(ttsBuffer)
        ttsBuffer = split.remainder
        split.spoken.forEach { synthesizer.speak(it, language) }
    }

    /** Speaks whatever did not end on a sentence boundary — web handleEvent's `done` tail flush. */
    private fun flushTtsTail() {
        if (!mutableState.value.ttsEnabled) {
            ttsBuffer = ""
            return
        }
        val tail = ttsBuffer.trim()
        ttsBuffer = ""
        if (tail.isNotEmpty()) synthesizer.speak(tail, language)
    }

    /** Commits the stream as done and clears the transcript so a refresh does not repaint the spoken prompt. */
    private fun completeChat() {
        mutableState.update {
            it.copy(stream = it.stream.copy(phase = AiStreamPhase.Done), committedTranscript = "", interim = "")
        }
    }

    /** Promotes a still-streaming chat to done when the producer drains without a terminal frame (web hook parity). */
    private fun finishChatIfStreaming() {
        if (mutableState.value.stream.phase == AiStreamPhase.Streaming) {
            flushTtsTail()
            completeChat()
        }
    }

    /** Folds a terminal failure (frame or thrown) into the error surface and silences speech — web `error` branch. */
    private fun failChat(message: String) {
        synthesizer.stop()
        ttsBuffer = ""
        mutableState.update { it.copy(stream = it.stream.copy(phase = AiStreamPhase.Error, error = message)) }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIVoiceModeSource,
            recognizer: VoiceRecognizer,
            synthesizer: VoiceSynthesizer,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIVoiceModeViewModel(source, recognizer, synthesizer, logger) }
            }
    }
}
