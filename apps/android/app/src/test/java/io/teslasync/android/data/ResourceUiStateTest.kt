package io.teslasync.android.data

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pure tests for the [Resource] -> [UiState] projection — the heart of the ADR-013 cache-then-network
 * contract on Android. Covers loading / cached / refreshing / empty / stale / error / retry without any
 * Android or coroutine machinery.
 */
class ResourceUiStateTest {
    @Test
    fun loadingWithNoCacheIsLoadingWithNoData() {
        val state = Resource.Loading<List<Int>>(cached = null, fetchedAt = null, stale = false).toUiState()

        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
        assertFalse(state.refreshing)
        assertFalse(state.canRetry)
        assertFalse(state.hasData)
    }

    @Test
    fun loadingWithCacheShowsContentWhileRefreshing() {
        val state =
            Resource.Loading(cached = listOf(1, 2), fetchedAt = 100L, stale = false).toUiState()

        assertEquals(UiPhase.Content, state.phase)
        assertEquals(listOf(1, 2), state.data)
        assertEquals(100L, state.fetchedAt)
        assertTrue("a refresh is in flight over cached data", state.refreshing)
    }

    @Test
    fun loadingWithStaleCacheKeepsStaleFlag() {
        val state =
            Resource.Loading(cached = listOf(1), fetchedAt = 1L, stale = true).toUiState()

        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertTrue(state.refreshing)
    }

    @Test
    fun loadingWithEmptyCacheIsEmptyPhase() {
        val state =
            Resource.Loading(cached = emptyList<Int>(), fetchedAt = 1L, stale = false).toUiState()

        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.refreshing)
    }

    @Test
    fun successWithDataIsContentAndFresh() {
        val state = Resource.Success(data = listOf(1, 2, 3), fetchedAt = 200L, stale = false).toUiState()

        assertEquals(UiPhase.Content, state.phase)
        assertEquals(listOf(1, 2, 3), state.data)
        assertEquals(200L, state.fetchedAt)
        assertFalse(state.stale)
        assertFalse(state.refreshing)
        assertFalse(state.canRetry)
    }

    @Test
    fun successWithEmptyPayloadIsEmptyPhase() {
        val state = Resource.Success(data = emptyList<Int>(), fetchedAt = 200L, stale = false).toUiState()

        assertEquals(UiPhase.Empty, state.phase)
        assertEquals(emptyList<Int>(), state.data)
    }

    @Test
    fun errorWithNoCacheIsHardErrorWithRetry() {
        val resource =
            Resource.Error<List<Int>>(
                cached = null,
                fetchedAt = null,
                stale = false,
                error = ApiError.Network(),
            )
        val state = resource.toUiState()

        assertEquals(UiPhase.Error, state.phase)
        assertNull(state.data)
        assertEquals(ErrorKind.Network, state.errorKind)
        assertTrue(state.canRetry)
        assertTrue(state.hasError)
    }

    @Test
    fun errorWithCacheStaysOnContentAsStaleOfflineWithRetry() {
        val resource =
            Resource.Error(
                cached = listOf(7, 8),
                fetchedAt = 50L,
                stale = true,
                error = ApiError.Timeout(),
            )
        val state = resource.toUiState()

        assertEquals(UiPhase.Content, state.phase)
        assertEquals(listOf(7, 8), state.data)
        assertTrue("last-known data shown offline must be flagged stale", state.stale)
        assertTrue(state.isOffline)
        assertTrue(state.canRetry)
        assertEquals(ErrorKind.Timeout, state.errorKind)
    }

    @Test
    fun errorKindFoldsTheSharedApiErrorTaxonomy() {
        assertEquals(ErrorKind.Network, errorKindOf(ApiError.Network()))
        assertEquals(ErrorKind.Timeout, errorKindOf(ApiError.Timeout()))
        assertEquals(ErrorKind.Http, errorKindOf(ApiError.Http(status = 503)))
        assertEquals(ErrorKind.Decode, errorKindOf(ApiError.Decode()))
        assertEquals(ErrorKind.CircuitOpen, errorKindOf(ApiError.CircuitOpen()))
        assertEquals(ErrorKind.Unknown, errorKindOf(RuntimeException("boom")))
    }

    @Test
    fun httpStatusIsSurfacedOnlyForHttpErrors() {
        assertEquals(503, httpStatusOf(ApiError.Http(status = 503)))
        assertNull(httpStatusOf(ApiError.Network()))

        val resource = Resource.Error<Int>(cached = null, fetchedAt = null, stale = false, error = ApiError.Http(status = 429))
        val state = resource.toUiState()
        assertEquals(429, state.httpStatus)
    }

    @Test
    fun blankStringPayloadIsTreatedAsEmpty() {
        assertEquals(UiPhase.Empty, Resource.Success(data = "   ", fetchedAt = 1L, stale = false).toUiState().phase)
        assertEquals(UiPhase.Content, Resource.Success(data = "hi", fetchedAt = 1L, stale = false).toUiState().phase)
    }
}
