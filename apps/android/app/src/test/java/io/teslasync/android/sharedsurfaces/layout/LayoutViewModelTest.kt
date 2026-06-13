package io.teslasync.android.sharedsurfaces.layout

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.Alert
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [LayoutViewModel] over a controllable fake [LayoutSource], covering the full lifecycle the web
 * shell + the bound feeds render: a first load → loading, a resolved fleet → content, an empty fleet → the
 * empty phase, a hard error → error, a cached value after a failed refresh → the offline (stale + cached)
 * surface, the unread-alert + forward-auth derivations, retry re-collecting the source, and the PII-safe
 * `view.opened` + `layout.refresh` diagnostics — end to end through the real `toUiState` projection. The
 * VM's feeds are `WhileSubscribed`, so each case keeps an active collector alive on the background scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LayoutViewModelTest {
    private class FakeSource(
        vehicles: Resource<List<Vehicle>>,
        alerts: Resource<List<Alert>> = Resource.Success(emptyList(), fetchedAt = STAMP, stale = false),
        forwardAuth: Boolean = false,
    ) : LayoutSource {
        val vehiclesFlow = MutableStateFlow(vehicles)
        val alertsFlow = MutableStateFlow(alerts)
        val forwardAuthFlow = MutableStateFlow(forwardAuth)
        var vehicleCalls: Int = 0

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            vehicleCalls++
            return vehiclesFlow
        }

        override fun alerts(): Flow<Resource<List<Alert>>> = alertsFlow

        override fun isForwardAuth(): StateFlow<Boolean> = forwardAuthFlow
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
    fun loadingResolvesToContentWhenTheFleetArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)

            source.vehiclesFlow.value = Resource.Success(listOf(vehicle(1)), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, state.data?.size)
        }

    @Test
    fun emptyFleetMapsToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(emptyList(), fetchedAt = STAMP, stale = false)))
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
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
    fun errorWithCacheKeepsFleetAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = listOf(vehicle(1))
            val source = FakeSource(Resource.Error(cached = cached, fetchedAt = STAMP, stale = true, error = RuntimeException("net")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals(1, state.data?.size)
        }

    @Test
    fun alertsAndForwardAuthAreExposed() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = Resource.Success(listOf(vehicle(1)), fetchedAt = STAMP, stale = false),
                    alerts = Resource.Success(listOf(alert(1, read = false), alert(2, read = true)), fetchedAt = STAMP, stale = false),
                    forwardAuth = true,
                )
            val vm = viewModel(source)
            observeAll(vm)
            advanceUntilIdle()

            val alertsState = vm.alerts.value
            assertEquals(2, alertsState.data?.size)
            assertEquals(1, LayoutProjection.badges(vm.state.value, alertsState).unreadAlerts)
            assertTrue(vm.isForwardAuth.value)
        }

    @Test
    fun retryReCollectsTheVehicleFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(listOf(vehicle(1)), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(1, source.vehicleCalls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(2, source.vehicleCalls)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(listOf(vehicle(1)), fetchedAt = STAMP, stale = false)), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "layout.refresh" }
            assertEquals(mapOf("surface" to "Layout"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(listOf(vehicle(1)), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "Layout"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: LayoutSource,
        logger: Logger = NoopLogger,
    ): LayoutViewModel = LayoutViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: LayoutViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private fun TestScope.observeAll(vm: LayoutViewModel) {
        backgroundScope.launch { vm.state.collect {} }
        backgroundScope.launch { vm.alerts.collect {} }
        backgroundScope.launch { vm.isForwardAuth.collect {} }
    }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochSeconds(0),
            displayName = "Car $id",
            enrolledAt = Instant.fromEpochSeconds(0),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.fromEpochSeconds(0),
            vin = "VIN$id",
        )

    private fun alert(
        id: Long,
        read: Boolean,
    ): Alert = Alert(id = id, isRead = read, severity = "info")

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
