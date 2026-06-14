package io.teslasync.android.sharedsurfaces.routeplayback

import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.RouteSample
import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [RoutePlaybackViewModel] over a controllable fake [RoutePlaybackSource], covering the full
 * cache-then-network lifecycle the web widget renders: loading / content / empty / offline / error, the
 * refresh-in-flight flag, the retry recovery path, and the PII-safe `view.opened` diagnostic — end to end
 * through the real `Resource → UiState` projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RoutePlaybackViewModelTest {
    private class FakeSource(
        val flow: MutableStateFlow<Resource<RoutePlaybackTrack>>,
    ) : RoutePlaybackSource {
        override fun track(): Flow<Resource<RoutePlaybackTrack>> = flow
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun loadingWithoutCacheRendersLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(loading())))
            advanceUntilIdle()
            assertTrue(vm.state.value.isLoading)
        }

    @Test
    fun successExposesTheBuiltTrack() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(track(4)))))
            advanceUntilIdle()
            assertTrue(vm.state.value.isContent)
            assertEquals(4, vm.state.value.samples.size)
        }

    @Test
    fun successWithNoSamplesRendersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(RoutePlaybackTrack.EMPTY))))
            advanceUntilIdle()
            assertTrue(vm.state.value.isEmpty)
        }

    @Test
    fun refreshOverCacheIsFlaggedNotOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val refreshing = Resource.Loading(cached = track(3), fetchedAt = 1L, stale = false)
            val vm = viewModel(FakeSource(MutableStateFlow(refreshing)))
            advanceUntilIdle()
            assertTrue(vm.state.value.isContent)
            assertTrue(vm.state.value.refreshing)
            assertFalse(vm.state.value.isOffline)
        }

    @Test
    fun errorWithNoCacheRendersError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(error(cache = null))))
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)
            assertTrue(vm.state.value.canRetry)
        }

    @Test
    fun errorWithCacheStaysOfflineOverTheCachedTrack() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(error(cache = track(3)))))
            advanceUntilIdle()
            assertTrue(vm.state.value.isContent)
            assertTrue(vm.state.value.isOffline)
            assertTrue(vm.state.value.canRetry)
            assertEquals(3, vm.state.value.samples.size)
        }

    @Test
    fun retryReCollectsAndRecovers() =
        runTest(UnconfinedTestDispatcher()) {
            val source = MutableStateFlow<Resource<RoutePlaybackTrack>>(error(cache = null))
            val vm = viewModel(FakeSource(source))
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)

            source.value = success(track(2))
            vm.retry()
            advanceUntilIdle()
            assertTrue(vm.state.value.isContent)
            assertEquals(2, vm.state.value.samples.size)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(MutableStateFlow(loading())), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "RoutePlayback"), opened.single().second)
        }

    // ── Fixtures ─────────────────────────────────────────────────────────────────

    private fun loading(): Resource<RoutePlaybackTrack> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun success(track: RoutePlaybackTrack): Resource<RoutePlaybackTrack> =
        Resource.Success(data = track, fetchedAt = 1L, stale = false)

    private fun error(cache: RoutePlaybackTrack?): Resource<RoutePlaybackTrack> =
        Resource.Error(cached = cache, fetchedAt = cache?.let { 1L }, stale = true, error = RuntimeException("boom"))

    private fun track(samples: Int): RoutePlaybackTrack =
        RoutePlaybackTrack(
            (0 until samples).map { i -> RouteSample(GeoPoint(37.7749 + i * 0.001, -122.4194 + i * 0.001), i * 1_000L) },
        )

    private fun TestScope.viewModel(
        source: RoutePlaybackSource,
        logger: Logger = NoopLogger,
    ): RoutePlaybackViewModel = RoutePlaybackViewModel(source, logger, scope = backgroundScope)
}
