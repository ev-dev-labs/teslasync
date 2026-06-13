// Off-device unit coverage for the SearchInput surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Pins the recent-search history algebra to the web `@/lib/searchHistory` reference
// (trim + minimum-length filtering, case-insensitive de-duplication with newest-casing-wins, newest-first
// ordering, per-scope capacity cap), the UiState → phase projection across every render branch
// (loading / content / empty / error) plus the stale/offline freshness fold, the query-error classification,
// the remove a11y-label formatting, and the PII-safe `view.opened` diagnostic. No Compose / Android framework /
// HTTP — runs in :android:testReleaseUnitTest. Reference values are exactly what the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.searchinput

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchInputModelTest {
    // ── registration metadata mirrors the prompt-mandated slug + the web history limits ─────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("SearchInput", SearchInputRegistration.SLUG)
    }

    @Test
    fun historyLimitsMirrorWebReference() {
        assertEquals(2, SearchInputRegistration.MIN_QUERY_LEN)
        assertEquals(12, SearchInputRegistration.CAP)
        assertEquals(8, SearchInputRegistration.DEFAULT_MAX_HISTORY)
    }

    // ── recordHistory (web recordSearch) ────────────────────────────────────────────────────────

    @Test
    fun recordTrimsAndAddsNewestFirst() {
        val recorded = recordHistory(emptyList(), "  trip  ", nowMs = 10L)
        assertEquals(listOf("trip"), recorded.map { it.query })
        assertEquals(10L, recorded.first().timestampMs)
    }

    @Test
    fun recordIgnoresBelowMinimumNoise() {
        val seed = recordHistory(emptyList(), "drives", nowMs = 1L)
        assertEquals(seed, recordHistory(seed, "x", nowMs = 2L))
        assertEquals(seed, recordHistory(seed, "   ", nowMs = 2L))
    }

    @Test
    fun recordDeduplicatesCaseInsensitivelyNewestCasingWins() {
        val a = recordHistory(emptyList(), "drives", nowMs = 1L)
        val b = recordHistory(a, "charging", nowMs = 2L)
        val c = recordHistory(b, "DRIVES", nowMs = 3L)
        assertEquals(listOf("DRIVES", "charging"), c.map { it.query })
        assertEquals(3L, c.first().timestampMs)
    }

    @Test
    fun recordEvictsOldestBeyondCap() {
        var list = emptyList<SearchHistoryEntry>()
        for (i in 1..20) {
            list = recordHistory(list, "q$i", nowMs = i.toLong())
        }
        assertEquals(SearchInputRegistration.CAP, list.size)
        assertEquals("q20", list.first().query)
        assertEquals("q9", list.last().query)
    }

    // ── removeHistory (web removeSearch) ────────────────────────────────────────────────────────

    @Test
    fun removeDeletesCaseInsensitiveMatch() {
        val base = recordHistory(recordHistory(emptyList(), "alpha", 1L), "beta", 2L)
        assertEquals(listOf("beta", "alpha"), base.map { it.query })
        assertEquals(listOf("beta"), removeHistory(base, "ALPHA").map { it.query })
    }

    @Test
    fun removeIsNoOpForBlankOrAbsentQuery() {
        val base = recordHistory(emptyList(), "alpha", 1L)
        assertEquals(base, removeHistory(base, "   "))
        assertEquals(base, removeHistory(base, "gamma"))
    }

    // ── recentQueries (web getRecentSearches) ───────────────────────────────────────────────────

    @Test
    fun recentQueriesAreNewestFirstAndClamped() {
        val entries =
            listOf(
                SearchHistoryEntry("a", 3L),
                SearchHistoryEntry("b", 2L),
                SearchHistoryEntry("c", 1L),
            )
        assertEquals(listOf("a", "b"), recentQueries(entries, max = 2))
        assertEquals(listOf("a", "b", "c"), recentQueries(entries, max = 99))
        assertEquals(emptyList<String>(), recentQueries(entries, max = 0))
    }

    @Test
    fun shouldRecordQueryEnforcesMinimumLength() {
        assertTrue(shouldRecordQuery("ab"))
        assertTrue(shouldRecordQuery("  ab  "))
        assertFalse(shouldRecordQuery("a"))
        assertFalse(shouldRecordQuery("   "))
    }

    // ── projection: every render branch / state ─────────────────────────────────────────────────

    @Test
    fun projectLoadingWhenFeedHasNoCache() {
        assertEquals(SearchHistoryPhase.Loading, SearchInputProjection.project(UiState.loading()).phase)
    }

    @Test
    fun projectContentWithEntries() {
        val display = SearchInputProjection.project(UiState(UiPhase.Content, data = listOf("a", "b")))
        assertEquals(SearchHistoryPhase.Content, display.phase)
        assertEquals(listOf("a", "b"), display.entries)
        assertFalse(display.showFreshnessChip)
    }

    @Test
    fun projectEmptyWhenResolvedWithNoRows() {
        val display = SearchInputProjection.project(UiState(UiPhase.Empty, data = emptyList()))
        assertEquals(SearchHistoryPhase.Empty, display.phase)
        assertTrue(display.entries.isEmpty())
    }

    @Test
    fun projectErrorIsRetryable() {
        val display =
            SearchInputProjection.project(
                UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = SERVER_ERROR),
            )
        assertEquals(SearchHistoryPhase.Error, display.phase)
        assertTrue(display.canRetry)
    }

    @Test
    fun projectStaleFlagsCachedListWithoutError() {
        val display =
            SearchInputProjection.project(UiState(UiPhase.Content, data = listOf("a"), stale = true))
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun projectOfflineFlagsCachedListAfterFailedRefresh() {
        val display =
            SearchInputProjection.project(
                UiState(UiPhase.Content, data = listOf("a"), stale = true, errorKind = ErrorKind.Network),
            )
        assertTrue(display.offline)
        assertFalse(display.stale)
        assertTrue(display.showFreshnessChip)
    }

    // ── query-error classification (web QueryError buckets) ─────────────────────────────────────

    @Test
    fun queryErrorKindMapsEveryFailure() {
        assertEquals(QueryErrorKind.Waiting, errorKindOf(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, errorKindOf(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Network, errorKindOf(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Unauthorized, errorKindOf(ErrorKind.Http, UNAUTHORIZED))
        assertEquals(QueryErrorKind.NotFound, errorKindOf(ErrorKind.Http, NOT_FOUND))
        assertEquals(QueryErrorKind.ServerError, errorKindOf(ErrorKind.Http, SERVER_ERROR))
        assertEquals(QueryErrorKind.ServerError, errorKindOf(ErrorKind.Decode, null))
    }

    private fun errorKindOf(
        kind: ErrorKind,
        status: Int?,
    ): QueryErrorKind =
        SearchInputProjection.queryErrorKind(
            SearchHistoryDisplay(phase = SearchHistoryPhase.Error, entries = emptyList(), errorKind = kind, httpStatus = status),
        )

    // ── remove a11y label formatting (web search.history.removeAria) ────────────────────────────

    @Test
    fun removeLabelInterpolatesTheQuery() {
        assertEquals(
            "Remove \"drives\" from search history",
            formatRemoveLabel("Remove \"%1\$s\" from search history", "drives"),
        )
    }

    @Test
    fun removeLabelDegradesWhenTemplateHasNoToken() {
        assertEquals("Remove drives", formatRemoveLabel("Remove", "drives"))
    }

    @Test
    fun stringsRemoveLabelUsesTheTemplate() {
        val strings = previewStrings()
        assertEquals("Remove \"trip\" from search history", strings.removeLabel("trip"))
    }

    // ── diagnostics: one PII-safe view.opened ───────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordSearchInputOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no query text or scope can leak through the diagnostic.
        assertEquals(mapOf("surface" to "SearchInput"), records[0].fields)
    }

    private fun previewStrings(): SearchInputStrings =
        SearchInputStrings(
            searchHint = "Search",
            clearLabel = "Clear",
            historyTitle = "Recent searches",
            clearHistoryLabel = "Clear history",
            removeAriaTemplate = "Remove \"%1\$s\" from search history",
            emptyMessage = "No data available",
            loadingLabel = "Loading",
            staleLabel = "Stale",
            offlineLabel = "Offline",
        )

    private companion object {
        private const val UNAUTHORIZED = 401
        private const val NOT_FOUND = 404
        private const val SERVER_ERROR = 503
    }
}
