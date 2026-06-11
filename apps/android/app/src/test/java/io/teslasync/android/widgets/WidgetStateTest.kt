package io.teslasync.android.widgets

import org.junit.Assert.assertEquals
import org.junit.Test

/** Tests the [deriveRenderState] precedence rules and [WidgetSyncStatus] token round-trip. */
class WidgetStateTest {
    // render(hasCachedValue, isContentEmpty, isStale, syncStatus)
    private fun render(
        hasCache: Boolean,
        empty: Boolean,
        stale: Boolean,
        sync: WidgetSyncStatus,
    ): WidgetRenderState = deriveRenderState(hasCache, empty, stale, sync)

    @Test
    fun contentWhenCachedFreshAndSynced() {
        assertEquals(WidgetRenderState.Content, render(true, false, false, WidgetSyncStatus.Ok))
    }

    @Test
    fun staleWhenCachedAndPastWindow() {
        assertEquals(WidgetRenderState.Stale, render(true, false, true, WidgetSyncStatus.Ok))
    }

    @Test
    fun offlineWhenCachedAndLastSyncFailed() {
        assertEquals(WidgetRenderState.Offline, render(true, false, false, WidgetSyncStatus.FailedWithCache))
    }

    @Test
    fun offlineTakesPrecedenceOverStale() {
        assertEquals(WidgetRenderState.Offline, render(true, false, true, WidgetSyncStatus.FailedWithCache))
    }

    @Test
    fun emptyWhenCachedButStructurallyEmpty() {
        assertEquals(WidgetRenderState.Empty, render(true, true, false, WidgetSyncStatus.Ok))
    }

    @Test
    fun errorWhenNoCacheAndFailed() {
        assertEquals(WidgetRenderState.Error, render(false, false, false, WidgetSyncStatus.FailedNoCache))
    }

    @Test
    fun emptyWhenNoCacheButSyncOk() {
        assertEquals(WidgetRenderState.Empty, render(false, false, false, WidgetSyncStatus.Ok))
    }

    @Test
    fun loadingWhenNoCacheAndNoSyncYet() {
        assertEquals(WidgetRenderState.Loading, render(false, false, false, WidgetSyncStatus.Unknown))
    }

    @Test
    fun syncStatusTokenRoundTrips() {
        for (status in WidgetSyncStatus.entries) {
            assertEquals(status, WidgetSyncStatus.fromToken(status.token))
        }
    }

    @Test
    fun syncStatusUnknownForGarbledToken() {
        assertEquals(WidgetSyncStatus.Unknown, WidgetSyncStatus.fromToken(null))
        assertEquals(WidgetSyncStatus.Unknown, WidgetSyncStatus.fromToken("not-a-status"))
    }
}
