// Tests [VehicleTwinViewModel] against the [VehicleTwinSource] seam with a fake selection + fleet + paint-override
// feed — covering every state the surface renders (loading / content / empty / hard error) plus the ADR-013
// stale-offline state, the `useVehiclePaint` resolution (the active vehicle's `exterior_color` drives the paint,
// an override re-resolves it live), the self-heal that reconciles the selection from the live list (web "default
// to the first vehicle"), the setPaint write, the refresh + retry restart of the feed, and the one-shot
// `view.opened` diagnostics event. The framework-free projection is covered by VehicleTwinModelTest. Runs in
// :android:testReleaseUnitTest.

package io.teslasync.android.sharedsurfaces.vehicletwin

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class VehicleTwinViewModelTest {
    private class FakeSource(
        private val emissions: List<Resource<List<Vehicle>>>,
        initialSelectedId: Long? = null,
    ) : VehicleTwinSource {
        private val mutableSelectedId = MutableStateFlow(initialSelectedId)
        private val overrides = mutableMapOf<Long, MutableStateFlow<PaintPaletteId?>>()
        private val none = MutableStateFlow<PaintPaletteId?>(null)
        val setPaintCalls = mutableListOf<Pair<Long, PaintPaletteId?>>()
        val reconcileCalls = mutableListOf<List<Long>>()
        var calls = 0
            private set

        override val selectedId: StateFlow<Long?> = mutableSelectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            calls++
            return emissions.asFlow()
        }

        private fun slot(id: Long): MutableStateFlow<PaintPaletteId?> = overrides.getOrPut(id) { MutableStateFlow(null) }

        override fun paintOverride(vehicleId: Long?): StateFlow<PaintPaletteId?> = if (vehicleId == null) none else slot(vehicleId)

        override fun setPaint(
            vehicleId: Long,
            id: PaintPaletteId?,
        ) {
            setPaintCalls += vehicleId to id
            slot(vehicleId).value = id
        }

        override fun reconcile(availableIds: List<Long>) {
            reconcileCalls += availableIds
            val current = mutableSelectedId.value
            mutableSelectedId.value =
                when {
                    availableIds.isEmpty() -> null
                    current != null && current in availableIds -> current
                    else -> availableIds.first()
                }
        }
    }

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

    private fun vehicle(
        id: Long,
        color: String? = null,
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
            color = color,
        )

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun vm(
        source: VehicleTwinSource,
        scope: CoroutineScope,
        logger: Logger = RecordingLogger(),
    ): VehicleTwinViewModel = VehicleTwinViewModel(source, logger, scope)

    @Test
    fun resolvesActiveVehiclePaintWhenFleetResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Loading(cached = null, fetchedAt = null, stale = false),
                        success(listOf(vehicle(1, color = "DeepBlue"), vehicle(2, color = "RedMulticoat"))),
                    ),
                    initialSelectedId = 2L,
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(PaintPaletteId.RedMulticoat, state.data?.paint?.id)
            assertEquals("Car 2", state.data?.vehicleLabel)
        }

    @Test
    fun firstLoadWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isLoading)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(emptyList())))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertFalse(state.data?.hasVehicle ?: true)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Error, model.state.value.phase)
            assertTrue(model.state.value.hasError)
            assertFalse(model.state.value.hasData)
        }

    @Test
    fun offlineKeepsCachedPaintWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Error(
                            cached = listOf(vehicle(1, color = "SolidBlack")),
                            fetchedAt = 100L,
                            stale = true,
                            error = ApiError.Network(),
                        ),
                    ),
                    initialSelectedId = 1L,
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(PaintPaletteId.SolidBlack, state.data?.paint?.id)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun setPaintOverridesResolvedPaintLiveAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1, color = "PearlWhite")))), initialSelectedId = 1L)
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val before = model.state.value
            assertEquals(PaintPaletteId.PearlWhite, before.data?.paint?.id)

            model.setPaint(PaintPaletteId.SolidBlack)
            advanceUntilIdle()

            val after = model.state.value
            assertEquals(PaintPaletteId.SolidBlack, after.data?.paint?.id)
            assertTrue(after.data?.overridden ?: false)
            assertTrue(source.setPaintCalls.contains(1L to PaintPaletteId.SolidBlack))
            assertTrue(logger.records.any { it.event == EVENT_SET_PAINT })
        }

    @Test
    fun setPaintWithoutSelectionIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(emptyList())))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.setPaint(PaintPaletteId.DeepBlue)

            assertTrue(source.setPaintCalls.isEmpty())
        }

    @Test
    fun reconcileSelfHealsSelectionFromLiveList() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(5), vehicle(6)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(source.reconcileCalls.contains(listOf(5L, 6L)))
            assertEquals(5L, source.selectedId.value)
        }

    @Test
    fun refreshRestartsTheFeedAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1)))), initialSelectedId = 1L)
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val before = source.calls

            model.refresh()
            advanceUntilIdle()

            assertTrue(source.calls > before)
            assertTrue(logger.records.any { it.event == EVENT_REFRESH })
        }

    @Test
    fun retryAlsoRestartsTheFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1)))), initialSelectedId = 1L)
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val before = source.calls

            model.retry()
            advanceUntilIdle()

            assertTrue(source.calls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(emptyList())
            val model = vm(source, backgroundScope, logger)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals("VehicleTwin", opened.first().fields[SURFACE_KEY])
        }
}
