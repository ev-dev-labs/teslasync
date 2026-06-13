// Off-device coverage for the TirePressureSection data layer (P3 acceptance: the adapter "cached -> projection"
// unit test). Drives the [TirePressureSectionViewModel] through a fake [TirePressureSectionSource] and asserts the
// shared cache-then-network [io.teslasync.shared.core.data.repo.Resource] is projected onto the right lifecycle
// [io.teslasync.android.data.UiState] (content / empty / error / offline), that the active-vehicle resolution in
// [tirePressureSectionResource] short-circuits to a preferred id and folds onto a no-snapshot value when no
// vehicle resolves, and that the PII-safe `view.opened` diagnostic fires at most once. No Compose / Android /
// HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressuresection

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TirePressureSectionViewModelTest {
    private val snapshot: JsonElement =
        buildJsonObject {
            put("front_left", 250_000.0)
            put("front_right", 251_000.0)
            put("rear_left", 249_000.0)
            put("rear_right", 252_000.0)
        }

    private fun viewModel(
        source: TirePressureSectionSource,
        scope: CoroutineScope,
        logger: Logger = RecordingLogger(),
    ): TirePressureSectionViewModel = TirePressureSectionViewModel(source, logger, scope, vehicleId = 7L)

    // ── ViewModel: cache-then-network Resource -> UiState (per-state) ─────────────

    @Test
    fun successSnapshotProjectsToContent() =
        runTest {
            val vm = viewModel(FakeSource(flowOf(Resource.Success(snapshot, 1L, stale = false))), backgroundScope)
            val state = vm.state.first { !it.isLoading }
            assertTrue(state.isContent)
            assertTrue(state.hasData)
            assertEquals(snapshot, state.data)
        }

    @Test
    fun nullSnapshotProjectsToEmpty() =
        runTest {
            val vm = viewModel(FakeSource(flowOf(Resource.Success(JsonNull, 1L, stale = false))), backgroundScope)
            assertTrue(vm.state.first { !it.isLoading }.isEmpty)
        }

    @Test
    fun hardErrorWithNoCacheProjectsToError() =
        runTest {
            val failure =
                Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("net"))
            val vm = viewModel(FakeSource(flowOf(failure)), backgroundScope)
            val state = vm.state.first { !it.isLoading }
            assertTrue(state.isError)
            assertFalse(state.hasData)
        }

    @Test
    fun errorWithCachedSnapshotStaysContentAndOffline() =
        runTest {
            val offline =
                Resource.Error(cached = snapshot, fetchedAt = 1L, stale = true, error = RuntimeException("net"))
            val vm = viewModel(FakeSource(flowOf(offline)), backgroundScope)
            val state = vm.state.first { !it.isLoading }
            assertTrue(state.isContent)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(snapshot, state.data)
        }

    // ── Diagnostics + refresh ────────────────────────────────────────────────────

    @Test
    fun onViewOpenedEmitsOnceAndRefreshLogs() =
        runTest {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(flowOf(Resource.Success(snapshot, 1L, stale = false))), backgroundScope, logger)
            vm.onViewOpened()
            vm.onViewOpened()
            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TirePressureSection"), opened.single().fields)

            vm.refresh()
            assertTrue(logger.records.any { it.event == "tirePressureSection.refresh" })
        }

    // ── Active-vehicle resolution (web `vehicleId ?? vehicles?.[0]?.id`) ──────────

    @Test
    fun resourceShortCircuitsToThePreferredVehicleWithoutConsultingTheFleet() =
        runTest {
            val resource =
                tirePressureSectionResource(
                    vehicles = flow { error("the fleet list must not be collected when a preferred id is supplied") },
                    preferredVehicleId = 7L,
                    tirePressureFor = { id ->
                        assertEquals(7L, id)
                        flowOf(Resource.Success(snapshot, 1L, stale = false))
                    },
                )
            val emission = resource.first()
            assertTrue(emission is Resource.Success)
            assertEquals(snapshot, (emission as Resource.Success).data)
        }

    @Test
    fun resourceFoldsOntoANoSnapshotValueWhenNoVehicleResolves() =
        runTest {
            val resource =
                tirePressureSectionResource(
                    vehicles = flowOf(Resource.Success(emptyList<Vehicle>(), 1L, stale = false)),
                    preferredVehicleId = null,
                    tirePressureFor = { error("the tire feed must not run without a resolved vehicle") },
                )
            val emission = resource.first()
            assertTrue(emission is Resource.Success)
            assertEquals(JsonNull, (emission as Resource.Success).data)
        }

    @Test
    fun firstVehicleIdIsNullWhenTheFleetIsAbsentOrEmpty() {
        assertEquals(null, firstVehicleId(null))
        assertEquals(null, firstVehicleId(emptyList()))
    }

    /** A fake source bound to a fixed tire-pressure feed; the fleet list is unused (a preferred id is supplied). */
    private class FakeSource(
        private val tire: Flow<Resource<JsonElement>>,
    ) : TirePressureSectionSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flowOf(Resource.Success(emptyList(), 1L, stale = false))

        override fun tirePressure(vehicleId: Long): Flow<Resource<JsonElement>> = tire
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertions. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }
}
