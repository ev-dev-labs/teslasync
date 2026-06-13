// Shared off-device test fixtures for the AIVoiceMode surface (the :android:testReleaseUnitTest gate): a recording
// [Logger] that captures the PII-safe `view.opened` diagnostic, fake speech engines that record what they were
// asked to recognize / utter, and fake [AIVoiceModeSource]s — a scripted chat source that emits a fixed sequence
// then completes (terminal-state assertions) and a channel-backed recognizer that stays open until closed
// (transient-state assertions). Co-located with the surface's tests so both the model and view-model tests reuse
// one set of fixtures.

package io.teslasync.android.sharedsurfaces.aivoicemode

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow

/** A [Logger] that records every emitted record, so tests can assert the diagnostics contract (P1/S11). */
internal class RecordingLogger : Logger {
    val events = mutableListOf<Pair<String, Map<String, String>>>()

    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) {
        events += event to fields
    }
}

/** A [VoiceSynthesizer] that records spoken sentences + stop/shutdown counts instead of touching the platform. */
internal class FakeVoiceSynthesizer : VoiceSynthesizer {
    val spoken = mutableListOf<String>()
    var stops = 0
    var shutdowns = 0

    override fun speak(
        text: String,
        languageTag: String,
    ) {
        spoken += text
    }

    override fun stop() {
        stops++
    }

    override fun shutdown() {
        shutdowns++
    }
}

/** A [VoiceRecognizer] that emits a scripted [SttEvent] sequence then completes — the common terminal-state fake. */
internal class ScriptedVoiceRecognizer(
    private val available: Boolean = true,
    private val events: List<SttEvent> = emptyList(),
) : VoiceRecognizer {
    var listens = 0
    var lastLanguageTag: String? = null

    override fun isAvailable(): Boolean = available

    override fun listen(languageTag: String): Flow<SttEvent> {
        listens++
        lastLanguageTag = languageTag
        return flow { events.forEach { emit(it) } }
    }
}

/** A channel-backed [VoiceRecognizer] whose session stays open until [channel] closes — for transient assertions. */
internal class ManualVoiceRecognizer(
    private val available: Boolean = true,
) : VoiceRecognizer {
    val channel = Channel<SttEvent>(Channel.UNLIMITED)
    var listens = 0

    override fun isAvailable(): Boolean = available

    override fun listen(languageTag: String): Flow<SttEvent> {
        listens++
        return channel.receiveAsFlow()
    }
}

/**
 * A scripted [AIVoiceModeSource] — emits a fixed [chunks] sequence (or throws [throwOnChat]) per chat call and
 * exposes the AI gate + connectivity as mutable flows so tests can flip them.
 */
internal class FakeVoiceSource(
    val enabled: MutableStateFlow<Boolean> = MutableStateFlow(true),
    val online: MutableStateFlow<Boolean> = MutableStateFlow(true),
    private val chunks: List<AiVoiceChunk> = emptyList(),
    private val throwOnChat: Throwable? = null,
) : AIVoiceModeSource {
    var chatCalls = 0
    var lastMessage: String? = null
    var lastSessionId: String? = null

    override fun aiEnabled(): StateFlow<Boolean> = enabled

    override fun connectivity(): StateFlow<Boolean> = online

    override fun chat(
        message: String,
        sessionId: String,
    ): Flow<AiVoiceChunk> {
        chatCalls++
        lastMessage = message
        lastSessionId = sessionId
        return flow {
            throwOnChat?.let { throw it }
            chunks.forEach { emit(it) }
        }
    }
}

/** A channel-backed [AIVoiceModeSource] whose chat stream stays open until [channel] closes — transient assertions. */
internal class ManualVoiceSource(
    val enabled: MutableStateFlow<Boolean> = MutableStateFlow(true),
    val online: MutableStateFlow<Boolean> = MutableStateFlow(true),
) : AIVoiceModeSource {
    val channel = Channel<AiVoiceChunk>(Channel.UNLIMITED)
    var chatCalls = 0

    override fun aiEnabled(): StateFlow<Boolean> = enabled

    override fun connectivity(): StateFlow<Boolean> = online

    override fun chat(
        message: String,
        sessionId: String,
    ): Flow<AiVoiceChunk> {
        chatCalls++
        return channel.receiveAsFlow()
    }
}
