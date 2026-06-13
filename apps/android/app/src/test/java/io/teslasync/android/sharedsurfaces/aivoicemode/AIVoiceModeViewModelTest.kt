// Off-device unit tests for [AIVoiceModeViewModel] over controllable fakes (the :android:testReleaseUnitTest
// gate). They cover the speech-to-text lifecycle the web `SpeechRecognition` drives (unsupported → error,
// interim preview, final accumulation, terminal failure, stop), the spoken-replies toggle (web `toggleTts`), the
// voice-chat stream the web `useAiStream` composition drives (streaming → done with accumulated text + spoken
// sentences, the terminal failure frame, a thrown transport failure, the complete-without-terminal-frame
// promotion to done, the transcript clear on success), the stop-all behaviour, the not-ready / busy / offline
// no-ops, the AI gate (web `withAiFeature`), the connectivity offline flag, the stable session id, and the
// PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is not needed here — the test lives in the surface's real package directory.
package io.teslasync.android.sharedsurfaces.aivoicemode

import io.teslasync.android.sharedsurfaces.aifeaturecard.AiStreamPhase
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private const val FIXED_CLOCK: Long = 1_700_000_000_000L
private const val FIXED_SUFFIX: String = "abc12345"

@OptIn(ExperimentalCoroutinesApi::class)
class AIVoiceModeViewModelTest {
    // ── speech-to-text lifecycle ────────────────────────────────────────────────────────────────────────────────
    @Test
    fun unsupportedRecognizerReflectsInStateAndStartIsRefused() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(available = false)
            val vm = viewModel(FakeVoiceSource(), recognizer)
            advanceUntilIdle()
            assertFalse(vm.state.value.sttSupported)

            vm.startListening()
            advanceUntilIdle()

