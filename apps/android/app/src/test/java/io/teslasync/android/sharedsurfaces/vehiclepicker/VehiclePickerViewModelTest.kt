// Tests [VehiclePickerViewModel] against the [VehiclePickerSource] seam with a fake selection + fleet + pin
// feed — covering every state the surface renders (loading / content / single / empty / hard error) plus the
// ADR-013 stale-offline state, that the pin feed only reorders rows WITHOUT gating the phase (web `usePinned`
// default `[]`), the self-heal that reconciles the selection from the live list (web "default to the first
// vehicle"), the select write (web `setVehicleId`), the refresh + retry restart of the feed, and the one-shot
// `view.opened` diagnostics event. The framework-free projection is covered by VehiclePickerModelTest. Runs in
// :android:testReleaseUnitTest.

package io.teslasync.android.sharedsurfaces.vehiclepicker

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
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
class VehiclePickerViewModelTest {
    private class FakeSource(
        private val emissions: List<Resource<List<Vehicle>>>,
        private val pinEmissions: List<Resource<List<PinnedItem>>> = listOf(emptyPins()),
        initialSelectedId: Long? = null,
    ) : VehiclePickerSource {
        private val mutableSelectedId = MutableStateFlow(initialSelectedId)
        val selectCalls = mutableListOf<Long>()
        val reconcileCalls = mutableListOf<List<Long>>()
        var calls = 0
            private set

        override val selectedId: StateFlow<Long?> = mutableSelectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> {
            calls++
            return emissions.asFlow()
        }

        override fun pinned(): Flow<Resource<List<PinnedItem>>> = pinEmissions.asFlow()

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

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun pins(vararg pairs: Pair<Long, Int>): Resource<List<PinnedItem>> =
        Resource.Success(
            pairs.map { (vehicleId, position) ->
                PinnedItem(
                    id = 100 + vehicleId,
                    itemType = PinnedItemType.Vehicle,
                    itemId = vehicleId.toString(),
                    position = position,
                    pinnedAt = "2026-01-01T00:00:00Z",
                )
            },
            fetchedAt = 100L,
            stale = false,
        )

    private fun vm(
        source: VehiclePickerSource,
        scope: CoroutineScope,
        logger: Logger = RecordingLogger(),
    ): VehiclePickerViewModel = VehiclePickerViewModel(source, logger, scope)

    @Test
    fun loadsActiveVehicleWhenFleetResolves() =
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
    fun singleVehicleFleetIsContentPhaseFlaggedSingle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(9, "Solo")))))
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.data?.isSingle ?: false)
            assertFalse(state.data?.isSelectable ?: true)
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
    fun pinsReorderRowsWithoutGatingThePhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    emissions = listOf(success(listOf(vehicle(1), vehicle(2), vehicle(3)))),
                    pinEmissions = listOf(pins(3L to 0)),
                )
            val model = vm(source, backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            val state = model.state.value
            assertEquals(UiPhase.Content, state.phase)
            val rows = state.data?.vehicles
            assertEquals(listOf(3L, 1L, 2L), rows?.map { it.id })
            assertTrue(rows?.firstOrNull()?.pinned ?: false)
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
    fun selectWritesSelectionAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1), vehicle(2)))))
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            model.select(2)

            assertEquals(2L, source.selectedId.value)
            assertTrue(source.selectCalls.contains(2L))
            assertTrue(logger.records.any { it.event == "vehiclePicker.select" })
        }

    @Test
    fun refreshRestartsTheFeedAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1), vehicle(2)))))
            val logger = RecordingLogger()
            val model = vm(source, backgroundScope, logger)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()
            val callsBeforeRefresh = source.calls

            model.refresh()
            advanceUntilIdle()

            assertTrue(source.calls > callsBeforeRefresh)
            assertTrue(logger.records.any { it.event == "vehiclePicker.refresh" })
        }

    @Test
    fun retryAlsoRestartsTheFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(listOf(vehicle(1), vehicle(2)))))
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
            assertEquals("VehiclePicker", opened.first().fields["surface"])
        }

    private companion object {
        fun emptyPins(): Resource<List<PinnedItem>> = Resource.Success(emptyList(), fetchedAt = 100L, stale = false)
    }
}
