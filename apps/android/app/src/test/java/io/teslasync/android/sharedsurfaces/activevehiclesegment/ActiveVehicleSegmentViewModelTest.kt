// Tests [ActiveVehicleSegmentViewModel] against the [ActiveVehicleSegmentSource] seam with a fake selection +
// fleet + state + units — covering every state the surface renders (loading / content / empty / hard error) plus
// the ADR-013 stale-offline state, the active-vehicle metrics fold (web `useVehicleState` × `useUnits`), the
// self-heal that reconciles the selection from the live list (web "default to the first vehicle"), the select
// write (web `setVehicleId`) that re-resolves the metrics, the refresh + retry restart of the feed, and the
// one-shot `view.opened` diagnostics event. The framework-free projection is covered by
// ActiveVehicleSegmentModelTest. Runs in :android:testReleaseUnitTest.

package io.teslasync.android.sharedsurfaces.activevehiclesegment

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
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
class ActiveVehicleSegmentViewModelTest {
    private class FakeSource(
        private val emissions: List<Resource<List<Vehicle>>>,
        initialSelectedId: Long? = null,
        formatter: UnitFormatter = UnitFormatter.default(),
        private val rangeMeters: Double = 300.0 * 1609.344,
    ) : ActiveVehicleSegmentSource {
        private val mutableSelectedId = MutableStateFlow(initialSelectedId)
        val selectCalls = mutableListOf<Long>()
        val reconcileCalls = mutableListOf<List<Long>>()
        var calls = 0
            private set

        override val selectedId: StateFlow<Long?> = mutableSelectedId
        override val units: StateFlow<UnitFormatter> = MutableStateFlow(formatter)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            calls++
            return emissions.asFlow()
        }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            flowOf(
                Resource.Success(
                    VehicleStateEnvelope(state(vehicleId * 10, rangeMeters), live = true),
                    fetchedAt = 1L,
                    stale = false,
                ),
            )

        override fun select(id: Long) {
            selectCalls += id
            mutableSelectedId.value = id
        }

        override fun reconcile(availableIds: List<Long>) {
            reconcileCalls += availableIds
            mutableSelectedId.value = effectiveSelectedId(mutableSelectedId.value, availableIds)
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

    private fun vm(
        source: ActiveVehicleSegmentSource,
        scope: CoroutineScope,
        logger: Logger = RecordingLogger(),
    ): ActiveVehicleSegmentViewModel = ActiveVehicleSegmentViewModel(source, logger, scope)

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    @Test
    fun loadsActiveVehicleAndMetricsWhenFleetResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Loading(cached = null, fetchedAt = null, stale = false),
                        success(listOf(vehicle(1, "Red Rocket"), vehicle(2, "Spacehauler"))),
                    ),
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(2, state.data?.count)
            assertEquals(1L, state.data?.effectiveSelectedId)
            assertEquals("Red Rocket", state.data?.selectedRow?.displayName)
            // Active vehicle 1 → 10% battery; default (metric) units → 483 km for the 300 mi SI range.
            assertEquals("10% \u00B7 483 km", state.data?.metricsLabel)
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
            assertTrue(state.data?.isEmpty ?: false)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Error, model.state.value.phase)
            assertTrue(model.state.value.hasError)
            assertFalse(model.state.value.hasData)
        }

    @Test
    fun offlineKeepsCachedFleetWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(
                        Resource.Error(
                            cached = listOf(vehicle(1), vehicle(2)),
                            fetchedAt = 100L,
                            stale = true,
                            error = ApiError.Network(),
                        ),
                    ),
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(2, state.data?.count)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
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
    fun selectWritesSelectionReResolvesMetricsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1), vehicle(2)))))
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.select(2)
            advanceUntilIdle()

            assertEquals(2L, source.selectedId.value)
            assertTrue(source.selectCalls.contains(2L))
            // Active vehicle 2 → 20% battery; the metrics chip re-resolves to the newly-selected vehicle.
            val refreshed = model.state.value
            assertEquals("20% \u00B7 483 km", refreshed.data?.metricsLabel)
            assertTrue(logger.records.any { it.event == "activeVehicleSegment.select" })
        }

    @Test
    fun refreshRestartsTheFeedAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1)))))
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val callsBeforeRefresh = source.calls

            model.refresh()
            advanceUntilIdle()

            assertTrue(source.calls > callsBeforeRefresh)
            assertTrue(logger.records.any { it.event == "activeVehicleSegment.refresh" })
        }

    @Test
    fun retryAlsoRestartsTheFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1)))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val callsBeforeRetry = source.calls

            model.retry()
            advanceUntilIdle()

            assertTrue(source.calls > callsBeforeRetry)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(emptyList())
            val model = vm(source, backgroundScope, logger)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ActiveVehicleSegment", opened.first().fields["surface"])
        }
}

private fun vehicle(
    id: Long,
    name: String = "Car $id",
): Vehicle =
    Vehicle(
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
        displayName = name,
        enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
        id = id,
        teslaId = 1000 + id,
        timezone = "UTC",
        updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
        vin = "VIN$id",
    )

private fun state(
    battery: Long,
    rangeMeters: Double,
): VehicleState =
    VehicleState(
        batteryLevel = battery,
        chargeRate = 0.0,
        chargerPower = 0.0,
        idealRange = rangeMeters,
        insideTemp = 0.0,
        isCharging = false,
        isClimateOn = false,
        isLocked = true,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 0.0,
        outsideTemp = 0.0,
        power = 0.0,
        ratedRange = rangeMeters,
        sentryMode = false,
        softwareVersion = "2026.0",
        speed = 0.0,
        state = "online",
        timeToFullCharge = 0.0,
        vehicleId = 1L,
    )
