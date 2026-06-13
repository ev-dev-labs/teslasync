package io.teslasync.android.sharedsurfaces.savedviewmenu

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.savedviews.SavedView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage of [SavedViewMenuProjection] — the pure data adapter the composable renders.
 * Exercises the web `useMemo` derivations (pinned-first ordering, the `query`-matched active view, the default
 * view, the first-mount auto-apply decision), the cache-then-network → projection envelope (loading /
 * content-from-cache / empty / stale / offline / hard error), and the classified error-kind mapping. Runs in
 * the `:android:testReleaseUnitTest` gate.
 */
class SavedViewMenuProjectionTest {
    // ── Ordering + selection (web useMemo derivations) ───────────────────────────────────────────────

    @Test
    fun sortViewsOrdersPinnedFirstThenCaseInsensitiveName() {
        val ordered =
            SavedViewMenuProjection.sortViews(
                listOf(
                    view(1, "Bravo", isPinned = true),
                    view(2, "alpha"),
                    view(3, "apex", isPinned = true),
                    view(4, "Charlie"),
                ),
            )
        assertEquals(listOf("apex", "Bravo", "alpha", "Charlie"), ordered.map { it.name })
    }

    @Test
    fun activeViewMatchesTheCurrentQuery() {
        val views = listOf(view(1, "A", query = "status=active"), view(2, "B", query = "range=7d"))
        assertEquals(2L, SavedViewMenuProjection.activeView(views, "range=7d")?.id)
        assertNull(SavedViewMenuProjection.activeView(views, "unmatched"))
    }

    @Test
    fun defaultViewFindsTheFlaggedRow() {
        val views = listOf(view(1, "A"), view(2, "B", isDefault = true))
        assertEquals(2L, SavedViewMenuProjection.defaultView(views)?.id)
        assertNull(SavedViewMenuProjection.defaultView(listOf(view(1, "A"))))
    }

    @Test
    fun autoApplyFiresOnlyWithNoQueryAndADefault() {
        val default = view(1, "Default", isDefault = true)
        assertTrue(SavedViewMenuProjection.shouldAutoApplyDefault("", default))
        assertFalse(SavedViewMenuProjection.shouldAutoApplyDefault("status=active", default))
        assertFalse(SavedViewMenuProjection.shouldAutoApplyDefault("", null))
    }

    // ── project(): phase + freshness envelope ────────────────────────────────────────────────────────

    @Test
    fun contentProjectsSortedRowsAndActiveDefault() {
        val views = listOf(view(1, "Trips", query = "d=1"), view(2, "Week", query = "w=1", isDefault = true))
        val display = SavedViewMenuProjection.project(success(views), "w=1")
        assertEquals(UiPhase.Content, display.phase)
        assertTrue(display.hasViews)
        assertEquals(2L, display.activeView?.id)
        assertEquals(2L, display.defaultView?.id)
    }

    @Test
    fun emptyFeedProjectsEmptyPhase() {
        val display = SavedViewMenuProjection.project(success(emptyList()), "")
        assertEquals(UiPhase.Empty, display.phase)
        assertFalse(display.hasViews)
    }

    @Test
    fun firstLoadWithNoCacheIsLoading() {
        val state = Resource.Loading<List<SavedView>>(cached = null, fetchedAt = null, stale = false).toUiState { it.isEmpty() }
        val display = SavedViewMenuProjection.project(state, "")
        assertEquals(UiPhase.Loading, display.phase)
    }

    @Test
    fun hardErrorWithNoCacheIsErrorWithRetry() {
        val state =
            Resource
                .Error<List<SavedView>>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("down"))
                .toUiState { it.isEmpty() }
        val display = SavedViewMenuProjection.project(state, "")
        assertEquals(UiPhase.Error, display.phase)
        assertTrue(display.canRetry)
    }

    @Test
    fun cachedRowsAfterFailedRefreshAreOffline() {
        val cached = listOf(view(1, "Cached"))
        val state =
            Resource
                .Error(cached = cached, fetchedAt = 5L, stale = true, error = RuntimeException("net"))
                .toUiState { it.isEmpty() }
        val display = SavedViewMenuProjection.project(state, "")
        assertEquals(UiPhase.Content, display.phase)
        assertTrue(display.offline)
        assertFalse(display.stale)
        assertTrue(display.showFreshnessChip)
        assertEquals(5L, display.freshnessStamp)
    }

    @Test
    fun cachedRowsPastTtlAreStaleAndRefreshing() {
        val cached = listOf(view(1, "Cached"))
        val state = Resource.Loading(cached = cached, fetchedAt = 9L, stale = true).toUiState { it.isEmpty() }
        val display = SavedViewMenuProjection.project(state, "")
        assertEquals(UiPhase.Content, display.phase)
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.refreshing)
        assertTrue(display.showFreshnessChip)
    }

    // ── Classified error-kind mapping ────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsTheTaxonomy() {
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 403))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, 503))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown, null))
    }

    private fun kindFor(
        errorKind: ErrorKind,
        httpStatus: Int?,
    ): QueryErrorKind =
        SavedViewMenuProjection.queryErrorKind(
            SavedViewMenuDisplay(phase = UiPhase.Error, errorKind = errorKind, httpStatus = httpStatus),
        )

    private companion object {
        fun view(
            id: Long,
            name: String,
            query: String = "status=active",
            isDefault: Boolean = false,
            isPinned: Boolean = false,
        ): SavedView =
            SavedView(
                id = id,
                name = name,
                route = "/drives",
                query = query,
                isDefault = isDefault,
                isPinned = isPinned,
                createdAt = "2024-01-01T00:00:00Z",
                updatedAt = "2024-01-01T00:00:00Z",
            )

        fun success(views: List<SavedView>) = Resource.Success(views, fetchedAt = 1L, stale = false).toUiState { it.isEmpty() }
    }
}
