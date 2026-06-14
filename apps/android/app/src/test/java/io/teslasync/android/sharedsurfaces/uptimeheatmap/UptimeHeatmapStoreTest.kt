package io.teslasync.android.sharedsurfaces.uptimeheatmap

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the [UptimeHeatmapStore] + [InMemoryUptimeHeatmapSource] — the native holder a host feeds the
 * rolling window into (the web `days` prop). Covers the pre-feed loading state, a fed window resolving to
 * success, the failure paths (a hard error with no cache, and the offline/last-known surface when a prior
 * window exists), and the refresh transitions (stale-over-cache, first-load when empty). Synchronous: no
 * Android, no coroutines.
 */
class UptimeHeatmapStoreTest {
    @Test
    fun feedStartsLoadingBeforeAnyWindowIsFed() {
        val store = UptimeHeatmapStore(clock = { STAMP })
        val value = store.window().value
        assertTrue(value is Resource.Loading)
        assertNull(value.cached)
    }

    @Test
    fun submitResolvesToSuccess() {
        val store = UptimeHeatmapStore(clock = { STAMP })
        store.submit(window(3))

        val value = store.window().value
        assertTrue(value is Resource.Success)
        assertEquals(3, (value as Resource.Success).data.days.size)
        assertFalse(value.stale)
        assertEquals(STAMP, value.fetchedAt)
    }

    @Test
    fun failWithNoCacheIsHardError() {
        val store = UptimeHeatmapStore(clock = { STAMP })
        store.fail(IllegalStateException("boom"))

        val value = store.window().value
        assertTrue(value is Resource.Error)
        assertNull(value.cached)
    }

    @Test
    fun failAfterSuccessKeepsCachedWindowAndFlagsOffline() {
        val store = UptimeHeatmapStore(clock = { STAMP })
        store.submit(window(5))

        store.fail(IllegalStateException("network"))

        val value = store.window().value
        assertTrue(value is Resource.Error)
        assertEquals(5, value.cached?.days?.size)
        assertTrue(value.stale)
    }

    @Test
    fun beginRefreshOverCacheFlagsStaleLoading() {
        val store = UptimeHeatmapStore(clock = { STAMP })
        store.submit(window(7))

        store.beginRefresh()

        val value = store.window().value
        assertTrue(value is Resource.Loading)
        assertEquals(7, value.cached?.days?.size)
        assertTrue(value.stale)
    }

    @Test
    fun beginRefreshWithNoCacheStaysFirstLoad() {
        val store = UptimeHeatmapStore(clock = { STAMP })
        store.beginRefresh()

        val value = store.window().value
        assertTrue(value is Resource.Loading)
        assertNull(value.cached)
        assertFalse(value.stale)
    }

    @Test
    fun inMemorySourceSeedsAndReseedsTheWindow() =
        runTest {
            val source = InMemoryUptimeHeatmapSource(initial = window(2), clock = { STAMP })
            val first = source.window().first()
            assertTrue(first is Resource.Success)
            assertEquals(2, (first as Resource.Success).data.days.size)

            source.seed(window(9))
            val second = source.window().first()
            assertEquals(9, (second as Resource.Success).data.days.size)
        }

    private fun window(days: Int): UptimeWindow =
        UptimeWindow(days = (0 until days).map { UptimeDay(date = "2026-05-%02d".format(it + 1), status = UptimeStatus.Healthy) })

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
