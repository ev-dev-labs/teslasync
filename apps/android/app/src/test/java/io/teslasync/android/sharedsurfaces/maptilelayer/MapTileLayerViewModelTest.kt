package io.teslasync.android.sharedsurfaces.maptilelayer

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [MapTileLayerViewModel] over a controllable fake [MapTileLayerSource], covering the full lifecycle the
 * web component + the bound map-config feed render: a first load → loading, a resolved config → content, a hard
 * error → error, a cached value after a failed refresh → the offline (stale + cached) surface, retry
 * re-collecting the source, and the PII-safe `view.opened` + `mapTileLayer.refresh` diagnostics — end to end
 * through the real `toUiState` projection. The VM's `state` is a `WhileSubscribed` feed, so each case keeps an
 * active collector alive on the background scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MapTileLayerViewModelTest {
    private class FakeSource(
        initial: Resource<MapConfig>,
    ) : MapTileLayerSource {
        val flow = MutableStateFlow(initial)
        var calls: Int = 0

        override fun mapConfig(): Flow<Resource<MapConfig>> {
            calls++
            return flow
        }
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
    fun loadingResolvesToContentWhenTheConfigArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)

            source.flow.value =
                Resource.Success(MapConfig(provider = PROVIDER_AZURE, apiKey = "k"), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(PROVIDER_AZURE, state.data?.provider)
        }

    @Test
    fun communityConfigStillResolvesToContentNotEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(MapConfig.FREE, fetchedAt = STAMP, stale = false)))
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
        }

    @Test
    fun errorWithCacheKeepsConfigAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = MapConfig(provider = PROVIDER_GOOGLE, apiKey = "k")
            val source = FakeSource(Resource.Error(cached = cached, fetchedAt = STAMP, stale = true, error = RuntimeException("net")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals(PROVIDER_GOOGLE, state.data?.provider)
        }

    @Test
    fun retryReCollectsTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(MapConfig.FREE, fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(1, source.calls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(2, source.calls)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(MapConfig.FREE, fetchedAt = STAMP, stale = false)), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "mapTileLayer.refresh" }
            assertEquals(mapOf("surface" to "MapTileLayer"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(MapConfig.FREE, fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "MapTileLayer"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: MapTileLayerSource,
        logger: Logger = NoopLogger,
    ): MapTileLayerViewModel = MapTileLayerViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: MapTileLayerViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
