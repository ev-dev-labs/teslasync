package io.teslasync.android.featureviews.gforcepanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [GForcePanelViewModel] over a fake [GForcePanelSource], plus the [gForceResource] cache-then-network
 * adapter directly — covering every state the web component renders from its polled `useDriveDynamicsLatest`
 * query (loading / content / empty / hard error / offline-cached), the web disabled-query → empty behaviour for
 * a missing/non-positive vehicle id, the refresh + retry re-fetch, and the one-shot `view.opened` diagnostic.
 * Run by the offline `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GForcePanelViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromPositiveVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Loading(cached = null, fetchedAt = null, stale = false),
                        successJson(gForceObject()),
                    ),
                )
            val vm = GForcePanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
        }

    @Test
    fun missingVehicleIdRendersEmptyNotLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(emptyList())
            val vm = GForcePanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = null)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertEquals(0, source.driveDynamicsCalls)
        }

    @Test
    fun snapshotWithoutAccelerationIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(successJson(buildJsonObject { put("pedal_position", 12.0) })))
            val vm = GForcePanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun feedLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            val vm = GForcePanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val vm = GForcePanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedSnapshotWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Error(cached = gForceObject(), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                    ),
                )
            val vm = GForcePanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReCollectsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(listOf(successJson(gForceObject())))
            val vm = GForcePanelViewModel(source, logger, backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.driveDynamicsCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.driveDynamicsCalls > before)
            assertTrue(logger.records.any { it.event == "gForcePanel.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(successJson(gForceObject())))
            val vm = GForcePanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 3L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.driveDynamicsCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.driveDynamicsCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = GForcePanelViewModel(FakeSource(emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("GForcePanel", opened.first().fields["surface"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPositiveIdStreamsDriveDynamicsDirectly() =
        runTest {
            val result =
                gForceResource(preferredVehicleId = 1L, driveDynamicsFor = { flowOf(successJson(gForceObject())) })
                    .toList()
                    .last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached is JsonObject)
        }

    @Test
    fun adapterEmitsNoVehicleSnapshotWhenIdMissing() =
        runTest {
            val result =
                gForceResource(preferredVehicleId = null, driveDynamicsFor = { flowOf(successJson(gForceObject())) })
                    .toList()
                    .last()
            assertTrue(result is Resource.Success)
            assertEquals(JsonNull, result.cached)
        }

    @Test
    fun adapterEmitsNoVehicleSnapshotWhenIdNonPositive() =
        runTest {
            val result =
                gForceResource(preferredVehicleId = 0L, driveDynamicsFor = { flowOf(successJson(gForceObject())) })
                    .toList()
                    .last()
            assertTrue(result is Resource.Success)
            assertEquals(JsonNull, result.cached)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val driveDynamics: List<Resource<JsonElement>>,
    ) : GForcePanelSource {
        var driveDynamicsCalls = 0
            private set

        override fun driveDynamics(vehicleId: Long): Flow<Resource<JsonElement>> {
            driveDynamicsCalls++
            return driveDynamics.asFlow()
        }
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private fun successJson(json: JsonElement): Resource<JsonElement> = Resource.Success(json, fetchedAt = 100L, stale = false)

    private fun gForceObject(): JsonObject =
        buildJsonObject {
            put("lateral_acceleration", 0.30)
            put("longitudinal_acceleration", 0.40)
        }
}