            assertEquals(0, recognizer.listens)
            assertEquals(VoiceInputError.Unsupported, vm.state.value.inputError)
        }

    @Test
    fun finalResultsAccumulateIntoTranscript() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("hello"), SttEvent.Final("world")))
            val vm = viewModel(FakeVoiceSource(), recognizer)

            vm.startListening()
            advanceUntilIdle()

            assertEquals("hello world", vm.state.value.committedTranscript)
            assertFalse(vm.state.value.listening)
            assertEquals("en-US", recognizer.lastLanguageTag)
        }

    @Test
    fun partialResultPreviewsAsInterimThenFinalCommits() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ManualVoiceRecognizer()
            val vm = viewModel(FakeVoiceSource(), recognizer)

            vm.startListening()
            advanceUntilIdle()
            assertTrue(vm.state.value.listening)

            recognizer.channel.send(SttEvent.Partial("how is"))
            advanceUntilIdle()
            assertEquals("how is", vm.state.value.transcript)

            recognizer.channel.send(SttEvent.Final("how is my battery"))
            advanceUntilIdle()
            assertEquals("how is my battery", vm.state.value.committedTranscript)
            assertEquals("how is my battery", vm.state.value.transcript)
        }

    @Test
    fun recognizerFailureSurfacesTheFailedError() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Failure("no-speech")))
            val vm = viewModel(FakeVoiceSource(), recognizer)

            vm.startListening()
            advanceUntilIdle()

            assertEquals(VoiceInputError.Failed("no-speech"), vm.state.value.inputError)
            assertFalse(vm.state.value.listening)
        }

    @Test
    fun stopListeningEndsTheSession() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ManualVoiceRecognizer()
            val vm = viewModel(FakeVoiceSource(), recognizer)

            vm.startListening()
            advanceUntilIdle()
            assertTrue(vm.state.value.listening)

            vm.stopListening()
            advanceUntilIdle()
            assertFalse(vm.state.value.listening)
            assertEquals("", vm.state.value.interim)
        }

    // ── spoken-replies toggle ───────────────────────────────────────────────────────────────────────────────────
    @Test
    fun toggleTtsFlipsAndSilencesSpeech() =
        runTest(UnconfinedTestDispatcher()) {
            val synth = FakeVoiceSynthesizer()
            val vm = viewModel(FakeVoiceSource(), synthesizer = synth)
            assertTrue(vm.state.value.ttsEnabled)

            vm.toggleTts()
            assertFalse(vm.state.value.ttsEnabled)
            assertTrue(synth.stops >= 1)

            vm.toggleTts()
            assertTrue(vm.state.value.ttsEnabled)
        }

    // ── voice-chat stream ───────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun sendStreamsAccumulatesSpeaksAndClearsTranscriptOnDone() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("How efficient was my drive")))
            val source =
                FakeVoiceSource(
                    chunks = listOf(AiVoiceChunk.Delta("Smooth drive. "), AiVoiceChunk.Delta("No anomalies."), AiVoiceChunk.Done),
                )
            val synth = FakeVoiceSynthesizer()
            val vm = viewModel(source, recognizer, synth)

            vm.startListening()
            advanceUntilIdle()
            vm.send()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(AiStreamPhase.Done, state.stream.phase)
            assertEquals("Smooth drive. No anomalies.", state.stream.text)
            assertEquals(listOf("Smooth drive.", "No anomalies."), synth.spoken)
            assertEquals("How efficient was my drive", source.lastMessage)
            assertEquals("", state.committedTranscript)
        }

    @Test
    fun ttsDisabledSpeaksNothing() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("ask")))
            val source = FakeVoiceSource(chunks = listOf(AiVoiceChunk.Delta("Reply. "), AiVoiceChunk.Done))
            val synth = FakeVoiceSynthesizer()
            val vm = viewModel(source, recognizer, synth)

            vm.startListening()
            advanceUntilIdle()
            vm.toggleTts()
            vm.send()
            advanceUntilIdle()

            assertTrue(synth.spoken.isEmpty())
            assertEquals(AiStreamPhase.Done, vm.state.value.stream.phase)
        }

    @Test
    fun terminalFailureFrameRendersErrorAndKeepsPartialText() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("ask")))
            val source = FakeVoiceSource(chunks = listOf(AiVoiceChunk.Delta("partial"), AiVoiceChunk.Failed("stream_http_503")))
            val vm = viewModel(source, recognizer)

            vm.startListening()
            advanceUntilIdle()
            vm.send()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(AiStreamPhase.Error, state.stream.phase)
            assertEquals("stream_http_503", state.stream.error)
            assertEquals("partial", state.stream.text)
        }

    @Test
    fun thrownTransportFailureRendersError() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("ask")))
            val source = FakeVoiceSource(throwOnChat = RuntimeException("boom"))
            val vm = viewModel(source, recognizer)

            vm.startListening()
            advanceUntilIdle()
            vm.send()
            advanceUntilIdle()

            assertEquals(AiStreamPhase.Error, vm.state.value.stream.phase)
            assertEquals("boom", vm.state.value.stream.error)
        }

    @Test
    fun completeWithoutTerminalFrameSettlesAsDone() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("ask")))
            val source = FakeVoiceSource(chunks = listOf(AiVoiceChunk.Delta("reply with no done frame")))
            val synth = FakeVoiceSynthesizer()
            val vm = viewModel(source, recognizer, synth)

            vm.startListening()
            advanceUntilIdle()
            vm.send()
            advanceUntilIdle()

            assertEquals(AiStreamPhase.Done, vm.state.value.stream.phase)
            assertEquals(listOf("reply with no done frame"), synth.spoken)
        }

    @Test
    fun sendWithBlankTranscriptIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeVoiceSource(chunks = listOf(AiVoiceChunk.Done))
            val vm = viewModel(source)

            vm.send()
            advanceUntilIdle()

            assertEquals(0, source.chatCalls)
            assertEquals(AiStreamPhase.Idle, vm.state.value.stream.phase)
        }

    @Test
    fun sendWhileStreamingIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("ask")))
            val source = ManualVoiceSource()
            val vm = viewModel(source, recognizer)

            vm.startListening()
            advanceUntilIdle()
            vm.send()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Streaming, vm.state.value.stream.phase)

            vm.send()
            advanceUntilIdle()
            assertEquals(1, source.chatCalls)
        }

    @Test
    fun stopAllReturnsStreamingToIdleKeepingLastText() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("ask")))
            val source = ManualVoiceSource()
            val vm = viewModel(source, recognizer)

            vm.startListening()
            advanceUntilIdle()
            vm.send()
            advanceUntilIdle()
            source.channel.send(AiVoiceChunk.Delta("partial"))
            advanceUntilIdle()
            assertEquals("partial", vm.state.value.stream.text)

            vm.stopAll()
            advanceUntilIdle()
            assertEquals(AiStreamPhase.Idle, vm.state.value.stream.phase)
            assertEquals("partial", vm.state.value.stream.text)
            assertFalse(vm.state.value.listening)
        }

    // ── gating + connectivity ───────────────────────────────────────────────────────────────────────────────────
    @Test
    fun gatedReflectsAiEnabledFlag() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeVoiceSource()
            source.enabled.value = false
            val vm = viewModel(source)
            advanceUntilIdle()
            assertFalse(vm.state.value.gated)

            source.enabled.value = true
            advanceUntilIdle()
            assertTrue(vm.state.value.gated)
        }

    @Test
    fun offlineConnectivityFlagsStateAndRefusesSend() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("ask")))
            val source = FakeVoiceSource()
            source.online.value = false
            val vm = viewModel(source, recognizer)

            vm.startListening()
            advanceUntilIdle()
            assertFalse(vm.state.value.online)

            vm.send()
            advanceUntilIdle()
            assertEquals(0, source.chatCalls)
        }

    // ── session id + diagnostics ────────────────────────────────────────────────────────────────────────────────
    @Test
    fun sessionIdIsFormattedAndStableAcrossSends() =
        runTest(UnconfinedTestDispatcher()) {
            val recognizer = ScriptedVoiceRecognizer(events = listOf(SttEvent.Final("ask")))
            val source = FakeVoiceSource(chunks = listOf(AiVoiceChunk.Done))
            val vm = viewModel(source, recognizer)

            vm.startListening()
            advanceUntilIdle()
            vm.send()
            advanceUntilIdle()
            val first = source.lastSessionId

            vm.startListening()
            advanceUntilIdle()
            vm.send()
            advanceUntilIdle()
            val second = source.lastSessionId

            assertEquals("voice_${FIXED_CLOCK}_$FIXED_SUFFIX", first)
            assertEquals(first, second)
        }

    @Test
    fun onViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeVoiceSource(), logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("slug" to "AIVoiceMode"), opened.single().second)
        }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
    private fun TestScope.viewModel(
        source: AIVoiceModeSource,
        recognizer: VoiceRecognizer = ScriptedVoiceRecognizer(),
        synthesizer: VoiceSynthesizer = FakeVoiceSynthesizer(),
        logger: Logger = RecordingLogger(),
    ): AIVoiceModeViewModel =
        AIVoiceModeViewModel(
            source = source,
            recognizer = recognizer,
            synthesizer = synthesizer,
            logger = logger,
            scope = backgroundScope,
            sessionIdProvider = { "voice_${FIXED_CLOCK}_$FIXED_SUFFIX" },
        )
}
