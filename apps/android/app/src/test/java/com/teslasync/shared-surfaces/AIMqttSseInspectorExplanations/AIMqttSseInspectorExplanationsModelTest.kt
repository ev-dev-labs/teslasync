// Off-device unit tests for the pure AIMqttSseInspectorExplanations model: the window-validity guard (web
// `haveWindow`), the request-body parity (web memoized `body`), the stream reducer, the surface classifier
// (every loading / empty / content / error / stale / offline branch the web component resolves), the freshness
// rule, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimqttsseinspectorexplanations

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIMqttSseInspectorExplanationsModelTest {
    private val window = EXPLAINER_FRESHNESS_WINDOW_MS

    // ── window validity guard (web haveWindow) ──────────────────────────────────────
    @Test
    fun windowIsValidOnlyWithPositiveStartAndLaterEnd() {
        assertTrue(ExplainerWindow(fromUnix = 100L, toUnix = 200L).isValid)
        assertFalse(ExplainerWindow(fromUnix = null, toUnix = 200L).isValid)
        assertFalse(ExplainerWindow(fromUnix = 100L, toUnix = null).isValid)
        assertFalse(ExplainerWindow(fromUnix = 0L, toUnix = 200L).isValid)
        assertFalse(ExplainerWindow(fromUnix = -5L, toUnix = 200L).isValid)
        assertFalse(ExplainerWindow(fromUnix = 200L, toUnix = 100L).isValid)
        assertFalse(ExplainerWindow(fromUnix = 200L, toUnix = 200L).isValid)
    }

    // ── request body parity (web memoized body) ─────────────────────────────────────
    @Test
    fun explainRequestBodyShipsWindowWhenValid() {
        assertEquals(
            ExplainRequestBody(fromUnix = 100L, toUnix = 200L),
            explainRequestBody(ExplainerWindow(fromUnix = 100L, toUnix = 200L)),
        )
    }

    @Test
    fun explainRequestBodyShipsZeroedBodyWhenInvalid() {
        assertEquals(ExplainRequestBody(0L, 0L), explainRequestBody(ExplainerWindow()))
        assertEquals(ExplainRequestBody(0L, 0L), explainRequestBody(ExplainerWindow(fromUnix = 200L, toUnix = 100L)))
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startGeneratingEntersStreamingAndClearsTransients() {
        val next =
            MqttExplainerState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startGenerating()
        assertEquals(ExplainerPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            MqttExplainerState(phase = ExplainerPhase.Streaming)
                .onChunk(ExplainerChunk.Delta("Hel"), nowMs = 1L)
                .onChunk(ExplainerChunk.Delta("ix"), nowMs = 2L)
        assertEquals("Helix", next.streamingText)
        assertEquals(ExplainerPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            MqttExplainerState(phase = ExplainerPhase.Streaming, streamingText = "done text")
                .onChunk(ExplainerChunk.Done, nowMs = 42L)
        assertEquals(ExplainerPhase.Done, next.phase)
        assertEquals("done text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            MqttExplainerState(phase = ExplainerPhase.Streaming, streamingText = "   ")
                .onChunk(ExplainerChunk.Done, nowMs = 7L)
        assertEquals(ExplainerPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            MqttExplainerState(phase = ExplainerPhase.Streaming, committedText = "prev")
                .onChunk(ExplainerChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(ExplainerPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = MqttExplainerState(phase = ExplainerPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(ExplainerPhase.Done, promoted.phase)
        val untouched = MqttExplainerState(phase = ExplainerPhase.Failed).finishIfStreaming(9L)
        assertEquals(ExplainerPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface =
            classifyExplainer(
                MqttExplainerState(gateEnabled = false, window = ExplainerWindow(100L, 200L)),
                nowMs = 0L,
            )
        assertEquals(ExplainerSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            ExplainerSurface.Resting(canStart = true),
            classifyExplainer(MqttExplainerState(window = ExplainerWindow(100L, 200L)), nowMs = 0L),
        )
        assertEquals(
            ExplainerSurface.Resting(canStart = false),
            classifyExplainer(MqttExplainerState(window = ExplainerWindow()), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyExplainer(
                MqttExplainerState(window = ExplainerWindow(100L, 200L), phase = ExplainerPhase.Streaming),
                nowMs = 0L,
            )
        assertEquals(ExplainerSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyExplainer(
                MqttExplainerState(
                    window = ExplainerWindow(100L, 200L),
                    phase = ExplainerPhase.Streaming,
                    streamingText = "partial",
                ),
                nowMs = 0L,
            )
        assertEquals(ExplainerSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyExplainer(
                MqttExplainerState(
                    window = ExplainerWindow(100L, 200L),
                    phase = ExplainerPhase.Done,
                    committedText = "explained",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(ExplainerSurface.Ready("explained", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyExplainer(
                MqttExplainerState(
                    window = ExplainerWindow(100L, 200L),
                    phase = ExplainerPhase.Done,
                    committedText = "explained",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(ExplainerSurface.Ready("explained", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyExplainer(
                MqttExplainerState(window = ExplainerWindow(100L, 200L), phase = ExplainerPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(ExplainerSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyExplainer(
                MqttExplainerState(
                    window = ExplainerWindow(100L, 200L),
                    phase = ExplainerPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(ExplainerSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyExplainer(
                MqttExplainerState(
                    window = ExplainerWindow(100L, 200L),
                    phase = ExplainerPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(ExplainerSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyExplainer(
                MqttExplainerState(
                    window = ExplainerWindow(100L, 200L),
                    phase = ExplainerPhase.Failed,
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(ExplainerSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyExplainer(
                MqttExplainerState(
                    window = ExplainerWindow(100L, 200L),
                    phase = ExplainerPhase.Failed,
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(ExplainerSurface.Failed(offline = false), surface)
    }

    // ── freshness ───────────────────────────────────────────────────────────────────
    @Test
    fun isStaleHonorsWindowAndNullStamp() {
        assertFalse(isStale(fetchedAt = null, nowMs = 10_000L, windowMs = window))
        assertFalse(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window, windowMs = window))
        assertTrue(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window + 1L, windowMs = window))
    }

    // ── accessibility labels ─────────────────────────────────────────────────────────
    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        val label = headerAccessibilityLabel("Helix stream explainer", "Helix", "Explain the broker envelope.")
        assertEquals("Helix stream explainer (Helix). Explain the broker envelope.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            ExplainerOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(ExplainerSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(ExplainerSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(ExplainerSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(ExplainerSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(ExplainerSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(ExplainerSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(ExplainerSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(ExplainerSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = ExplainerOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(ExplainerSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(ExplainerSurface.Hidden, labels))
    }
}
