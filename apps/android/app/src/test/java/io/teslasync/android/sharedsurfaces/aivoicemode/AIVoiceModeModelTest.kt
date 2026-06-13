// Off-device unit tests for the pure AIVoiceMode model: the TTS sentence chunker (every flush + remainder branch
// the web `popCompleteSentences` resolves), the transcript accumulation (web `onresult`) + interim join, the
// input-slot projection (the mic-enable / unsupported-hint / stop-affordance rules + the idle/listening/has-text
// hint selection), the merged transcript accessibility announcement, the session-id format, the i18n key
// inventory, and the PII-safe `view.opened` diagnostic. Run by the offline :android:testReleaseUnitTest gate — no
// Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.aivoicemode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AIVoiceModeModelTest {
    // ── TTS sentence chunking (web popCompleteSentences) ────────────────────────────────────────────────────────
    @Test
    fun popCompleteSentencesFlushesOneCompleteSentence() {
        val split = popCompleteSentences("Hello there. ")
        assertEquals(listOf("Hello there."), split.spoken)
        assertEquals("", split.remainder)
    }

    @Test
    fun popCompleteSentencesFlushesMultipleAndKeepsRemainder() {
        val split = popCompleteSentences("One. Two! Three? leftover")
        assertEquals(listOf("One.", "Two!", "Three?"), split.spoken)
        assertEquals("leftover", split.remainder)
    }

    @Test
    fun popCompleteSentencesBuffersWhenNoBoundary() {
        val split = popCompleteSentences("no terminator yet")
        assertTrue(split.spoken.isEmpty())
        assertEquals("no terminator yet", split.remainder)
    }

    @Test
    fun popCompleteSentencesNeedsTrailingWhitespaceToFlush() {
        // A terminator with no following whitespace is mid-token (e.g. a decimal) — keep buffering.
        val split = popCompleteSentences("3.14 is pi")
        assertTrue(split.spoken.isEmpty())
        assertEquals("3.14 is pi", split.remainder)
    }

    // ── Transcript accumulation (web onresult) ──────────────────────────────────────────────────────────────────
    @Test
    fun appendFinalTranscriptStartsFromEmpty() {
        assertEquals("hello", appendFinalTranscript("", "hello"))
    }

    @Test
    fun appendFinalTranscriptJoinsWithSingleSpace() {
        assertEquals("hello world", appendFinalTranscript("hello ", "world"))
    }

    @Test
    fun appendFinalTranscriptIgnoresBlankChunk() {
        assertEquals("hello", appendFinalTranscript("hello", "   "))
    }

    @Test
    fun joinInterimTrailsCommittedWithSpace() {
        assertEquals("hello world", joinInterim("hello", "world"))
        assertEquals("hello", joinInterim("hello", ""))
        assertEquals("world", joinInterim("", "world"))
        assertEquals("", joinInterim("", ""))
    }

    // ── Input-slot projection (web inputSlot derivation) ────────────────────────────────────────────────────────
    @Test
    fun inputViewDerivesControlRules() {
        val idle = view(transcript = "", sttSupported = true, busy = false)
        assertFalse(idle.hasTranscript)
        assertTrue(idle.micEnabled)
        assertFalse(idle.showStop)
        assertFalse(idle.showUnsupportedHint)

        val busy = view(transcript = "ask", sttSupported = true, busy = true)
        assertTrue(busy.hasTranscript)
        assertFalse("mic disabled while a reply streams", busy.micEnabled)
        assertTrue("stop shown while busy", busy.showStop)
    }

    @Test
    fun unsupportedHintShowsOnlyWithoutRecognizerAndError() {
        assertTrue(view(sttSupported = false, error = null).showUnsupportedHint)
        assertFalse(view(sttSupported = false, error = VoiceInputError.Unsupported).showUnsupportedHint)
        assertFalse(view(sttSupported = true, error = null).showUnsupportedHint)
    }

    @Test
    fun transcriptHintFollowsListeningAndContent() {
        assertEquals(TranscriptHint.Idle, transcriptHintFor(view(transcript = "", listening = false)))
        assertEquals(TranscriptHint.Listening, transcriptHintFor(view(transcript = "", listening = true)))
        assertEquals(TranscriptHint.None, transcriptHintFor(view(transcript = "spoken", listening = true)))
    }

    // ── Accessibility ───────────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun transcriptAnnouncementFoldsLabelAndBody() {
        assertEquals("Voice transcript", transcriptAnnouncement("Voice transcript", "   "))
        assertEquals("Voice transcript. How is my battery?", transcriptAnnouncement("Voice transcript", "How is my battery?"))
    }

    // ── Session id (web newVoiceSessionId) ──────────────────────────────────────────────────────────────────────
    @Test
    fun sessionIdFollowsTheWebFormat() {
        assertEquals("voice_1700000000000_ab12cd34", newVoiceSessionId(1_700_000_000_000L, "ab12cd34"))
    }

    // ── i18n inventory (every web t(key) this surface makes) ────────────────────────────────────────────────────
    @Test
    fun keyInventoryIsCompleteAndUnique() {
        // The 20 keys the web AIVoiceMode references (title/description/button + transcript/hints + 10 actions + 2 errors).
        assertEquals(20, VoiceModeKeys.ALL.size)
        assertEquals(VoiceModeKeys.ALL.size, VoiceModeKeys.ALL.toSet().size)
        assertTrue(VoiceModeKeys.ALL.containsAll(listOf(VoiceModeKeys.TITLE, VoiceModeKeys.BUTTON, VoiceModeKeys.ERROR_STT_FAILED)))
        assertTrue(VoiceModeKeys.ALL.all { it.startsWith("voiceMode.") })
    }

    // ── Telemetry (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun recordViewOpenedEmitsSlugOnly() {
        val logger = RecordingLogger()
        recordAIVoiceModeViewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("slug" to "AIVoiceMode"), opened.second)
    }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
    @Suppress("LongParameterList")
    private fun view(
        transcript: String = "",
        listening: Boolean = false,
        ttsEnabled: Boolean = true,
        sttSupported: Boolean = true,
        error: VoiceInputError? = null,
        busy: Boolean = false,
    ): VoiceInputView = VoiceInputView(transcript, listening, ttsEnabled, sttSupported, error, busy)
}
