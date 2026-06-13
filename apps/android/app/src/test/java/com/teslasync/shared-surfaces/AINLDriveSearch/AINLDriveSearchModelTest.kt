// Off-device unit tests for the pure AINLDriveSearch model: the i18n key folding + fallback parity (backs every
// accessible label), the SSE frame parser (the consume side of web `useAiStream`), the stream reducer, the
// surface classifier (every loading / empty / content / error / stale / offline branch the web component
// resolves), the freshness rule, and the accessibility-label builders (TalkBack-label presence). Run by the
// offline :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated com/teslasync/shared-surfaces directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainldrivesearch

import io.teslasync.android.data.ErrorKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AINLDriveSearchModelTest {
    private val window = DRIVE_SEARCH_FRESHNESS_WINDOW_MS

    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals("translation_drives_aiSearch_title", foldCatalogKey(DriveSearchKeys.TITLE))
        assertEquals("translation_drives_aiSearch_searchButton", foldCatalogKey(DriveSearchKeys.SEARCH_BUTTON))
        assertEquals("translation_helix_askHelix", foldCatalogKey(DriveSearchKeys.ASK_HELIX))
        assertEquals("translation_common_retry", foldCatalogKey(DriveSearchKeys.RETRY))
    }

    @Test
    fun labels_resolveToWebEnglishViaFallback() {
        val labels = driveSearchLabels(FallbackResolver)
        assertEquals("Find a drive in natural language", labels.title)
        assertEquals(
            "Describe a drive (for example \"last Friday's trip to the coast\") and jump straight to its replay " +
                "— the assistant only narrates your own drives.",
            labels.description,
        )
        assertEquals("Helix", labels.badge)
        assertEquals("Search with Helix", labels.searchButton)
        assertEquals(
            "Describe a drive — for example \"last Friday's coast trip\" or " +
                "\"the one with the lowest efficiency last week\"",
            labels.promptHint,
        )
        assertEquals("Ask Helix", labels.askHelix)
        assertEquals("Helix is thinking…", labels.thinking)
    }

    @Test
    fun labels_consultCatalogForSourceKeys() {
        val catalog =
            mapOf(
                DriveSearchKeys.TITLE to "Catálogo title",
                DriveSearchKeys.SEARCH_BUTTON to "Catálogo search",
            )
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val labels = driveSearchLabels(resolve)
        assertEquals("Catálogo title", labels.title)
        assertEquals("Catálogo search", labels.searchButton)
        // A key absent from the catalog still falls back to the web English.
        assertEquals(
            "Describe a drive — for example \"last Friday's coast trip\" or " +
                "\"the one with the lowest efficiency last week\"",
            labels.promptHint,
        )
    }

    @Test
    fun searchButtonContentDescription_matchesWebAriaLabel() {
        assertEquals("Ask Helix · Search with Helix", searchButtonContentDescription(FallbackResolver))
    }

    @Test
    fun allLabels_areNonBlank() {
        val labels = driveSearchLabels(FallbackResolver)
        listOf(
            labels.title,
            labels.description,
            labels.badge,
            labels.badgeAria,
            labels.searchButton,
            labels.promptHint,
            labels.noMatch,
            labels.errorTitle,
            labels.askHelix,
            labels.thinking,
            labels.retry,
            labels.offline,
            labels.stale,
        ).forEach { assertTrue("label must be non-blank", it.isNotBlank()) }
    }

    // ── SSE frame parsing (the consume side of web useAiStream) ───────────────────────────────────────────

    @Test
    fun parseAiSearchFrame_delta() {
        assertEquals(AiSearchChunk.Delta("hi"), parseAiSearchFrame("event: delta\ndata: {\"text\":\"hi\"}"))
    }

    @Test
    fun parseAiSearchFrame_done() {
        assertEquals(AiSearchChunk.Done, parseAiSearchFrame("event: done\ndata: {\"finish_reason\":\"stop\"}"))
    }

    @Test
    fun parseAiSearchFrame_errorClassifiesNetworkVsHttp() {
        val network = parseAiSearchFrame("event: error\ndata: {\"message\":\"stream_http_0 network is unreachable\"}")
        assertEquals(AiSearchChunk.Failed(ErrorKind.Network), network)
        val http = parseAiSearchFrame("event: error\ndata: {\"message\":\"stream_http_503\"}")
        assertEquals(AiSearchChunk.Failed(ErrorKind.Http), http)
    }

    @Test
    fun parseAiSearchFrame_ignoresCommentLinesAndCrlf() {
        val raw = ": keep-alive comment\r\nevent: delta\r\ndata: {\"text\":\"x\"}"
        assertEquals(AiSearchChunk.Delta("x"), parseAiSearchFrame(raw))
    }

    @Test
    fun parseAiSearchFrame_unknownEventIsSkipped() {
        // tool_result / confirm_request frames are no-ops for this surface (web `onEvent` is a no-op).
        assertNull(parseAiSearchFrame("event: tool_result\ndata: {\"id\":\"1\",\"name\":\"x\",\"ok\":true}"))
        assertNull(parseAiSearchFrame("event: mystery\ndata: {}"))
    }

    @Test
    fun parseAiSearchFrame_malformedOrMissingEventIsNull() {
        assertNull(parseAiSearchFrame("event: delta\ndata: {bad json"))
        assertNull(parseAiSearchFrame("data: {\"text\":\"x\"}"))
    }

    @Test
    fun classifyStreamError_foldsMarkers() {
        assertEquals(ErrorKind.Network, classifyStreamError("rate_limited", "connection reset"))
        assertEquals(ErrorKind.Timeout, classifyStreamError(null, "request timed out"))
        assertEquals(ErrorKind.Http, classifyStreamError(null, "stream_http_500"))
        assertEquals(ErrorKind.Http, classifyStreamError(null, null))
    }

    @Test
    fun isOfflineKind_treatsConnectivityClassAsOffline() {
        assertTrue(isOfflineKind(ErrorKind.Network))
        assertTrue(isOfflineKind(ErrorKind.Timeout))
        assertTrue(isOfflineKind(ErrorKind.CircuitOpen))
        assertFalse(isOfflineKind(ErrorKind.Http))
        assertFalse(isOfflineKind(null))
    }

    // ── reducer ───────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun withPrompt_tracksTextAndGatesCanStart() {
        assertFalse(DriveSearchState().canStart)
        assertFalse(DriveSearchState().withPrompt("   ").canStart)
        val next = DriveSearchState().withPrompt("last Friday's coast trip")
        assertEquals("last Friday's coast trip", next.prompt)
        assertTrue(next.canStart)
    }

    @Test
    fun startSearching_entersStreamingAndClearsTransients() {
        val next =
            DriveSearchState(prompt = "p", streamingText = "old", errorKind = ErrorKind.Http, committedText = "kept")
                .startSearching()
        assertEquals(DriveSearchPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertEquals("kept", next.committedText)
        assertEquals("p", next.prompt)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            DriveSearchState(phase = DriveSearchPhase.Streaming)
                .onChunk(AiSearchChunk.Delta("Found "), nowMs = 1L)
                .onChunk(AiSearchChunk.Delta("it"), nowMs = 2L)
        assertEquals("Found it", next.streamingText)
        assertEquals(DriveSearchPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            DriveSearchState(phase = DriveSearchPhase.Streaming, streamingText = "result")
                .onChunk(AiSearchChunk.Done, nowMs = 42L)
        assertEquals(DriveSearchPhase.Done, next.phase)
        assertEquals("result", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            DriveSearchState(phase = DriveSearchPhase.Streaming, streamingText = "   ")
                .onChunk(AiSearchChunk.Done, nowMs = 7L)
        assertEquals(DriveSearchPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommitted() {
        val next =
            DriveSearchState(phase = DriveSearchPhase.Streaming, committedText = "prev")
                .onChunk(AiSearchChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(DriveSearchPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = DriveSearchState(phase = DriveSearchPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(DriveSearchPhase.Done, promoted.phase)
        val untouched = DriveSearchState(phase = DriveSearchPhase.Failed).finishIfStreaming(9L)
        assertEquals(DriveSearchPhase.Failed, untouched.phase)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────────────────────────────

    @Test
    fun gateOffHidesSurface() {
        val surface = classifyDriveSearch(DriveSearchState(gateEnabled = false, prompt = "p"), nowMs = 0L)
        assertEquals(DriveSearchSurface.Hidden, surface)
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(
            DriveSearchSurface.Resting(canStart = true),
            classifyDriveSearch(DriveSearchState(prompt = "p"), nowMs = 0L),
        )
        assertEquals(
            DriveSearchSurface.Resting(canStart = false),
            classifyDriveSearch(DriveSearchState(prompt = ""), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        val surface =
            classifyDriveSearch(DriveSearchState(prompt = "p", phase = DriveSearchPhase.Streaming), nowMs = 0L)
        assertEquals(DriveSearchSurface.Working, surface)
    }

    @Test
    fun streamingWithTextIsLive() {
        val surface =
            classifyDriveSearch(
                DriveSearchState(prompt = "p", phase = DriveSearchPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            )
        assertEquals(DriveSearchSurface.Live("partial"), surface)
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        val surface =
            classifyDriveSearch(
                DriveSearchState(
                    prompt = "p",
                    phase = DriveSearchPhase.Done,
                    committedText = "narrated",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window - 1L,
            )
        assertEquals(DriveSearchSurface.Ready("narrated", stale = false), surface)
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        val surface =
            classifyDriveSearch(
                DriveSearchState(
                    prompt = "p",
                    phase = DriveSearchPhase.Done,
                    committedText = "narrated",
                    fetchedAt = 1_000L,
                ),
                nowMs = 1_000L + window + 1L,
            )
        assertEquals(DriveSearchSurface.Ready("narrated", stale = true), surface)
    }

    @Test
    fun doneBlankIsEmpty() {
        val surface =
            classifyDriveSearch(
                DriveSearchState(prompt = "p", phase = DriveSearchPhase.Done, committedText = ""),
                nowMs = 0L,
            )
        assertEquals(DriveSearchSurface.Empty, surface)
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        val surface =
            classifyDriveSearch(
                DriveSearchState(
                    prompt = "p",
                    phase = DriveSearchPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            )
        assertEquals(DriveSearchSurface.Cached("last known", offline = true), surface)
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        val surface =
            classifyDriveSearch(
                DriveSearchState(
                    prompt = "p",
                    phase = DriveSearchPhase.Failed,
                    committedText = "last known",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            )
        assertEquals(DriveSearchSurface.Cached("last known", offline = false), surface)
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        val surface =
            classifyDriveSearch(
                DriveSearchState(prompt = "p", phase = DriveSearchPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            )
        assertEquals(DriveSearchSurface.Failed(offline = true), surface)
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        val surface =
            classifyDriveSearch(
                DriveSearchState(prompt = "p", phase = DriveSearchPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            )
        assertEquals(DriveSearchSurface.Failed(offline = false), surface)
    }

    // ── freshness ───────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun isStaleHonorsWindowAndNullStamp() {
        assertFalse(isStale(fetchedAt = null, nowMs = 10_000L, windowMs = window))
        assertFalse(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window, windowMs = window))
        assertTrue(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window + 1L, windowMs = window))
    }

    // ── accessibility labels ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        val label = headerAccessibilityLabel("Find a drive in natural language", "Helix", "Describe a drive.")
        assertEquals("Find a drive in natural language (Helix). Describe a drive.", label)
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            DriveSearchOutputLabels(
                working = "Helix is thinking",
                empty = "No matching drive",
                stale = "Stale",
                offline = "Offline",
                error = "Couldn't search your drives",
            )
        assertEquals("Helix is thinking", searchOutputAccessibilityLabel(DriveSearchSurface.Working, labels))
        assertEquals("Helix is thinking", searchOutputAccessibilityLabel(DriveSearchSurface.Live("p"), labels))
        assertEquals("body", searchOutputAccessibilityLabel(DriveSearchSurface.Ready("body", stale = false), labels))
        assertEquals(
            "Stale. body",
            searchOutputAccessibilityLabel(DriveSearchSurface.Ready("body", stale = true), labels),
        )
        assertEquals("No matching drive", searchOutputAccessibilityLabel(DriveSearchSurface.Empty, labels))
        assertEquals(
            "Offline. cached",
            searchOutputAccessibilityLabel(DriveSearchSurface.Cached("cached", offline = true), labels),
        )
        assertEquals(
            "Couldn't search your drives. cached",
            searchOutputAccessibilityLabel(DriveSearchSurface.Cached("cached", offline = false), labels),
        )
        assertEquals(
            "Couldn't search your drives",
            searchOutputAccessibilityLabel(DriveSearchSurface.Failed(offline = true), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = DriveSearchOutputLabels("w", "e", "s", "o", "x")
        assertNull(searchOutputAccessibilityLabel(DriveSearchSurface.Resting(canStart = true), labels))
        assertNull(searchOutputAccessibilityLabel(DriveSearchSurface.Hidden, labels))
    }
}
