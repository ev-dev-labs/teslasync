// Off-device unit tests for the pure AIVehiclePaintPreview model: the style-hint resolver (trim / omit-when-
// blank / clamp to the handler's 80-char cap), the draft-endpoint path + request-body builders (the wire
// contract against /ai/vehicles/{id}/paint-preview/draft and the optional style_hint key), the stream reducer,
// the surface classifier (every loading / empty / content / error / stale / offline branch the web component
// resolves), the freshness rule, and the accessibility-label builders (TalkBack-label presence, including the
// no-vehicle hint). Run by the offline :android:testReleaseUnitTest gate — no Compose, no Android framework,
// no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aivehiclepaintpreview

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIVehiclePaintPreviewModelTest {
    private val window = PAINT_PREVIEW_FRESHNESS_WINDOW_MS

    // ── style-hint resolver ──────────────────────────────────────────────────────────
    @Test
    fun normalizeStyleHintOmitsBlankOrAbsent() {
        assertNull(normalizeStyleHint(null))
        assertNull(normalizeStyleHint(""))
        assertNull(normalizeStyleHint("   "))
        assertNull(normalizeStyleHint("\t\n "))
    }

    @Test
    fun normalizeStyleHintTrimsSurroundingWhitespace() {
        assertEquals("studio", normalizeStyleHint("  studio  "))
        assertEquals("sunset glow", normalizeStyleHint("\tsunset glow\n"))
    }

    @Test
    fun normalizeStyleHintClampsToServerCap() {
        val long = "a".repeat(PAINT_PREVIEW_STYLE_HINT_MAX_CHARS + 40)
        val resolved = normalizeStyleHint(long)
        assertEquals(PAINT_PREVIEW_STYLE_HINT_MAX_CHARS, resolved?.length)
        assertEquals("a".repeat(PAINT_PREVIEW_STYLE_HINT_MAX_CHARS), resolved)
    }

    @Test
    fun normalizeStyleHintKeepsHintsWithinCap() {
        assertEquals("outdoor", normalizeStyleHint("outdoor"))
    }

    // ── wire contract: path + body ─────────────────────────────────────────────────────
    @Test
    fun draftPathMatchesBackendRoute() {
        assertEquals("/ai/vehicles/42/paint-preview/draft", paintPreviewDraftPath(42L))
        assertEquals("/ai/vehicles/1/paint-preview/draft", paintPreviewDraftPath(1L))
    }

    @Test
    fun requestBodyOmitsStyleHintWhenNull() {
        assertEquals(emptyMap<String, String>(), paintPreviewRequestBody(null))
    }

    @Test
    fun requestBodyCarriesStyleHintWhenPresent() {
        assertEquals(mapOf("style_hint" to "studio"), paintPreviewRequestBody("studio"))
        assertEquals(PAINT_PREVIEW_STYLE_HINT_FIELD, paintPreviewRequestBody("x").keys.single())
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startDraftingEntersStreamingAndClearsTransients() {
        val next =
            PaintPreviewState(streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startDrafting()
        assertEquals(PaintPreviewPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            PaintPreviewState(phase = PaintPreviewPhase.Streaming)
                .onChunk(PaintPreviewChunk.Delta("Stealth "), nowMs = 1L)
                .onChunk(PaintPreviewChunk.Delta("Grey"), nowMs = 2L)
        assertEquals("Stealth Grey", next.streamingText)
        assertEquals(PaintPreviewPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            PaintPreviewState(phase = PaintPreviewPhase.Streaming, streamingText = "drafted prompt")
                .onChunk(PaintPreviewChunk.Done, nowMs = 42L)
        assertEquals(PaintPreviewPhase.Done, next.phase)
        assertEquals("drafted prompt", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            PaintPreviewState(phase = PaintPreviewPhase.Streaming, streamingText = "   ")
                .onChunk(PaintPreviewChunk.Done, nowMs = 7L)
        assertEquals(PaintPreviewPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            PaintPreviewState(phase = PaintPreviewPhase.Streaming, committedText = "prev")
                .onChunk(PaintPreviewChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(PaintPreviewPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = PaintPreviewState(phase = PaintPreviewPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(PaintPreviewPhase.Done, promoted.phase)
        val untouched = PaintPreviewState(phase = PaintPreviewPhase.Failed).finishIfStreaming(9L)
        assertEquals(PaintPreviewPhase.Failed, untouched.phase)
    }

    // ── canStart ────────────────────────────────────────────────────────────────────
    @Test
    fun canStartRequiresPositiveVehicleId() {
        assertTrue(PaintPreviewState(vehicleId = 1L).canStart)
        assertFalse(PaintPreviewState(vehicleId = 0L).canStart)
        assertFalse(PaintPreviewState(vehicleId = -3L).canStart)
        assertFalse(PaintPreviewState(vehicleId = null).canStart)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyPaintPreview(PaintPreviewState(gateEnabled = false, vehicleId = 1L), nowMs = 0L)
        assertEquals(PaintPreviewSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            PaintPreviewSurface.Resting(canStart = true),
            classifyPaintPreview(PaintPreviewState(vehicleId = 1L), nowMs = 0L),
        )
        assertEquals(
            PaintPreviewSurface.Resting(canStart = false),
            classifyPaintPreview(PaintPreviewState(vehicleId = null), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyPaintPreview(PaintPreviewState(vehicleId = 1L, phase = PaintPreviewPhase.Streaming), nowMs = 0L)
        assertEquals(PaintPreviewSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyPaintPreview(
                PaintPreviewState(vehicleId = 1L, phase = PaintPreviewPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(PaintPreviewSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyPaintPreview(
                PaintPreviewState(
                    vehicleId = 1L,
                    phase = PaintPreviewPhase.Done,
                    committedText = "drafted",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(PaintPreviewSurface.Ready("drafted", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyPaintPreview(
                PaintPreviewState(
                    vehicleId = 1L,
                    phase = PaintPreviewPhase.Done,
                    committedText = "drafted",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(PaintPreviewSurface.Ready("drafted", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyPaintPreview(
                PaintPreviewState(vehicleId = 1L, phase = PaintPreviewPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(PaintPreviewSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyPaintPreview(
                PaintPreviewState(
                    vehicleId = 1L,
                    phase = PaintPreviewPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(PaintPreviewSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyPaintPreview(
                PaintPreviewState(
                    vehicleId = 1L,
                    phase = PaintPreviewPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(PaintPreviewSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyPaintPreview(
                PaintPreviewState(vehicleId = 1L, phase = PaintPreviewPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(PaintPreviewSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyPaintPreview(
                PaintPreviewState(vehicleId = 1L, phase = PaintPreviewPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(PaintPreviewSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Draft a Helix paint preview", "Helix", "Preview paint color.")
        assertEquals("Draft a Helix paint preview (Helix). Preview paint color.", label)
    }

    @Test
    fun headerLabelAppendsNoVehicleHintWhenPresent() {
        val label =
            headerAccessibilityLabel(
                title = "Draft a Helix paint preview",
                badge = "Helix",
                description = "Preview paint color.",
                hint = "Open a vehicle detail page to enable Helix.",
            )
        assertEquals(
            "Draft a Helix paint preview (Helix). Preview paint color. Open a vehicle detail page to enable Helix.",
            label,
        )
    }

    @Test
    fun headerLabelOmitsBlankHint() {
        val withNull = headerAccessibilityLabel("T", "Helix", "D", hint = null)
        val withBlank = headerAccessibilityLabel("T", "Helix", "D", hint = "   ")
        assertEquals("T (Helix). D", withNull)
        assertEquals("T (Helix). D", withBlank)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            PaintPreviewOutputLabels(
                working = "Helix is drafting a paint preview",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is drafting a paint preview", outputAccessibilityLabel(PaintPreviewSurface.Working, labels))
        assertEquals("Helix is drafting a paint preview", outputAccessibilityLabel(PaintPreviewSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(PaintPreviewSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(PaintPreviewSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(PaintPreviewSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(PaintPreviewSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(PaintPreviewSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(PaintPreviewSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = PaintPreviewOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(PaintPreviewSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(PaintPreviewSurface.Hidden, labels))
    }
}
