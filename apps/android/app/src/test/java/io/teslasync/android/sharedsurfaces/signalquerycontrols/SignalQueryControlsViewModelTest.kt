package io.teslasync.android.sharedsurfaces.signalquerycontrols

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
 * Drives [SignalQueryControlsViewModel] over a controllable fake [SignalQueryControlsSource], covering the full
 * lifecycle the web `useSignals` read + the bound available-signals feed render: a first load → loading, a
 * resolved list → content, an empty list → empty, a hard error → error, a cached list after a failed refresh →
 * the offline (stale + cached) surface, retry re-collecting the source, and the PII-safe `view.opened` +
 * `signalQueryControls.refresh` diagnostics — end to end through the real `toUiState` projection. The VM's
 * `availableSignals` is a `WhileSubscribed` feed, so each case keeps an active collector alive.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalQueryControlsViewModelTest {
    private class FakeSource(
        initial: Resource<List<String>>,
    ) : SignalQueryControlsSource {
        val flow = MutableStateFlow(initial)
        var calls: Int = 0
        var lastVehicleId: Long = -1

        override fun availableSignals(vehicleId: Long): Flow<Resource<List<String>>> {
            calls++
            lastVehicleId = vehicleId
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
    fun loadingResolvesToContentWhenSignalsArrive() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.availableSignals.value.phase)

            source.flow.value = Resource.Success(listOf("VehicleSpeed"), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            val state = vm.availableSignals.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, state.data?.size)
            assertEquals(VEHICLE_ID, source.lastVehicleId)
        }

    @Test
    fun emptyFeedMapsToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(emptyList(), fetchedAt = STAMP, stale = false)))
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.availableSignals.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.availableSignals.value.phase)
            assertNotNull(vm.availableSignals.value.errorKind)
        }

    @Test
    fun errorWithCacheKeepsSignalsAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = listOf("VehicleSpeed", "ChargeState")
            val source = FakeSource(Resource.Error(cached = cached, fetchedAt = STAMP, stale = true, error = RuntimeException("net")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.availableSignals.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals(2, state.data?.size)
        }

    @Test
    fun retryReCollectsTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(listOf("VehicleSpeed"), fetchedAt = STAMP, stale = false))
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
            val vm = viewModel(FakeSource(Resource.Success(listOf("VehicleSpeed"), fetchedAt = STAMP, stale = false)), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "signalQueryControls.refresh" }
            assertEquals(mapOf("surface" to "SignalQueryControls"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(emptyList(), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "SignalQueryControls"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: SignalQueryControlsSource,
        logger: Logger = NoopLogger,
    ): SignalQueryControlsViewModel = SignalQueryControlsViewModel(source, logger, VEHICLE_ID, backgroundScope)

    private fun TestScope.observe(vm: SignalQueryControlsViewModel) {
        backgroundScope.launch { vm.availableSignals.collect {} }
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val VEHICLE_ID = 7L
    }
}
