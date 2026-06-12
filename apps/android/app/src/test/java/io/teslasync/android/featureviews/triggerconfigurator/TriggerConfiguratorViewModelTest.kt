package io.teslasync.android.featureviews.triggerconfigurator

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.locations.Geofence
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [TriggerConfiguratorViewModel] over a controllable fake [TriggerConfiguratorSource], covering the
 * full cache-then-network state matrix the geofence dropdown can be in (loading / content with geofences /
 * empty with none / hard error + retry / stale-offline + retry / refresh re-fetch) plus the PII-safe
 * `view.opened` + refresh diagnostics. An empty list maps to the empty surface; a non-empty list maps to
 * content — exactly the web `geofences ?? []` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TriggerConfiguratorViewModelTest {
    private fun geofence(
        id: Long,
        name: String,
    ): Geofence =
        Geofence(
            id = id,
            name = name,
            polygonWkt = "",
            createdAt = "2024-01-01T00:00:00Z",
            updatedAt = "2024-01-01T00:00:00Z",
            latitude = 37.0,
            longitude = -122.0,
            radius = 500.0,
            enabled = true,
        )

    private val populated = listOf(geofence(1, "Home"))

    private class FakeSource(
        var emissions: List<Resource<List<Geofence>>>,
    ) : TriggerConfiguratorSource {
        override fun geofences(): Flow<Resource<List<Geofence>>> = flow { emissions.forEach { emit(it) } }
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
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.geofences.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.geofences.value.phase)
        }

    @Test
    fun contentWhenGeofencesPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.geofences.collect {} }
            advanceUntilIdle()

            val state = vm.geofences.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoGeofences() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList(), 100L, false))))
            backgroundScope.launch { vm.geofences.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.geofences.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.geofences.collect {} }
            advanceUntilIdle()

            val state = vm.geofences.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.geofences.collect {} }
            advanceUntilIdle()
            assertEquals(populated, vm.geofences.value.data)

            src.emissions = listOf(Resource.Error(populated, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.geofences.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(populated, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun retryReFetchesUpdatedGeofences() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = populated + geofence(2, "Office")
            val src = FakeSource(listOf(Resource.Success(populated, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.geofences.collect {} }
            advanceUntilIdle()
            assertEquals(populated, vm.geofences.value.data)

            src.emissions = listOf(Resource.Success(updated, 200L, false))
            vm.retry()
            advanceUntilIdle()

            assertEquals(updated, vm.geofences.value.data)
            assertEquals(200L, vm.geofences.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TriggerConfigurator"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "triggerConfigurator.refresh" })
        }

    private fun TestScope.viewModel(
        source: TriggerConfiguratorSource,
        logger: Logger = NoopLogger,
    ): TriggerConfiguratorViewModel = TriggerConfiguratorViewModel(source, logger, backgroundScope)
}
