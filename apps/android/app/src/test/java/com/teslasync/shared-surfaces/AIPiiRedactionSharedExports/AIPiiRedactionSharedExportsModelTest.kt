// Off-device unit tests for the pure AIPiiRedactionSharedExports model: the export-type catalog, the
// non-blank-export-type `canStart` predicate, the export-type binder, the stream reducer, the surface
// classifier (every loading / empty / content / error / stale / offline branch the web component resolves), the
// freshness rule, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipiiredactionsharedexports

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIPiiRedactionSharedExportsModelTest {
    private val window = REDACTION_FRESHNESS_WINDOW_MS

    // ── export-type catalog (parity with web SHARED_EXPORT_TYPES) ────────────────────
    @Test
    fun sharedExportTypesMatchWebAllowSetInOrder() {
        assertEquals(
            listOf("drives", "charging", "trips", "analytics", "backup", "account"),
            SHARED_EXPORT_TYPES.map { it.slug },
        )
    }

    @Test
    fun sharedExportTypeForSlugResolvesKnownAndRejectsUnknown() {
        assertEquals(SharedExportType.Charging, sharedExportTypeForSlug("charging"))
        assertEquals(SharedExportType.Account, sharedExportTypeForSlug("account"))
        assertNull(sharedExportTypeForSlug("vehicles"))
        assertNull(sharedExportTypeForSlug(""))
    }

    // ── canStart: a non-blank export type ───────────────────────────────────────────
    @Test
    fun canStartRequiresANonBlankExportType() {
        assertTrue(AiRedactionPlanState(exportType = "drives").canStart)
        assertFalse(AiRedactionPlanState(exportType = "").canStart)
        assertFalse(AiRedactionPlanState(exportType = "   ").canStart)
    }

    @Test
    fun withExportTypeBindsTheChosenType() {
        val next = AiRedactionPlanState().withExportType("backup")
        assertEquals("backup", next.exportType)
        assertTrue(next.canStart)
    }

    // ── reducer ───────────────────────────────────────────────────────────────────
    @Test
    fun startPlanningEntersStreamingAndClearsTransients() {
        val next =
            AiRedactionPlanState(
                exportType = "drives",
                streamingText = "old",
                errorKind = ErrorKind.Http,
                committedText = "kept",
            ).startPlanning()
        assertEquals(RedactionPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
        assertEquals("drives", next.exportType)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiRedactionPlanState(phase = RedactionPhase.Streaming)
                .onChunk(AiRedactionChunk.Delta("Redact "), nowMs = 1L)
                .onChunk(AiRedactionChunk.Delta("GPS"), nowMs = 2L)
        assertEquals("Redact GPS", next.streamingText)
        assertEquals(RedactionPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiRedactionPlanState(phase = RedactionPhase.Streaming, streamingText = "plan text")
                .onChunk(AiRedactionChunk.Done, nowMs = 42L)
        assertEquals(RedactionPhase.Done, next.phase)
        assertEquals("plan text", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiRedactionPlanState(phase = RedactionPhase.Streaming, streamingText = "   ")
                .onChunk(AiRedactionChunk.Done, nowMs = 7L)
        assertEquals(RedactionPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            AiRedactionPlanState(phase = RedactionPhase.Streaming, committedText = "prev")
                .onChunk(AiRedactionChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(RedactionPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiRedactionPlanState(phase = RedactionPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(RedactionPhase.Done, promoted.phase)
        val untouched = AiRedactionPlanState(phase = RedactionPhase.Failed).finishIfStreaming(9L)
        assertEquals(RedactionPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        val surface = classifyRedaction(AiRedactionPlanState(gateEnabled = false, exportType = "drives"), nowMs = 0L)
        assertEquals(RedactionSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            RedactionSurface.Resting(canStart = true),
            classifyRedaction(AiRedactionPlanState(exportType = "drives"), nowMs = 0L),
        )
        assertEquals(
            RedactionSurface.Resting(canStart = false),
            classifyRedaction(AiRedactionPlanState(exportType = ""), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyRedaction(AiRedactionPlanState(exportType = "drives", phase = RedactionPhase.Streaming), nowMs = 0L)
        assertEquals(RedactionSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyRedaction(
                AiRedactionPlanState(
                    exportType = "drives",
                    phase = RedactionPhase.Streaming,
                    streamingText = "partial",
                ),
                nowMs = 0L,
            )
        assertEquals(RedactionSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyRedaction(
                AiRedactionPlanState(
                    exportType = "drives",
                    phase = RedactionPhase.Done,
                    committedText = "planned",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(RedactionSurface.Ready("planned", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyRedaction(
                AiRedactionPlanState(
                    exportType = "drives",
                    phase = RedactionPhase.Done,
                    committedText = "planned",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(RedactionSurface.Ready("planned", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyRedaction(
                AiRedactionPlanState(exportType = "drives", phase = RedactionPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(RedactionSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyRedaction(
                AiRedactionPlanState(
                    exportType = "drives",
                    phase = RedactionPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(RedactionSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyRedaction(
                AiRedactionPlanState(
                    exportType = "drives",
                    phase = RedactionPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(RedactionSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyRedaction(
                AiRedactionPlanState(exportType = "drives", phase = RedactionPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(RedactionSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyRedaction(
                AiRedactionPlanState(exportType = "drives", phase = RedactionPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(RedactionSurface.Failed(offline = false), surface)
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
        val label = headerAccessibilityLabel("Plan PII redactions before sharing", "Helix", "Ask Helix to recommend.")
        assertEquals("Plan PII redactions before sharing (Helix). Ask Helix to recommend.", label)
    }

    @Test
    fun exportTypeLabelMergesPurposeAndHint() {
        val label = exportTypeAccessibilityLabel("Export type", "Select an export type…")
        assertEquals("Export type. Select an export type…", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            RedactionOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Failed to load data",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(RedactionSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(RedactionSurface.Live("p"), labels))
        assertEquals("body", outputAccessibilityLabel(RedactionSurface.Ready("body", stale = false), labels))
        assertEquals("Stale. body", outputAccessibilityLabel(RedactionSurface.Ready("body", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(RedactionSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            outputAccessibilityLabel(RedactionSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Failed to load data. cached",
            outputAccessibilityLabel(RedactionSurface.Cached("cached", offline = false), labels),
        )
        assertEquals("Failed to load data", outputAccessibilityLabel(RedactionSurface.Failed(offline = true), labels))
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = RedactionOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(RedactionSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(RedactionSurface.Hidden, labels))
    }
}
